import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { TranslationResult } from "../../types.js";
import {
  OffsetUnsafeNormalizationError,
  canonicalJson,
  canonicalJsonPretty,
  canonicalizeCase,
  canonicalizeJson,
  canonicalizeRequest,
  canonicalizeResult,
  caseIdMatchesRequest,
  compareStrings,
  deriveCaseId,
  isNfc,
  sha256Hex,
  slugFromText,
  sortDiagnostics,
  sortedDiagnosticCodes,
} from "./canonicalize.js";
import {
  corpusCaseSchema,
  type CorpusCase,
  type CorpusRequest,
} from "./schema.js";
import {
  OracleMissError,
  ProviderTripwireError,
  SpyProvider,
} from "./spy_provider.js";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const request = (overrides: Partial<CorpusRequest> = {}): CorpusRequest => ({
  targetLanguage: "en",
  blocks: [{ id: "local-block-1", text: "5x, 1e, sık iğneye geçiyoruz." }],
  ...overrides,
});

const harvestedCase = (overrides: Record<string, unknown> = {}): CorpusCase => {
  const req = request();
  return {
    schema: 1,
    id: deriveCaseId("harvested", req),
    lane: "harvested",
    status: "characterized",
    origins: [{ kind: "test", file: "translator.test.ts", test: "a", callIndex: 0 }],
    request: req,
    provider: { mode: "none" },
    expected: {
      results: [
        {
          id: "local-block-1",
          source: "5x, 1e, sık iğneye geçiyoruz.",
          translated: "5sc, 1dec, work into the next single crochet.",
          valid: true,
          errorCodes: [],
          warningCodes: [],
        },
      ],
    },
    trace: { providerCalls: [], diagnostics: [{ id: "local-block-1", errors: [], warnings: [] }] },
    labels: { families: ["row-count"], hazards: [], zeroProvider: true },
    ...overrides,
  } as CorpusCase;
};

const providerRequest = (
  blocks: { id: string; text: string }[],
  prompts: { systemPrompt?: string; userPrompt?: string } = {},
) => ({
  targetLanguage: "en" as const,
  blocks,
  systemPrompt: prompts.systemPrompt ?? "SYSTEM PROMPT TEXT",
  userPrompt: prompts.userPrompt ?? "USER PROMPT TEXT",
});

const result = (overrides: Partial<TranslationResult> = {}): TranslationResult => ({
  id: "local-block-1",
  source: "kaynak",
  translated: "target",
  valid: true,
  errors: [],
  warnings: [],
  ...overrides,
});

const fileText = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");

// ---------------------------------------------------------------------------
// Environment guard
// ---------------------------------------------------------------------------

describe("locale guard", () => {
  it("has full ICU Turkish case folding", () => {
    expect("I".toLocaleLowerCase("tr-TR")).toBe("ı");
    expect("İ".toLocaleLowerCase("tr-TR")).toBe("i");
  });
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("corpus schema", () => {
  it("accepts a well-formed harvested case", () => {
    expect(corpusCaseSchema.safeParse(harvestedCase()).success).toBe(true);
  });

  it("accepts a pending-approval curated case without expected or trace", () => {
    const req = request();
    const pending = {
      ...harvestedCase(),
      id: deriveCaseId("curated", req),
      lane: "curated",
      status: "pending-approval",
      expected: undefined,
      trace: undefined,
    };
    expect(corpusCaseSchema.safeParse(pending).success).toBe(true);
  });

  it("accepts a known-bad repro carrying known metadata", () => {
    const req = request();
    const repro = harvestedCase({
      id: deriveCaseId("repro", req),
      lane: "repro",
      status: "known-bad",
      known: { note: "ordinal at block start", desired: ["x"], observedLive: ["7we"] },
    });
    expect(corpusCaseSchema.safeParse(repro).success).toBe(true);
  });

  const rejects: [string, Record<string, unknown>][] = [
    ["an unknown top-level key", { extra: 1 }],
    ["a wrong schema version", { schema: 2 }],
    ["a status that does not belong to the lane", { status: "approved" }],
    ["an id prefix that does not match the lane", { id: "c-0123456789" }],
    ["a malformed id", { id: "h-XYZ" }],
    ["known metadata on a non-known-bad case", { known: { note: "n", desired: [], observedLive: [] } }],
    ["a missing expected block on a characterized case", { expected: undefined }],
    ["a missing trace on a characterized case", { trace: undefined }],
    ["an empty origins list", { origins: [] }],
    [
      "duplicate block ids",
      {
        request: request({
          blocks: [
            { id: "a", text: "x" },
            { id: "a", text: "y" },
          ],
        }),
      },
    ],
    [
      "a source region past the end of the text",
      {
        request: request({
          blocks: [{ id: "a", text: "abc", formattingRegions: [{ id: "fmt-0", start: 0, end: 4 }] }],
        }),
      },
    ],
    [
      "a source region that ends before it starts",
      {
        request: request({
          blocks: [{ id: "a", text: "abc", formattingRegions: [{ id: "fmt-0", start: 2, end: 1 }] }],
        }),
      },
    ],
    ["an oracle provider with no entries", { provider: { mode: "oracle", entries: [] } }],
    [
      "duplicate oracle source text",
      {
        provider: {
          mode: "oracle",
          entries: [
            { source: "a", translated: "b" },
            { source: "a", translated: "c" },
          ],
        },
      },
    ],
    ["an unknown provider mode", { provider: { mode: "live" } }],
    [
      "recorded provider calls under mode none",
      {
        trace: {
          providerCalls: [
            {
              targetLanguage: "en",
              blockIds: ["local-block-1"],
              blockTexts: ["x"],
              systemPromptSha256: sha256Hex("s"),
              userPromptSha256: sha256Hex("u"),
            },
          ],
          diagnostics: [],
        },
        labels: { families: [], hazards: [], zeroProvider: false },
      },
    ],
    ["a zeroProvider label that contradicts the trace", { labels: { families: [], hazards: [], zeroProvider: false } }],
    [
      "a result id that is not a request block id",
      {
        expected: {
          results: [
            { id: "nope", source: "s", translated: "t", valid: true, errorCodes: [], warningCodes: [] },
          ],
        },
      },
    ],
    [
      "a styled slice for an unknown region",
      {
        expected: {
          results: [
            { id: "local-block-1", source: "s", translated: "t", valid: true, errorCodes: [], warningCodes: [] },
          ],
          styledSlices: [{ regionId: "fmt-9", text: "t" }],
        },
      },
    ],
    [
      "a prompt hash that is not a sha-256 hex string",
      {
        trace: {
          providerCalls: [
            {
              targetLanguage: "en",
              blockIds: [],
              blockTexts: [],
              systemPromptSha256: "abc",
              userPromptSha256: "abc",
            },
          ],
          diagnostics: [],
        },
        provider: { mode: "echo" },
        labels: { families: [], hazards: [], zeroProvider: false },
      },
    ],
  ];

  it.each(rejects)("rejects %s", (_label, overrides) => {
    expect(corpusCaseSchema.safeParse(harvestedCase(overrides)).success).toBe(false);
  });

  it("stores malformed target regions, because the corpus must capture bad output", () => {
    const withBadTarget = harvestedCase({
      expected: {
        results: [
          {
            id: "local-block-1",
            source: "s",
            translated: "short",
            valid: true,
            errorCodes: [],
            warningCodes: [],
            targetFormattingRegions: [{ id: "fmt-0", start: 0, end: 999 }],
          },
        ],
      },
    });
    expect(corpusCaseSchema.safeParse(withBadTarget).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------

describe("canonicalizeJson", () => {
  it("is independent of object key order at every depth", () => {
    const left = { b: 1, a: { d: [1, { z: 1, y: 2 }], c: "x" } };
    const right = { a: { c: "x", d: [1, { y: 2, z: 1 }] }, b: 1 };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(canonicalJson(left)).toBe('{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}');
  });

  it("keeps array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("normalizes strings and keys to NFC", () => {
    const decomposed = "s\u0327"; // s + combining cedilla
    expect(decomposed).not.toBe("\u015f");
    expect(canonicalizeJson({ [decomposed]: decomposed })).toEqual({ "\u015f": "\u015f" });
    expect(isNfc(decomposed)).toBe(false);
    expect(isNfc("\u015f")).toBe(true);
  });

  it("does not turn Turkish dotless and dotted i into each other", () => {
    expect(canonicalizeJson("ıİiI")).toBe("ıİiI");
  });

  it("treats undefined object properties as absent", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("normalizes negative zero", () => {
    expect(canonicalJson({ n: -0 })).toBe('{"n":0}');
  });

  it("stores a __proto__ key as data", () => {
    const parsed = JSON.parse('{"__proto__":{"x":1}}') as unknown;
    expect(canonicalJson(parsed)).toBe('{"__proto__":{"x":1}}');
  });

  it.each([
    ["undefined inside an array", [undefined]],
    ["a sparse array", new Array<number>(2)],
    ["NaN", { n: NaN }],
    ["Infinity", { n: Infinity }],
    ["a bigint", { n: 1n }],
    ["a function", { f: () => 1 }],
    ["a Date", { d: new Date(0) }],
    ["a Map", { m: new Map() }],
  ])("throws on %s", (_label, value) => {
    expect(() => canonicalizeJson(value)).toThrow(TypeError);
  });

  it("throws on circular references", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => canonicalizeJson(loop)).toThrow(/circular/);
  });

  it("does not report a shared, non-circular reference as circular", () => {
    const shared = { a: 1 };
    expect(canonicalJson({ x: shared, y: shared })).toBe('{"x":{"a":1},"y":{"a":1}}');
  });

  it("throws when two keys collide after NFC", () => {
    expect(() => canonicalizeJson({ "s\u0327": 1, "\u015f": 2 })).toThrow(/duplicate key/);
  });

  it("produces identical output on repeated calls", () => {
    const value = { b: ["\u015f", { d: 1, c: 2 }], a: null };
    expect(canonicalJsonPretty(value)).toBe(canonicalJsonPretty(value));
    expect(canonicalJsonPretty(value).endsWith("}\n")).toBe(true);
  });
});

describe("compareStrings", () => {
  it("orders by code unit and is locale independent", () => {
    expect(["b", "a", "B", "ı", "i", "İ"].sort(compareStrings)).toEqual([
      "B",
      "a",
      "b",
      "i",
      "İ",
      "ı",
    ]);
  });
});

describe("diagnostic ordering", () => {
  it("sorts codes and keeps duplicates", () => {
    expect(
      sortedDiagnosticCodes([
        { code: "NUMBER_MISMATCH" },
        { code: "ANCHOR" },
        { code: "NUMBER_MISMATCH" },
      ]),
    ).toEqual(["ANCHOR", "NUMBER_MISMATCH", "NUMBER_MISMATCH"]);
  });

  it("sorts diagnostics by code then message without mutating the input", () => {
    const input = [
      { code: "B", message: "z" },
      { code: "A", message: "b" },
      { code: "A", message: "a" },
    ];
    const snapshot = structuredClone(input);
    expect(sortDiagnostics(input)).toEqual([
      { code: "A", message: "a" },
      { code: "A", message: "b" },
      { code: "B", message: "z" },
    ]);
    expect(input).toEqual(snapshot);
  });

  it("gives the same canonical result regardless of pipeline diagnostic order", () => {
    const one = canonicalizeResult(
      result({
        errors: [
          { code: "NUMBER_MISMATCH", message: "m1" },
          { code: "LOST_PATTERN_NOTATION", message: "m2" },
        ],
      }),
    );
    const two = canonicalizeResult(
      result({
        errors: [
          { code: "LOST_PATTERN_NOTATION", message: "m2" },
          { code: "NUMBER_MISMATCH", message: "m1" },
        ],
      }),
    );
    expect(canonicalJson(one)).toBe(canonicalJson(two));
    expect(one.errorCodes).toEqual(["LOST_PATTERN_NOTATION", "NUMBER_MISMATCH"]);
  });
});

describe("canonicalizeResult", () => {
  it("keeps absent optional fields absent", () => {
    const canonical = canonicalizeResult(result());
    expect(Object.keys(canonical).sort()).toEqual([
      "errorCodes",
      "id",
      "source",
      "translated",
      "valid",
      "warningCodes",
    ]);
  });

  it("keeps formatting fields and region order exactly as produced", () => {
    const canonical = canonicalizeResult(
      result({
        targetFormattingRegions: [
          { id: "fmt-1", start: 5, end: 9 },
          { id: "fmt-0", start: 0, end: 5 },
        ],
        formattingProjection: "atomic_collapse",
        absorbedFormattingRegionIds: ["fmt-2", "fmt-1"],
      }),
    );
    expect(canonical.targetFormattingRegions?.map(({ id }) => id)).toEqual(["fmt-1", "fmt-0"]);
    expect(canonical.formattingProjection).toBe("atomic_collapse");
    expect(canonical.absorbedFormattingRegionIds).toEqual(["fmt-2", "fmt-1"]);
  });

  it("distinguishes an empty region list from an absent one", () => {
    expect(canonicalizeResult(result({ targetFormattingRegions: [] })).targetFormattingRegions).toEqual([]);
  });

  it("refuses a result field it does not know, instead of dropping it", () => {
    const extended = { ...result(), newContractField: true } as TranslationResult;
    expect(() => canonicalizeResult(extended)).toThrow(/unknown field "newContractField"/);
  });

  it("normalizes translated text to NFC when no offsets depend on it", () => {
    expect(canonicalizeResult(result({ translated: "s\u0327" })).translated).toBe("\u015f");
  });

  it("refuses non-NFC translated text when target regions index into it", () => {
    expect(() =>
      canonicalizeResult(
        result({
          translated: "s\u0327",
          targetFormattingRegions: [{ id: "fmt-0", start: 0, end: 2 }],
        }),
      ),
    ).toThrow(OffsetUnsafeNormalizationError);
  });
});

describe("canonicalizeRequest", () => {
  it("normalizes NFC when there are no regions", () => {
    const canonical = canonicalizeRequest(
      request({ blocks: [{ id: "a", text: "s\u0327ık" }] }),
    );
    expect(canonical.blocks[0]?.text).toBe("\u015fık");
  });

  it("refuses non-NFC text in a block that has regions", () => {
    expect(() =>
      canonicalizeRequest(
        request({
          blocks: [
            { id: "a", text: "s\u0327ık", formattingRegions: [{ id: "fmt-0", start: 0, end: 3 }] },
          ],
        }),
      ),
    ).toThrow(OffsetUnsafeNormalizationError);
  });

  it("keeps block and region order", () => {
    const canonical = canonicalizeRequest(
      request({
        blocks: [
          { id: "b", text: "xy", formattingRegions: [{ id: "fmt-1", start: 1, end: 2 }, { id: "fmt-0", start: 0, end: 1 }] },
          { id: "a", text: "z" },
        ],
      }),
    );
    expect(canonical.blocks.map(({ id }) => id)).toEqual(["b", "a"]);
    expect(canonical.blocks[0]?.formattingRegions?.map(({ id }) => id)).toEqual(["fmt-1", "fmt-0"]);
  });

  it("does not fill in a default contentKind", () => {
    expect("contentKind" in canonicalizeRequest(request())).toBe(false);
  });
});

describe("case ids", () => {
  it("has the lane prefix, ten hex characters, and an optional slug", () => {
    expect(deriveCaseId("harvested", request())).toMatch(/^h-[0-9a-f]{10}$/);
    expect(deriveCaseId("curated", request(), "arm-fold")).toMatch(/^c-[0-9a-f]{10}-arm-fold$/);
    expect(deriveCaseId("repro", request())).toMatch(/^r-[0-9a-f]{10}$/);
  });

  it("is stable across runs and independent of key order and NFC form", () => {
    const composed = request({ blocks: [{ id: "a", text: "\u015fık" }] });
    const reordered = {
      blocks: [{ text: "s\u0327ık", id: "a" }],
      targetLanguage: "en",
    };
    expect(deriveCaseId("harvested", composed)).toBe(deriveCaseId("harvested", reordered));
    expect(deriveCaseId("harvested", composed)).toBe(deriveCaseId("harvested", composed));
  });

  it("changes when any request content changes", () => {
    const base = deriveCaseId("harvested", request());
    expect(deriveCaseId("harvested", request({ targetLanguage: "es" }))).not.toBe(base);
    expect(deriveCaseId("harvested", request({ contentKind: "materials" }))).not.toBe(base);
    expect(
      deriveCaseId("harvested", request({ blocks: [{ id: "local-block-1", text: "5x, 1e." }] })),
    ).not.toBe(base);
    expect(
      deriveCaseId("harvested", request({ blocks: [{ id: "other", text: "5x, 1e, sık iğneye geçiyoruz." }] })),
    ).not.toBe(base);
  });

  it("does not depend on the slug", () => {
    const withSlug = deriveCaseId("harvested", request(), "anything-here");
    expect(withSlug.startsWith(`${deriveCaseId("harvested", request())}-`)).toBe(true);
  });

  it("changes when a formatting region changes", () => {
    const blocks = (end: number) => [
      { id: "a", text: "abcdef", formattingRegions: [{ id: "fmt-0", start: 0, end }] },
    ];
    expect(deriveCaseId("harvested", request({ blocks: blocks(3) }))).not.toBe(
      deriveCaseId("harvested", request({ blocks: blocks(4) })),
    );
  });

  it("rejects a malformed slug", () => {
    expect(() => deriveCaseId("harvested", request(), "Bad Slug")).toThrow(TypeError);
  });

  it("checks a case id against its request", () => {
    expect(caseIdMatchesRequest(harvestedCase())).toBe(true);
    expect(
      caseIdMatchesRequest({ ...harvestedCase(), id: "h-0000000000" }),
    ).toBe(false);
    expect(
      caseIdMatchesRequest({
        ...harvestedCase(),
        id: `${deriveCaseId("harvested", request())}-with-slug`,
      }),
    ).toBe(true);
  });

  it("builds ASCII slugs from Turkish text", () => {
    expect(slugFromText("İkinci parça; Görselde görüldüğü gibi sık iğne")).toBe(
      "ikinci-parca-gorselde-goruldugu",
    );
    expect(slugFromText("✦ ---")).toBe("");
    expect(slugFromText("sık iğneye", 1)).toBe("sik");
  });
});

describe("canonicalizeCase", () => {
  it("is idempotent", () => {
    const once = canonicalizeCase(harvestedCase());
    expect(canonicalJson(canonicalizeCase(once))).toBe(canonicalJson(once));
  });

  it("sorts unordered collections only", () => {
    const req = request({
      blocks: [
        {
          id: "b",
          text: "abcdef",
          formattingRegions: [
            { id: "fmt-1", start: 3, end: 6 },
            { id: "fmt-0", start: 0, end: 3 },
          ],
        },
      ],
    });
    const messy = harvestedCase({
      id: deriveCaseId("harvested", req),
      request: req,
      provider: {
        mode: "oracle",
        entries: [
          { source: "z", translated: "1" },
          { source: "a", translated: "2" },
        ],
      },
      expected: {
        results: [
          { id: "b", source: "abcdef", translated: "abcdef", valid: true, errorCodes: [], warningCodes: [] },
        ],
        styledSlices: [
          { blockId: "b", regionId: "fmt-1", text: "def" },
          { blockId: "b", regionId: "fmt-0", text: "abc" },
        ],
      },
      labels: { families: ["b-fam", "a-fam", "a-fam"], hazards: ["z", "y"], zeroProvider: true },
      regionStyles: [
        { blockId: "b", regionId: "fmt-1", style: { color: "#000000" } },
        { blockId: "b", regionId: "fmt-0", style: { italic: true, color: "#c97569" } },
      ],
      origins: [
        { kind: "test", file: "b.test.ts", test: "t", callIndex: 1 },
        { kind: "manual", note: "n" },
        { kind: "test", file: "a.test.ts", test: "t", callIndex: 0 },
      ],
    });

    const canonical = canonicalizeCase(messy);
    expect(canonical.provider.mode === "oracle" && canonical.provider.entries.map((e) => e.source)).toEqual(["a", "z"]);
    expect(canonical.labels.families).toEqual(["a-fam", "b-fam"]);
    expect(canonical.labels.hazards).toEqual(["y", "z"]);
    expect(canonical.regionStyles?.map((s) => s.regionId)).toEqual(["fmt-0", "fmt-1"]);
    expect(canonical.expected?.styledSlices?.map((s) => s.regionId)).toEqual(["fmt-0", "fmt-1"]);
    // Region order inside the request is pipeline input and must not move.
    expect(canonical.request.blocks[0]?.formattingRegions?.map((r) => r.id)).toEqual(["fmt-1", "fmt-0"]);
  });

  it("gives the same bytes for a case written with different key order", () => {
    const base = harvestedCase();
    const reversed = Object.fromEntries(Object.entries(base).reverse());
    expect(canonicalJsonPretty(canonicalizeCase(reversed))).toBe(
      canonicalJsonPretty(canonicalizeCase(base)),
    );
  });

  it("rejects an invalid case", () => {
    expect(() => canonicalizeCase({ ...harvestedCase(), lane: "nope" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Spy provider
// ---------------------------------------------------------------------------

describe("SpyProvider: none mode", () => {
  it("throws on translate, records the attempt, and stays dirty", async () => {
    const spy = new SpyProvider({ mode: "none" });
    await expect(
      spy.translate(providerRequest([{ id: "a", text: "x" }])),
    ).rejects.toBeInstanceOf(ProviderTripwireError);

    expect(spy.calls).toHaveLength(1);
    expect(spy.violations).toEqual([{ kind: "tripwire", operation: "translate", callIndex: 0 }]);
    expect(() => spy.assertClean()).toThrow(/violation/);
  });

  it("throws on checkReadiness too", async () => {
    const spy = new SpyProvider({ mode: "none" });
    await expect(spy.checkReadiness()).rejects.toBeInstanceOf(ProviderTripwireError);
    expect(spy.readinessCheckCount).toBe(1);
    expect(spy.violations).toEqual([{ kind: "tripwire", operation: "checkReadiness", callIndex: null }]);
  });

  it("is clean when never called", () => {
    const spy = new SpyProvider({ mode: "none" });
    expect(spy.calls).toEqual([]);
    expect(() => spy.assertClean()).not.toThrow();
  });

  it("stays dirty even if the caller swallows the rejection", async () => {
    const spy = new SpyProvider({ mode: "none" });
    await spy.translate(providerRequest([{ id: "a", text: "x" }])).catch(() => undefined);
    expect(() => spy.assertClean()).toThrow();
  });
});

describe("SpyProvider: oracle mode", () => {
  const oracle = () =>
    new SpyProvider({
      mode: "oracle",
      entries: [
        { source: "sık iğneye", translated: "into the next single crochet" },
        { source: "sayıp atlıyoruz.", translated: "count and skip." },
      ],
    });

  it("looks up by exact block text and returns the block id it was asked for", async () => {
    const spy = oracle();
    const response = await spy.translate(
      providerRequest([
        { id: "second", text: "sayıp atlıyoruz." },
        { id: "first", text: "sık iğneye" },
      ]),
    );
    expect(response.translations).toEqual([
      { id: "second", translated: "count and skip." },
      { id: "first", translated: "into the next single crochet" },
    ]);
    expect(() => spy.assertClean()).not.toThrow();
  });

  it("does not depend on call order or call index", async () => {
    const forward = oracle();
    const backward = oracle();
    const a = { id: "a", text: "sık iğneye" };
    const b = { id: "b", text: "sayıp atlıyoruz." };
    const first = await forward.translate(providerRequest([a]));
    await forward.translate(providerRequest([b]));
    await backward.translate(providerRequest([b]));
    const last = await backward.translate(providerRequest([a]));
    expect(first).toEqual(last);
  });

  it("answers repeated text in one call for each block id", async () => {
    const response = await oracle().translate(
      providerRequest([
        { id: "x", text: "sık iğneye" },
        { id: "y", text: "sık iğneye" },
      ]),
    );
    expect(response.translations.map(({ id }) => id)).toEqual(["x", "y"]);
  });

  it("matches exactly: case, whitespace and composition all matter", async () => {
    for (const text of ["Sık iğneye", "sık iğneye ", " sık iğneye", "sık iğneye.".slice(0, -1) + "̇"]) {
      await expect(
        oracle().translate(providerRequest([{ id: "a", text }])),
      ).rejects.toBeInstanceOf(OracleMissError);
    }
  });

  it("fails loudly on a miss with an actionable, specific error", async () => {
    const spy = oracle();
    const promise = spy.translate(
      providerRequest([
        { id: "hit", text: "sık iğneye" },
        { id: "gone", text: "yeni bir cümle" },
      ]),
    );
    await expect(promise).rejects.toBeInstanceOf(OracleMissError);
    await expect(promise).rejects.toThrow(/block "gone".*yeni bir cümle/);
    await expect(promise).rejects.toThrow(/oracle/i);

    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OracleMissError);
    expect((error as OracleMissError).misses).toEqual([
      { callIndex: 0, blockId: "gone", blockText: "yeni bir cümle" },
    ]);
    expect(spy.violations).toEqual([
      { kind: "oracle-miss", callIndex: 0, blockId: "gone", blockText: "yeni bir cümle" },
    ]);
    expect(() => spy.assertClean()).toThrow();
  });

  it("returns no partial answer when any block misses", async () => {
    const spy = oracle();
    const outcome = await spy
      .translate(providerRequest([{ id: "hit", text: "sık iğneye" }, { id: "gone", text: "?" }]))
      .then(() => "resolved", () => "rejected");
    expect(outcome).toBe("rejected");
  });

  it("checkReadiness succeeds and is counted", async () => {
    const spy = oracle();
    await expect(spy.checkReadiness()).resolves.toMatchObject({ ok: true, provider: "corpus-spy" });
    expect(spy.readinessCheckCount).toBe(1);
  });

  it("rejects duplicate oracle sources and empty oracles at construction", () => {
    expect(
      () =>
        new SpyProvider({
          mode: "oracle",
          entries: [
            { source: "a", translated: "1" },
            { source: "a", translated: "2" },
          ],
        }),
    ).toThrow();
    expect(() => new SpyProvider({ mode: "oracle", entries: [] })).toThrow();
  });

  it("treats a __proto__ source as ordinary text", async () => {
    const spy = new SpyProvider({
      mode: "oracle",
      entries: [{ source: "__proto__", translated: "ok" }],
    });
    await expect(spy.translate(providerRequest([{ id: "a", text: "__proto__" }]))).resolves.toEqual({
      translations: [{ id: "a", translated: "ok" }],
    });
    await expect(spy.translate(providerRequest([{ id: "a", text: "toString" }]))).rejects.toBeInstanceOf(OracleMissError);
  });
});

describe("SpyProvider: echo mode", () => {
  it("returns every block unchanged, in order, with its own id", async () => {
    const spy = new SpyProvider({ mode: "echo" });
    const response = await spy.translate(
      providerRequest([
        { id: "b", text: "İkinci parça" },
        { id: "a", text: "" },
        { id: "c", text: "7. sık iğneye" },
      ]),
    );
    expect(response.translations).toEqual([
      { id: "b", translated: "İkinci parça" },
      { id: "a", translated: "" },
      { id: "c", translated: "7. sık iğneye" },
    ]);
    expect(() => spy.assertClean()).not.toThrow();
  });
});

describe("SpyProvider: recording", () => {
  it("records every call in order with language, ids, texts and prompt hashes", async () => {
    const spy = new SpyProvider({ mode: "echo" });
    await spy.translate(providerRequest([{ id: "a", text: "one" }], { systemPrompt: "S1", userPrompt: "U1" }));
    await spy.translate({
      ...providerRequest([{ id: "b", text: "two" }, { id: "c", text: "three" }], { systemPrompt: "S2", userPrompt: "U2" }),
      targetLanguage: "es",
    });

    expect(spy.calls).toEqual([
      {
        targetLanguage: "en",
        blockIds: ["a"],
        blockTexts: ["one"],
        systemPromptSha256: sha256Hex("S1"),
        userPromptSha256: sha256Hex("U1"),
      },
      {
        targetLanguage: "es",
        blockIds: ["b", "c"],
        blockTexts: ["two", "three"],
        systemPromptSha256: sha256Hex("S2"),
        userPromptSha256: sha256Hex("U2"),
      },
    ]);
  });

  it("records refused and missed attempts too, in the same sequence", async () => {
    const spy = new SpyProvider({ mode: "oracle", entries: [{ source: "known", translated: "K" }] });
    await spy.translate(providerRequest([{ id: "a", text: "known" }]));
    await spy.translate(providerRequest([{ id: "b", text: "unknown" }])).catch(() => undefined);
    await spy.translate(providerRequest([{ id: "c", text: "known" }]));
    expect(spy.calls.map((call) => call.blockIds)).toEqual([["a"], ["b"], ["c"]]);
    expect(spy.violations.map((violation) => (violation.kind === "oracle-miss" ? violation.callIndex : -1))).toEqual([1]);
  });

  it("produces stable prompt hashes and matches the SHA-256 test vector", async () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const one = new SpyProvider({ mode: "echo" });
    const two = new SpyProvider({ mode: "echo" });
    await one.translate(providerRequest([{ id: "a", text: "x" }], { systemPrompt: "same", userPrompt: "same" }));
    await two.translate(providerRequest([{ id: "a", text: "x" }], { systemPrompt: "same", userPrompt: "same" }));
    expect(one.calls).toEqual(two.calls);
    expect(one.calls[0]?.systemPromptSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes the hash when a prompt changes, and hashes system and user separately", async () => {
    const spy = new SpyProvider({ mode: "echo" });
    await spy.translate(providerRequest([{ id: "a", text: "x" }], { systemPrompt: "A", userPrompt: "B" }));
    await spy.translate(providerRequest([{ id: "a", text: "x" }], { systemPrompt: "B", userPrompt: "A" }));
    const [first, second] = spy.calls;
    expect(first?.systemPromptSha256).toBe(second?.userPromptSha256);
    expect(first?.systemPromptSha256).not.toBe(first?.userPromptSha256);
  });

  it("never stores prompt text", async () => {
    const spy = new SpyProvider({ mode: "echo" });
    await spy.translate(
      providerRequest([{ id: "a", text: "x" }], {
        systemPrompt: "SECRET-SYSTEM-MARKER",
        userPrompt: "SECRET-USER-MARKER",
      }),
    );
    const stored = JSON.stringify([spy.calls, spy.violations]);
    expect(stored).not.toContain("SECRET-SYSTEM-MARKER");
    expect(stored).not.toContain("SECRET-USER-MARKER");
  });

  it("is not affected by later mutation of the caller's request", async () => {
    const spy = new SpyProvider({ mode: "echo" });
    const blocks = [{ id: "a", text: "before" }];
    await spy.translate(providerRequest(blocks));
    blocks[0] = { id: "changed", text: "after" };
    blocks.push({ id: "extra", text: "extra" });
    expect(spy.calls[0]?.blockIds).toEqual(["a"]);
    expect(spy.calls[0]?.blockTexts).toEqual(["before"]);
  });

  it("returns copies, so a reader cannot alter the record", async () => {
    const spy = new SpyProvider({ mode: "echo" });
    await spy.translate(providerRequest([{ id: "a", text: "x" }]));
    const read = spy.calls;
    (read[0]?.blockIds as string[]).push("tampered");
    expect(spy.calls[0]?.blockIds).toEqual(["a"]);
  });

  it("reports its name, model and mode", () => {
    const spy = new SpyProvider({ mode: "echo" });
    expect([spy.name, spy.model, spy.mode]).toEqual(["corpus-spy", "spy-echo", "echo"]);
  });

  it("satisfies the stored trace schema", async () => {
    const spy = new SpyProvider({ mode: "echo" });
    await spy.translate(providerRequest([{ id: "a", text: "x" }]));
    const withTrace = harvestedCase({
      provider: { mode: "echo" },
      trace: { providerCalls: [...spy.calls], diagnostics: [] },
      labels: { families: [], hazards: [], zeroProvider: false },
    });
    expect(corpusCaseSchema.safeParse(withTrace).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Static guards: the harness stays hermetic and cycle-free
// ---------------------------------------------------------------------------

const importSpecifiers = (source: string): string[] =>
  [...source.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)].map(
    (match) => match[1] ?? "",
  );

describe("harness hermeticity", () => {
  const allowedImports: Record<string, string[]> = {
    "schema.ts": ["zod", "../../types.js"],
    "canonicalize.ts": ["node:crypto", "zod", "../../types.js", "./schema.js"],
    "spy_provider.ts": ["../../providers/provider.js", "./canonicalize.js", "./schema.js"],
  };

  it.each(Object.entries(allowedImports))("%s imports only allowed modules", (file, allowed) => {
    const specifiers = importSpecifiers(fileText(file));
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((specifier) => !allowed.includes(specifier))).toEqual([]);
  });

  it.each(Object.keys(allowedImports))("%s never imports translator code", (file) => {
    expect(importSpecifiers(fileText(file)).filter((s) => /translator|normalizer|validator|segmentation|formatting_projection/.test(s))).toEqual([]);
  });

  it.each(Object.keys(allowedImports))(
    "%s has no environment, clock, randomness, network or locale-default access",
    (file) => {
      // Comments are stripped so the module docs may describe what is banned.
      const code = fileText(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code).not.toMatch(/process\.env|process\.argv|Date\.now|new Date\(|Math\.random|performance\.now|randomUUID|randomBytes/);
      expect(code).not.toMatch(/\bfetch\s*\(|node:(?:http|https|net|dns|tls|child_process)|XMLHttpRequest|WebSocket/);
      expect(code).not.toMatch(/localeCompare|Intl\./);
      expect(code).not.toMatch(/toLocale(?:Lower|Upper)Case\(\s*\)/);
    },
  );

  it("does not read dotenv or provider credentials", () => {
    for (const file of Object.keys(allowedImports)) {
      expect(fileText(file)).not.toMatch(/dotenv|OPENAI|API_KEY/);
    }
  });
});
