/**
 * Stage 0, Step 5: focused negative tests for the corpus loader.
 *
 * The loader is the corpus's front door, so these tests use small in-memory
 * files and only assert what the loader promises: strictness, complete issue
 * reporting with file and case id, determinism, and that a pending-approval
 * case loads but can never be executed. Replay behavior is tested elsewhere.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalJsonPretty,
  canonicalizeCase,
  deriveCaseId,
  deriveHarvestedCaseId,
} from "./canonicalize.js";
import {
  CorpusLoadError,
  loadCorpus,
  loadCorpusFiles,
  readCorpusDirectory,
  requireExecutable,
  type CorpusFileInput,
  type CorpusIssue,
} from "./load_corpus.js";
import type { CorpusLane, CorpusStatus } from "./schema.js";

type Draft = Record<string, unknown> & { id: string };

type Options = {
  lane?: CorpusLane;
  status?: CorpusStatus;
  slug?: string;
  blocks?: Record<string, unknown>[];
  extra?: Record<string, unknown>;
  /** Replay provider config; defaults to no provider. */
  provider?: Record<string, unknown>;
};

const defaultStatus = (lane: CorpusLane): CorpusStatus =>
  lane === "harvested" ? "characterized" : lane === "curated" ? "approved" : "known-bad";

/** A schema-valid zero-provider case. The loader never replays, so values are inert. */
const makeCase = (options: Options = {}): Draft => {
  const lane = options.lane ?? "harvested";
  const status = options.status ?? defaultStatus(lane);
  const blocks = options.blocks ?? [{ id: "b1", text: "ch 3" }];
  const request = { targetLanguage: "en", blocks };
  const pending = status === "pending-approval";
  const provider = options.provider ?? { mode: "none" };
  return {
    schema: 1,
    // The harvested lane identifies a scenario (request + provider config).
    id:
      lane === "harvested"
        ? deriveHarvestedCaseId(request, provider, options.slug)
        : deriveCaseId(lane, request, options.slug),
    lane,
    status,
    origins: [{ kind: "manual", note: "loader test" }],
    request,
    provider,
    ...(pending
      ? {}
      : {
          expected: {
            results: blocks.map((block) => ({
              id: block["id"],
              source: block["text"],
              translated: block["text"],
              valid: true,
              errorCodes: [],
              warningCodes: [],
            })),
          },
          trace: {
            providerCalls: [],
            diagnostics: blocks.map((block) => ({
              id: block["id"],
              errors: [],
              warnings: [],
            })),
          },
        }),
    labels: { families: [], hazards: [], zeroProvider: !pending },
    ...(status === "known-bad"
      ? { known: { note: "loader test", desired: ["target"], observedLive: [] } }
      : {}),
    ...options.extra,
  };
};

const fileOf = (draft: Draft, name = `${draft.id}.json`): CorpusFileInput => ({
  name,
  bytes: canonicalJsonPretty(canonicalizeCase(draft)),
});

/** Runs the loader and returns its issues; fails if it did not throw. */
const issuesFor = (files: CorpusFileInput[]): readonly CorpusIssue[] => {
  try {
    loadCorpusFiles(files);
  } catch (error) {
    if (error instanceof CorpusLoadError) {
      return error.issues;
    }
    throw error;
  }
  throw new Error("Expected loadCorpusFiles to throw CorpusLoadError.");
};

const messages = (issues: readonly CorpusIssue[]): string => issues.map((i) => i.message).join("\n");

describe("corpus loader: acceptance", () => {
  it("loads valid cases and freezes them", () => {
    const corpus = loadCorpusFiles([fileOf(makeCase())]);
    expect(corpus.cases).toHaveLength(1);
    expect(corpus.executable).toHaveLength(1);
    expect(corpus.pending).toHaveLength(0);
    const first = corpus.cases[0];
    expect(Object.isFrozen(first?.value)).toBe(true);
    expect(Object.isFrozen(first?.value.request.blocks[0])).toBe(true);
  });

  it("allows the same request in different lanes but not twice in one lane", () => {
    const harvested = makeCase({ lane: "harvested" });
    const curated = makeCase({ lane: "curated" });
    expect(loadCorpusFiles([fileOf(harvested), fileOf(curated)]).cases).toHaveLength(2);

    const first = makeCase({ slug: "one" });
    const second = makeCase({ slug: "two" });
    const issues = issuesFor([fileOf(first), fileOf(second)]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/Duplicate canonical request in lane "harvested"/);
    expect(issues[0]?.caseId).toBe(second.id);
  });

  it("allows one request under different replay provider configs in the harvested lane", () => {
    const oracleA = makeCase({
      provider: { mode: "oracle", entries: [{ source: "ch 3", translated: "ch 3" }] },
    });
    const oracleB = makeCase({
      provider: { mode: "oracle", entries: [{ source: "ch 3", translated: "ch 3 a" }] },
    });
    const none = makeCase();
    const corpus = loadCorpusFiles([fileOf(oracleA), fileOf(oracleB), fileOf(none)]);
    expect(corpus.cases).toHaveLength(3);
    const ids = corpus.cases.map((entry) => entry.caseId);
    expect(new Set(ids).size).toBe(3);
    // Same request, so the same request hash prefix; only the scenario part differs.
    expect(new Set(ids.map((id) => id.slice(0, 12))).size).toBe(1);
  });

  it("rejects the same request and the same replay provider config twice, whatever the oracle order", () => {
    const entries = [
      { source: "a", translated: "1" },
      { source: "b", translated: "2" },
    ];
    const first = makeCase({ blocks: [{ id: "b1", text: "a" }, { id: "b2", text: "b" }], provider: { mode: "oracle", entries }, slug: "one" });
    const second = makeCase({
      blocks: [{ id: "b1", text: "a" }, { id: "b2", text: "b" }],
      provider: { mode: "oracle", entries: [...entries].reverse() },
      slug: "two",
    });
    const issues = issuesFor([fileOf(first), fileOf(second)]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/Duplicate canonical request in lane "harvested" with the same replay provider config/);
  });

  it("keeps repro and curated ids request-based: the same request under another provider is still a duplicate", () => {
    const first = makeCase({ lane: "curated", slug: "one" });
    const second = makeCase({
      lane: "curated",
      slug: "two",
      provider: { mode: "echo" },
    });
    const issues = issuesFor([fileOf(first), fileOf(second)]);
    expect(messages(issues)).toMatch(/Duplicate canonical request in lane "curated", same as/);
    expect(first.id).toBe(deriveCaseId("curated", first["request"], "one"));
  });

  it("loads the real corpus directory without issues", () => {
    const corpus = loadCorpus();
    expect(corpus.cases.length).toBeGreaterThan(0);
    expect(corpus.cases.length).toBe(corpus.executable.length + corpus.pending.length);
  });
});

describe("corpus loader: rejection with file and case id", () => {
  it("rejects malformed JSON and invalid UTF-8, never skipping them", () => {
    const issues = issuesFor([
      { name: "h-0000000000.json", bytes: "{ not json" },
      { name: "h-1111111111.json", bytes: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) },
    ]);
    expect(issues.map((issue) => issue.file)).toEqual([
      "h-0000000000.json",
      "h-1111111111.json",
    ]);
    expect(issues[0]?.message).toMatch(/Invalid JSON/);
    expect(issues[1]?.message).toMatch(/not valid UTF-8/);
  });

  it("rejects schema-invalid cases and names the case id and the failing path", () => {
    const draft = makeCase();
    const broken = { ...draft, surprise: true, labels: { families: [], hazards: [] } };
    const issues = issuesFor([
      { name: `${draft.id}.json`, bytes: `${JSON.stringify(broken, null, 2)}\n` },
    ]);
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.file).toBe(`${draft.id}.json`);
      expect(issue.caseId).toBe(draft.id);
      expect(issue.message).toMatch(/^Schema: /);
    }
    expect(messages(issues)).toMatch(/labels/);
  });

  it("rejects an id whose hash does not match the request", () => {
    const draft = makeCase();
    const wrongId = "h-0000000000";
    const issues = issuesFor([fileOf({ ...draft, id: wrongId })]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: `${wrongId}.json`, caseId: wrongId });
    expect(issues[0]?.message).toMatch(/does not match its request/);
  });

  it("rejects a request-only id in the harvested lane, which needs the scenario hash", () => {
    const draft = makeCase();
    const requestOnly = deriveCaseId("harvested", draft["request"]);
    const issues = issuesFor([fileOf({ ...draft, id: requestOnly })]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/does not match its request and replay provider config/);
    expect(issues[0]?.message).toContain(String(draft.id));
  });

  it("rejects a harvested id whose scenario hash belongs to another provider config", () => {
    const none = makeCase();
    const oracle = makeCase({
      provider: { mode: "oracle", entries: [{ source: "ch 3", translated: "ch 3" }] },
    });
    const issues = issuesFor([fileOf({ ...oracle, id: none.id })]);
    expect(messages(issues)).toMatch(/does not match its request and replay provider config/);
  });

  it("rejects a file whose name is not its id", () => {
    const draft = makeCase();
    const issues = issuesFor([fileOf(draft, "renamed.json")]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain(`File name must be "${draft.id}.json"`);
  });

  it("rejects duplicate ids", () => {
    const draft = makeCase();
    const issues = issuesFor([fileOf(draft), fileOf(draft, "a-copy.json")]);
    expect(messages(issues)).toMatch(/Duplicate case id, already used by/);
    expect(issues.every((issue) => issue.caseId === draft.id)).toBe(true);
  });

  it("rejects files that are not canonical bytes", () => {
    const draft = makeCase();
    const compact = `${JSON.stringify(canonicalizeCase(draft))}\n`;
    const issues = issuesFor([{ name: `${draft.id}.json`, bytes: compact }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/not in canonical form/);
  });

  it("rejects anything in the directory that is not a case file", () => {
    const issues = issuesFor([{ name: "notes.txt", bytes: "hello" }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.file).toBe("notes.txt");
  });

  it("enforces the formatting rules the schema cannot express", () => {
    const region = (id: string, end: number) => ({ id, start: 0, end });

    const noSlices = makeCase({
      blocks: [{ id: "b1", text: "ab", formattingRegions: [region("fmt-0", 2)] }],
      extra: { regionStyles: [{ blockId: "b1", regionId: "fmt-0", style: { color: "#111111" } }] },
    });
    const expected = noSlices["expected"] as { results: Record<string, unknown>[] };
    const withRegions = {
      ...noSlices,
      expected: {
        results: expected.results.map((result) => ({
          ...result,
          targetFormattingRegions: [{ id: "fmt-0", start: 0, end: 2 }],
        })),
      },
    };
    expect(messages(issuesFor([fileOf(withRegions)]))).toMatch(/styledSlices is missing/);
  });
});

describe("corpus loader: formatting regions without regionStyles (Option 2)", () => {
  const region = (id: string, end: number) => ({ id, start: 0, end });
  const twoRegionBlock = {
    id: "b1",
    text: "abcd",
    formattingRegions: [
      { id: "fmt-0", start: 0, end: 2 },
      { id: "fmt-1", start: 2, end: 4 },
    ],
  };

  it("loads a case whose request has formatting regions and no regionStyles", () => {
    const draft = makeCase({ blocks: [twoRegionBlock] });
    expect(draft["regionStyles"]).toBeUndefined();
    const loaded = loadCorpusFiles([fileOf(draft)]);
    expect(loaded.executable).toHaveLength(1);
    const [entry] = loaded.executable;
    expect(entry?.value.regionStyles).toBeUndefined();
    expect(entry?.value.request.blocks[0]?.formattingRegions).toHaveLength(2);
  });

  it("loads absent styles as absent: nothing is filled in", () => {
    const [entry] = loadCorpusFiles([fileOf(makeCase({ blocks: [twoRegionBlock] }))]).cases;
    expect("regionStyles" in (entry?.value ?? {})).toBe(false);
  });

  it("keeps the strict coverage rule for PROVIDED regionStyles: incomplete styles fail", () => {
    const incomplete = issuesFor([
      fileOf(
        makeCase({
          blocks: [twoRegionBlock],
          extra: { regionStyles: [{ blockId: "b1", regionId: "fmt-0", style: { color: "#111111" } }] },
        }),
      ),
    ]);
    expect(messages(incomplete)).toMatch(/regionStyles has no entry for source region\(s\): b1\/fmt-1/);
    expect(messages(incomplete)).toMatch(/Provided regionStyles must cover every source region/);
  });

  it("treats an empty provided regionStyles array as provided, so it still fails coverage", () => {
    const empty = issuesFor([
      fileOf(makeCase({ blocks: [twoRegionBlock], extra: { regionStyles: [] } })),
    ]);
    expect(messages(empty)).toMatch(/regionStyles has no entry for source region\(s\): b1\/fmt-0, b1\/fmt-1/);
  });

  it("keeps rejecting malformed and unknown provided styles (the case schema, before the loader)", () => {
    const one = [{ id: "b1", text: "ab", formattingRegions: [region("fmt-0", 2)] }];
    expect(() =>
      fileOf(
        makeCase({
          blocks: one,
          extra: {
            regionStyles: [
              { blockId: "b1", regionId: "fmt-0", style: { color: "#111111" } },
              { blockId: "b1", regionId: "fmt-9", style: { color: "#222222" } },
            ],
          },
        }),
      ),
    ).toThrow(/regionStyles region .*fmt-9.*is not in block.*b1/);

    expect(() =>
      fileOf(
        makeCase({
          blocks: one,
          extra: {
            regionStyles: [
              { blockId: "b1", regionId: "fmt-0", style: { color: "#111111" } },
              { blockId: "b1", regionId: "fmt-0", style: { color: "#111111" } },
            ],
          },
        }),
      ),
    ).toThrow(/Duplicate regionStyles entry for block.*b1.*region.*fmt-0/);

    expect(() =>
      fileOf(
        makeCase({
          blocks: one,
          extra: { regionStyles: [{ blockId: "b9", regionId: "fmt-0", style: { color: "#111111" } }] },
        }),
      ),
    ).toThrow(/regionStyles block.*b9.*is not in the request/);

    expect(() =>
      fileOf(makeCase({ blocks: one, extra: { regionStyles: [{ blockId: "b1", regionId: "fmt-0", style: { color: [] } }] } })),
    ).toThrow();
  });

  it("rejects malformed provided styles in a file's bytes as loader issues", () => {
    const one = [{ id: "b1", text: "ab", formattingRegions: [region("fmt-0", 2)] }];
    const draft = makeCase({
      blocks: one,
      extra: { regionStyles: [{ blockId: "b1", regionId: "fmt-0", style: { color: "#111111" } }] },
    });
    const good = JSON.parse(canonicalJsonPretty(canonicalizeCase(draft))) as Record<string, unknown>;
    const bad = {
      ...good,
      regionStyles: [{ blockId: "b1", regionId: "fmt-0", style: { color: { nested: true } } }],
    };
    const issues = issuesFor([{ name: `${draft.id}.json`, bytes: `${JSON.stringify(bad, null, 2)}\n` }]);
    expect(messages(issues)).toMatch(/regionStyles/);
  });

  it("accepts complete provided regionStyles", () => {
    const complete = makeCase({
      blocks: [twoRegionBlock],
      extra: {
        regionStyles: [
          { blockId: "b1", regionId: "fmt-0", style: { color: "#111111" } },
          { blockId: "b1", regionId: "fmt-1", style: { color: "#222222" } },
        ],
      },
    });
    expect(loadCorpusFiles([fileOf(complete)]).executable).toHaveLength(1);
  });

  it("still requires styledSlices when results carry target regions, styles or not", () => {
    const draft = makeCase({ blocks: [twoRegionBlock] });
    const expected = draft["expected"] as { results: Record<string, unknown>[] };
    const withTargets = {
      ...draft,
      expected: {
        results: expected.results.map((result) => ({
          ...result,
          targetFormattingRegions: [{ id: "fmt-0", start: 0, end: 4 }],
        })),
      },
    };
    expect(messages(issuesFor([fileOf(withTargets)]))).toMatch(/styledSlices is missing/);
  });

  it("still requires region ids to be unique WITHIN one block", () => {
    // Duplicate-in-block is a schema-level invariant (like duplicate block
    // ids), so it is rejected at construction, before a file could even exist.
    expect(() =>
      fileOf(
        makeCase({
          blocks: [{ id: "b1", text: "abcd", formattingRegions: [region("fmt-0", 2), { id: "fmt-0", start: 2, end: 4 }] }],
        }),
      ),
    ).toThrow(/Duplicate formatting region id.*fmt-0.*in this block/);
  });
});

describe("corpus loader: block-local region identity", () => {
  const region = (id: string, end: number) => ({ id, start: 0, end });
  const twoBlocksSharingIds = [
    { id: "block-a", text: "abcd", formattingRegions: [region("fmt-0", 2), { id: "fmt-1", start: 2, end: 4 }] },
    { id: "block-b", text: "efgh", formattingRegions: [region("fmt-0", 2), { id: "fmt-1", start: 2, end: 4 }] },
  ];

  it("accepts two blocks that both use fmt-0 and fmt-1: not a collision", () => {
    const draft = makeCase({ blocks: twoBlocksSharingIds });
    const loaded = loadCorpusFiles([fileOf(draft)]);
    expect(loaded.executable).toHaveLength(1);
    const [entry] = loaded.executable;
    expect(entry?.value.request.blocks.map((block) => block.formattingRegions?.map((r) => r.id))).toEqual([
      ["fmt-0", "fmt-1"],
      ["fmt-0", "fmt-1"],
    ]);
  });

  it("keeps regionStyles for block A's fmt-0 distinct from block B's fmt-0", () => {
    const withStyles = makeCase({
      blocks: twoBlocksSharingIds,
      extra: {
        regionStyles: [
          { blockId: "block-a", regionId: "fmt-0", style: { color: "#111111" } },
          { blockId: "block-a", regionId: "fmt-1", style: { color: "#111111" } },
          { blockId: "block-b", regionId: "fmt-0", style: { color: "#222222" } },
          { blockId: "block-b", regionId: "fmt-1", style: { color: "#333333" } },
        ],
      },
    });
    const loaded = loadCorpusFiles([fileOf(withStyles)]).executable;
    expect(loaded).toHaveLength(1);
    const styles = loaded[0]?.value.regionStyles;
    expect(styles?.find((entry) => entry.blockId === "block-a" && entry.regionId === "fmt-0")?.style).toEqual({
      color: "#111111",
    });
    expect(styles?.find((entry) => entry.blockId === "block-b" && entry.regionId === "fmt-0")?.style).toEqual({
      color: "#222222",
    });
  });

  it("styles for only one of two blocks sharing an id still fails coverage for the other block", () => {
    const partial = issuesFor([
      fileOf(
        makeCase({
          blocks: twoBlocksSharingIds,
          extra: {
            regionStyles: [
              { blockId: "block-a", regionId: "fmt-0", style: { color: "#111111" } },
              { blockId: "block-a", regionId: "fmt-1", style: { color: "#111111" } },
            ],
          },
        }),
      ),
    ]);
    expect(messages(partial)).toMatch(/regionStyles has no entry for source region\(s\): block-b\/fmt-0, block-b\/fmt-1/);
  });

  it("styledSlices distinguish the same region id across two blocks", () => {
    const draft = makeCase({ blocks: twoBlocksSharingIds });
    const expected = draft["expected"] as { results: Record<string, unknown>[] };
    const withSlices = {
      ...draft,
      expected: {
        results: expected.results.map((result) => ({
          ...result,
          targetFormattingRegions: [
            { id: "fmt-0", start: 0, end: 2 },
            { id: "fmt-1", start: 2, end: 4 },
          ],
        })),
        styledSlices: [
          { blockId: "block-a", regionId: "fmt-0", text: "ab" },
          { blockId: "block-a", regionId: "fmt-1", text: "cd" },
          { blockId: "block-b", regionId: "fmt-0", text: "ef" },
          { blockId: "block-b", regionId: "fmt-1", text: "gh" },
        ],
      },
    };
    expect(loadCorpusFiles([fileOf(withSlices)]).executable).toHaveLength(1);
  });

  it("rejects a styledSlices entry whose region is unknown IN THAT BLOCK, even though it exists in another block", () => {
    const draft = makeCase({ blocks: twoBlocksSharingIds });
    const expected = draft["expected"] as { results: Record<string, unknown>[] };
    const crossed = {
      ...draft,
      expected: {
        results: expected.results.map((result) => ({
          ...result,
          targetFormattingRegions: [
            { id: "fmt-0", start: 0, end: 2 },
            { id: "fmt-1", start: 2, end: 4 },
          ],
        })),
        // "fmt-0" and "fmt-1" both exist, but not on "block-a" and "block-b" swapped consistently:
        // this entry claims a region for block-a that block-a's own regions do not name.
        styledSlices: [
          { blockId: "block-a", regionId: "fmt-0", text: "ab" },
          { blockId: "block-a", regionId: "fmt-1", text: "cd" },
          { blockId: "block-b", regionId: "fmt-0", text: "ef" },
          { blockId: "block-b", regionId: "fmt-9", text: "gh" },
        ],
      },
    };
    // Schema-level, so rejected at construction, before a file could exist.
    expect(() => fileOf(crossed)).toThrow(/styledSlices region.*fmt-9.*is not in block.*block-b/);
  });

  it("rejects a styledSlices entry naming an unknown block", () => {
    const draft = makeCase({ blocks: twoBlocksSharingIds });
    const expected = draft["expected"] as { results: Record<string, unknown>[] };
    const unknownBlock = {
      ...draft,
      expected: {
        results: expected.results.map((result) => ({
          ...result,
          targetFormattingRegions: [
            { id: "fmt-0", start: 0, end: 2 },
            { id: "fmt-1", start: 2, end: 4 },
          ],
        })),
        styledSlices: [
          { blockId: "block-a", regionId: "fmt-0", text: "ab" },
          { blockId: "block-a", regionId: "fmt-1", text: "cd" },
          { blockId: "block-c", regionId: "fmt-0", text: "ef" },
        ],
      },
    };
    expect(() => fileOf(unknownBlock)).toThrow(/styledSlices block.*block-c.*is not in the request/);
  });
});

describe("corpus loader: determinism", () => {
  const drafts = [
    makeCase({ blocks: [{ id: "b1", text: "sc 3" }] }),
    makeCase({ blocks: [{ id: "b1", text: "dc 4" }] }),
    makeCase({ blocks: [{ id: "b1", text: "ch 5" }] }),
  ];

  it("returns the same order whatever order the files are given in", () => {
    const forward = loadCorpusFiles(drafts.map((draft) => fileOf(draft)));
    const backward = loadCorpusFiles(drafts.map((draft) => fileOf(draft)).reverse());
    const ids = forward.cases.map((entry) => entry.caseId);
    expect(backward.cases.map((entry) => entry.caseId)).toEqual(ids);
    expect(ids).toEqual([...ids].sort());
    expect(backward.cases.map((entry) => entry.file)).toEqual(
      forward.cases.map((entry) => entry.file),
    );
  });

  it("reports every issue, ordered by file name, whatever the input order", () => {
    const bad = [
      { name: "z-bad.json", bytes: "{" },
      { name: "a-bad.json", bytes: "[" },
      fileOf(drafts[0] as Draft),
    ];
    const forward = issuesFor(bad);
    const backward = issuesFor([...bad].reverse());
    expect(forward.map((issue) => issue.file)).toEqual(["a-bad.json", "z-bad.json"]);
    expect(backward).toEqual(forward);
  });
});

describe("corpus loader: pending approval", () => {
  it("loads pending cases as visible but never executable", () => {
    const pending = makeCase({ lane: "curated", status: "pending-approval" });
    const approved = makeCase({
      lane: "curated",
      blocks: [{ id: "b1", text: "sl st 2" }],
    });
    const corpus = loadCorpusFiles([fileOf(pending), fileOf(approved)]);
    expect(corpus.cases).toHaveLength(2);
    expect(corpus.pending.map((entry) => entry.caseId)).toEqual([pending.id]);
    expect(corpus.executable.map((entry) => entry.caseId)).toEqual([approved.id]);

    const pendingEntry = corpus.pending[0];
    expect(pendingEntry?.executable).toBe(false);
    if (pendingEntry === undefined) {
      throw new Error("pending case missing");
    }
    expect(() => requireExecutable(pendingEntry)).toThrow(/pending-approval/);
  });
});

describe("corpus loader: directory reading", () => {
  it("ignores dot files but refuses directories", () => {
    const directory = mkdtempSync(join(tmpdir(), "corpus-loader-"));
    try {
      const draft = makeCase();
      writeFileSync(join(directory, `${draft.id}.json`), fileOf(draft).bytes);
      writeFileSync(join(directory, ".DS_Store"), "ignored");
      expect(readCorpusDirectory(directory).map((entry) => entry.name)).toEqual([
        `${draft.id}.json`,
      ]);

      mkdirSync(join(directory, "nested"));
      expect(() => readCorpusDirectory(directory)).toThrow(CorpusLoadError);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
