import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ATOMIC_COLLAPSE,
  FormattingContractError,
  PROJECTION_STYLE_KEYS,
  checkFormattingContract,
  checkRemapPreconditions,
  followsFrontendRegionIdConvention,
  formattingContractAdvisories,
  frontendRegionIds,
  isFormattingContractComplete,
  requiresFormattingProjection,
  styledSlices,
  type FormattingContractCheck,
  type FormattingContractInput,
  type TargetRegion,
} from "./formatting_contract.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const region = (id: string, start: number, end: number): TargetRegion => ({ id, start, end });

const TEXT = "abcdef"; // length 6
const TWO = ["fmt-0", "fmt-1"];
const THREE = ["fmt-0", "fmt-1", "fmt-2"];

const check = (
  overrides: Partial<FormattingContractInput> = {},
): FormattingContractCheck =>
  checkFormattingContract({
    sourceRegionIds: TWO,
    requiresProjection: true,
    translated: TEXT,
    ...overrides,
  });

const codeOf = (result: FormattingContractCheck): string | null =>
  result.complete ? null : result.issue.code;

// Built from code points so this file holds no composed or decomposed letters.
const EMOJI = String.fromCodePoint(0x1f600); // one code point, two UTF-16 units
const S_CEDILLA_COMPOSED = String.fromCharCode(0x15f);
const S_CEDILLA_DECOMPOSED = `s${String.fromCharCode(0x327)}`;
const STAR = String.fromCharCode(0x2726);

// ---------------------------------------------------------------------------
// Literal port of the frontend functions, used as the differential reference.
// Source: src/intents/design_editor/translation_review.ts. The only change is
// that `snapshots` is replaced by a region count / a precomputed boolean.
// ---------------------------------------------------------------------------

const referenceHasComplete = (
  snapshotCount: number,
  formattingProjectionRequired: boolean,
  targetRegions: readonly { id: string; start: number; end: number }[] | undefined,
  targetLength: number,
  formattingProjection?: string,
  absorbedFormattingRegionIds?: readonly string[],
): boolean => {
  if (!targetRegions?.length) {
    return !formattingProjectionRequired;
  }

  const validIds = new Set(
    Array.from({ length: snapshotCount }, (_snapshot, index) => `fmt-${index}`),
  );
  const seenIds = new Set<string>();
  const absorbedIds = new Set(absorbedFormattingRegionIds ?? []);

  if (
    absorbedFormattingRegionIds?.some((id) => !validIds.has(id)) ||
    absorbedIds.size !== (absorbedFormattingRegionIds?.length ?? 0)
  ) {
    return false;
  }

  let end = 0;

  for (const item of targetRegions) {
    if (
      !validIds.has(item.id) ||
      !Number.isInteger(item.start) ||
      !Number.isInteger(item.end) ||
      item.start !== end ||
      item.end < item.start ||
      item.end > targetLength
    ) {
      return false;
    }

    if (
      item.end === item.start &&
      (formattingProjection !== "atomic_collapse" || !absorbedIds.has(item.id))
    ) {
      return false;
    }

    seenIds.add(item.id);
    end = item.end;
  }

  return end === targetLength && [...validIds].every((id) => seenIds.has(id));
};

type Formatting = Record<string, unknown>;

const referenceInlineKey = (formatting: Formatting): string =>
  JSON.stringify({
    color: formatting.color,
    fontWeight: formatting.fontWeight,
    fontStyle: formatting.fontStyle,
    decoration: formatting.decoration,
    strikethrough: formatting.strikethrough,
    link: formatting.link,
  });

const referenceParagraph = (formatting: Formatting): Formatting => {
  const result: Formatting = {};
  if (formatting.fontRef !== undefined) result.fontRef = formatting.fontRef;
  if (formatting.fontSize !== undefined) result.fontSize = formatting.fontSize;
  if (formatting.letterSpacingEm !== undefined)
    result.letterSpacingEm = formatting.letterSpacingEm;
  if (formatting.lineHeightEm !== undefined) result.lineHeightEm = formatting.lineHeightEm;
  if (formatting.textAlign !== undefined) result.textAlign = formatting.textAlign;
  if (formatting.listLevel !== undefined) result.listLevel = formatting.listLevel;
  if (formatting.listMarker !== undefined) result.listMarker = formatting.listMarker;
  return result;
};

const referenceRequires = (snapshots: readonly Formatting[]): boolean =>
  new Set(
    snapshots.map((formatting) =>
      JSON.stringify([referenceInlineKey(formatting), referenceParagraph(formatting)]),
    ),
  ).size > 1;

// ---------------------------------------------------------------------------
// Drift sentinel
// ---------------------------------------------------------------------------

/** SHA-256 of the whitespace-collapsed frontend block this mirror was written against. */
const FRONTEND_BLOCK_FINGERPRINT =
  "d51bbeb8139b646d0b7d348b134d31167adc9676a855e1ff183c67b7904a5530";

const frontendSourcePath = fileURLToPath(
  new URL("../../../../../src/intents/design_editor/translation_review.ts", import.meta.url),
);

const readFrontendBlock = (): string | undefined => {
  try {
    const source = readFileSync(frontendSourcePath, "utf8");
    const start = source.indexOf("const inlineFormattingKey = (");
    const end = source.indexOf("export const buildPageReview");
    return start < 0 || end < start ? "" : source.slice(start, end);
  } catch {
    return undefined;
  }
};

const frontendBlock = readFrontendBlock();

describe("frontend contract drift sentinel", () => {
  it.skipIf(frontendBlock === undefined)(
    "the mirrored frontend source block is unchanged",
    () => {
      const collapsed = (frontendBlock ?? "").replace(/\s+/g, " ").trim();
      expect(collapsed.length).toBeGreaterThan(0);
      const fingerprint = createHash("sha256").update(collapsed, "utf8").digest("hex");
      // If this fails, the frontend contract changed. Re-read
      // hasCompleteFormattingProjection and requiresFormattingProjection,
      // update formatting_contract.ts and the reference port above, and only
      // then update FRONTEND_BLOCK_FINGERPRINT.
      expect(fingerprint).toBe(FRONTEND_BLOCK_FINGERPRINT);
    },
  );
});

// ---------------------------------------------------------------------------
// Accepted mappings
// ---------------------------------------------------------------------------

describe("checkFormattingContract: complete mappings", () => {
  it("accepts one region covering the whole text", () => {
    expect(
      check({
        sourceRegionIds: ["fmt-0"],
        requiresProjection: false,
        targetFormattingRegions: [region("fmt-0", 0, 6)],
      }),
    ).toEqual({ complete: true });
  });

  it("accepts multiple contiguous regions", () => {
    expect(
      check({ targetFormattingRegions: [region("fmt-0", 0, 2), region("fmt-1", 2, 6)] }),
    ).toEqual({ complete: true });
    expect(
      check({
        sourceRegionIds: THREE,
        targetFormattingRegions: [region("fmt-0", 0, 1), region("fmt-1", 1, 4), region("fmt-2", 4, 6)],
      }),
    ).toEqual({ complete: true });
  });

  it("accepts a marker/body split", () => {
    const translated = `${STAR} Work the other arm in the same way.`;
    const marker = `${STAR} `;
    expect(
      check({
        translated,
        targetFormattingRegions: [region("fmt-0", 0, marker.length), region("fmt-1", marker.length, translated.length)],
      }),
    ).toEqual({ complete: true });
  });

  it("accepts a region id that repeats in non-adjacent runs, as the frontend does", () => {
    const regions = [region("fmt-0", 0, 2), region("fmt-1", 2, 4), region("fmt-0", 4, 6)];
    expect(check({ targetFormattingRegions: regions })).toEqual({ complete: true });
  });

  it("accepts an id that repeats in adjacent runs, and only advises about it", () => {
    const regions = [region("fmt-0", 0, 3), region("fmt-0", 3, 4), region("fmt-1", 4, 6)];
    expect(check({ targetFormattingRegions: regions })).toEqual({ complete: true });
    expect(
      formattingContractAdvisories({ targetFormattingRegions: regions }).map(({ code }) => code),
    ).toEqual(["ADJACENT_SAME_ID_RUNS"]);
  });

  it("checks a supplied map even when the source styles are uniform", () => {
    expect(
      codeOf(
        check({
          requiresProjection: false,
          targetFormattingRegions: [region("fmt-0", 0, 3)],
        }),
      ),
    ).toBe("COVERAGE_INCOMPLETE");
  });

  it("accepts absent or empty regions only when no projection is required", () => {
    expect(check({ requiresProjection: false })).toEqual({ complete: true });
    expect(check({ requiresProjection: false, targetFormattingRegions: [] })).toEqual({
      complete: true,
    });
    expect(codeOf(check({ requiresProjection: true }))).toBe("MAPPING_REQUIRED_BUT_ABSENT");
    expect(codeOf(check({ requiresProjection: true, targetFormattingRegions: [] }))).toBe(
      "MAPPING_REQUIRED_BUT_ABSENT",
    );
  });

  it("ignores projection tag and absorbed ids when there are no regions, as the frontend does", () => {
    expect(
      check({
        requiresProjection: false,
        formattingProjection: "anything",
        absorbedFormattingRegionIds: ["not-a-region", "not-a-region"],
      }),
    ).toEqual({ complete: true });
  });
});

// ---------------------------------------------------------------------------
// Rejected mappings (fail closed)
// ---------------------------------------------------------------------------

describe("checkFormattingContract: rejected mappings", () => {
  const rejected: [string, Partial<FormattingContractInput>, string][] = [
    ["an overlap", { targetFormattingRegions: [region("fmt-0", 0, 4), region("fmt-1", 3, 6)] }, "REGION_START_BEFORE_CURSOR"],
    ["a gap between regions", { targetFormattingRegions: [region("fmt-0", 0, 2), region("fmt-1", 3, 6)] }, "REGION_START_AFTER_CURSOR"],
    ["a gap at the start", { targetFormattingRegions: [region("fmt-0", 1, 3), region("fmt-1", 3, 6)] }, "REGION_START_AFTER_CURSOR"],
    ["a negative start", { targetFormattingRegions: [region("fmt-0", -1, 3), region("fmt-1", 3, 6)] }, "REGION_START_BEFORE_CURSOR"],
    ["regions out of order", { targetFormattingRegions: [region("fmt-1", 3, 6), region("fmt-0", 0, 3)] }, "REGION_START_AFTER_CURSOR"],
    ["an end beyond the translated length", { targetFormattingRegions: [region("fmt-0", 0, 3), region("fmt-1", 3, 7)] }, "REGION_END_BEYOND_TARGET"],
    ["a start greater than its end", { targetFormattingRegions: [region("fmt-0", 0, 3), region("fmt-1", 3, 2)] }, "REGION_END_BEFORE_START"],
    ["a non-integer start", { targetFormattingRegions: [region("fmt-0", 0, 3), region("fmt-1", 3.5, 6)] }, "REGION_BOUNDS_NOT_INTEGER"],
    ["a NaN end", { targetFormattingRegions: [region("fmt-0", 0, Number.NaN), region("fmt-1", 3, 6)] }, "REGION_BOUNDS_NOT_INTEGER"],
    ["an infinite end", { targetFormattingRegions: [region("fmt-0", 0, Number.POSITIVE_INFINITY)] }, "REGION_BOUNDS_NOT_INTEGER"],
    ["an unknown region id", { targetFormattingRegions: [region("fmt-0", 0, 3), region("fmt-9", 3, 6)] }, "REGION_ID_UNKNOWN"],
    ["an id that is not fmt-shaped", { targetFormattingRegions: [region("marker", 0, 3), region("fmt-1", 3, 6)] }, "REGION_ID_UNKNOWN"],
    ["coverage that stops short", { targetFormattingRegions: [region("fmt-0", 0, 2), region("fmt-1", 2, 5)] }, "COVERAGE_INCOMPLETE"],
    ["a missing source region", { targetFormattingRegions: [region("fmt-0", 0, 6)] }, "SOURCE_REGION_MISSING"],
    ["a source region that never appears (three sources, two used)", { sourceRegionIds: THREE, targetFormattingRegions: [region("fmt-0", 0, 3), region("fmt-1", 3, 6)] }, "SOURCE_REGION_MISSING"],
  ];

  it.each(rejected)("rejects %s", (_label, overrides, expectedCode) => {
    const result = check(overrides);
    expect(result.complete).toBe(false);
    expect(codeOf(result)).toBe(expectedCode);
    expect(isFormattingContractComplete({ sourceRegionIds: TWO, requiresProjection: true, translated: TEXT, ...overrides })).toBe(false);
  });

  it("reports the index of the offending region", () => {
    const result = check({
      targetFormattingRegions: [region("fmt-0", 0, 2), region("fmt-1", 2, 4), region("fmt-9", 4, 6)],
    });
    expect(result).toMatchObject({ complete: false, issue: { code: "REGION_ID_UNKNOWN", regionIndex: 2 } });
  });

  it("never mutates its input and never returns a repaired map", () => {
    const regions = Object.freeze([
      Object.freeze(region("fmt-1", 3, 6)),
      Object.freeze(region("fmt-0", 0, 3)),
    ]);
    const absorbed = Object.freeze(["fmt-0"]);
    const input = Object.freeze({
      sourceRegionIds: Object.freeze([...TWO]),
      requiresProjection: true,
      translated: TEXT,
      targetFormattingRegions: regions,
      formattingProjection: ATOMIC_COLLAPSE,
      absorbedFormattingRegionIds: absorbed,
    });
    const first = checkFormattingContract(input);
    const second = checkFormattingContract(input);
    expect(first).toEqual(second);
    expect(first.complete).toBe(false);
    expect(Object.keys(first).sort()).toEqual(["complete", "issue"]);
    expect(regions.map(({ id }) => id)).toEqual(["fmt-1", "fmt-0"]);
  });

  it("rejects duplicate source ids as a bad oracle input instead of guessing", () => {
    expect(() => check({ sourceRegionIds: ["fmt-0", "fmt-0"] })).toThrow(FormattingContractError);
  });
});

// ---------------------------------------------------------------------------
// Zero-width and absorbed regions
// ---------------------------------------------------------------------------

describe("zero-width regions and absorbed ids", () => {
  const collapsed = [region("fmt-0", 0, 6), region("fmt-1", 6, 6), region("fmt-2", 6, 6)];

  it("accepts an atomic-collapse projection with absorbed zero-width regions", () => {
    expect(
      check({
        sourceRegionIds: THREE,
        targetFormattingRegions: collapsed,
        formattingProjection: ATOMIC_COLLAPSE,
        absorbedFormattingRegionIds: ["fmt-1", "fmt-2"],
      }),
    ).toEqual({ complete: true });
  });

  const invalid: [string, Partial<FormattingContractInput>, string][] = [
    ["a zero-width region with no projection tag", { absorbedFormattingRegionIds: ["fmt-1", "fmt-2"] }, "ZERO_WIDTH_UNPROVEN"],
    ["a zero-width region with the tag but no absorbed ids", { formattingProjection: ATOMIC_COLLAPSE }, "ZERO_WIDTH_UNPROVEN"],
    ["a zero-width region absorbed under a different id", { formattingProjection: ATOMIC_COLLAPSE, absorbedFormattingRegionIds: ["fmt-1"] }, "ZERO_WIDTH_UNPROVEN"],
    ["an unrecognized projection tag", { formattingProjection: "atomic", absorbedFormattingRegionIds: ["fmt-1", "fmt-2"] }, "ZERO_WIDTH_UNPROVEN"],
    ["a differently cased projection tag", { formattingProjection: "ATOMIC_COLLAPSE", absorbedFormattingRegionIds: ["fmt-1", "fmt-2"] }, "ZERO_WIDTH_UNPROVEN"],
    ["an absorbed id that is not a source region", { formattingProjection: ATOMIC_COLLAPSE, absorbedFormattingRegionIds: ["fmt-1", "fmt-2", "fmt-9"] }, "ABSORBED_ID_UNKNOWN"],
    ["an absorbed id listed twice", { formattingProjection: ATOMIC_COLLAPSE, absorbedFormattingRegionIds: ["fmt-1", "fmt-2", "fmt-2"] }, "ABSORBED_ID_DUPLICATE"],
  ];

  it.each(invalid)("rejects %s", (_label, overrides, expectedCode) => {
    expect(
      codeOf(check({ sourceRegionIds: THREE, targetFormattingRegions: collapsed, ...overrides })),
    ).toBe(expectedCode);
  });

  it("checks absorbed ids before it looks at any region", () => {
    expect(
      codeOf(
        check({
          targetFormattingRegions: [region("fmt-9", 0, 6)],
          absorbedFormattingRegionIds: ["fmt-7"],
        }),
      ),
    ).toBe("ABSORBED_ID_UNKNOWN");
  });

  it("requires an absorbed source region to still appear in the map", () => {
    expect(
      codeOf(
        check({
          sourceRegionIds: THREE,
          targetFormattingRegions: [region("fmt-0", 0, 6), region("fmt-1", 6, 6)],
          formattingProjection: ATOMIC_COLLAPSE,
          absorbedFormattingRegionIds: ["fmt-1", "fmt-2"],
        }),
      ),
    ).toBe("SOURCE_REGION_MISSING");
  });

  it("does not require an absorbed id to be zero-width, but advises about it", () => {
    const input = {
      targetFormattingRegions: [region("fmt-0", 0, 3), region("fmt-1", 3, 6)],
      formattingProjection: ATOMIC_COLLAPSE,
      absorbedFormattingRegionIds: ["fmt-1"],
    };
    expect(check(input)).toEqual({ complete: true });
    expect(formattingContractAdvisories(input).map(({ code }) => code)).toEqual([
      "ABSORBED_ID_HAS_WIDTH",
    ]);
  });

  it("does not require the tag to accompany absorbed ids when nothing is zero-width, but advises about it", () => {
    const input = {
      targetFormattingRegions: [region("fmt-0", 0, 3), region("fmt-1", 3, 6)],
      absorbedFormattingRegionIds: ["fmt-1"],
    };
    expect(check(input)).toEqual({ complete: true });
    expect(formattingContractAdvisories(input).map(({ code }) => code)).toEqual([
      "ABSORBED_ID_HAS_WIDTH",
      "ABSORBED_WITHOUT_ATOMIC_COLLAPSE",
    ]);
  });

  it("rejects a zero-width absorbed region when the tag is missing, and advises too", () => {
    const input = {
      targetFormattingRegions: [region("fmt-0", 0, 6), region("fmt-1", 6, 6)],
      absorbedFormattingRegionIds: ["fmt-1"],
    };
    expect(codeOf(check(input))).toBe("ZERO_WIDTH_UNPROVEN");
    expect(formattingContractAdvisories(input).map(({ code }) => code)).toEqual([
      "ABSORBED_WITHOUT_ATOMIC_COLLAPSE",
    ]);
  });

  it("flags an unknown projection value as an advisory without changing the contract", () => {
    const input = {
      targetFormattingRegions: [region("fmt-0", 0, 3), region("fmt-1", 3, 6)],
      formattingProjection: "semantic",
    };
    expect(check(input)).toEqual({ complete: true });
    expect(formattingContractAdvisories(input).map(({ code }) => code)).toEqual([
      "UNKNOWN_PROJECTION_VALUE",
    ]);
  });

  it("has no advisories for a backend-shaped atomic collapse", () => {
    expect(
      formattingContractAdvisories({
        targetFormattingRegions: collapsed,
        formattingProjection: ATOMIC_COLLAPSE,
        absorbedFormattingRegionIds: ["fmt-1", "fmt-2"],
      }),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Empty text and Unicode
// ---------------------------------------------------------------------------

describe("empty translated text", () => {
  it("accepts no map for uniform styles and requires one for mixed styles", () => {
    expect(check({ translated: "", sourceRegionIds: ["fmt-0"], requiresProjection: false })).toEqual({
      complete: true,
    });
    expect(codeOf(check({ translated: "", requiresProjection: true }))).toBe(
      "MAPPING_REQUIRED_BUT_ABSENT",
    );
  });

  it("accepts a fully absorbed zero-width map of length zero", () => {
    expect(
      check({
        translated: "",
        sourceRegionIds: ["fmt-0"],
        requiresProjection: false,
        targetFormattingRegions: [region("fmt-0", 0, 0)],
        formattingProjection: ATOMIC_COLLAPSE,
        absorbedFormattingRegionIds: ["fmt-0"],
      }),
    ).toEqual({ complete: true });
  });

  it("rejects an unproven zero-width map and a non-empty map on empty text", () => {
    expect(
      codeOf(
        check({
          translated: "",
          sourceRegionIds: ["fmt-0"],
          targetFormattingRegions: [region("fmt-0", 0, 0)],
        }),
      ),
    ).toBe("ZERO_WIDTH_UNPROVEN");
    expect(
      codeOf(
        check({
          translated: "",
          sourceRegionIds: ["fmt-0"],
          targetFormattingRegions: [region("fmt-0", 0, 3)],
        }),
      ),
    ).toBe("REGION_END_BEYOND_TARGET");
  });
});

describe("offsets are UTF-16 code units and text is never normalized", () => {
  it("counts an astral character as two units", () => {
    const translated = `a${EMOJI}b`;
    expect(translated.length).toBe(4);
    expect(
      check({ translated, targetFormattingRegions: [region("fmt-0", 0, 3), region("fmt-1", 3, 4)] }),
    ).toEqual({ complete: true });
    expect(
      codeOf(check({ translated, targetFormattingRegions: [region("fmt-0", 0, 2), region("fmt-1", 2, 5)] })),
    ).toBe("REGION_END_BEYOND_TARGET");
  });

  it("accepts a boundary inside a surrogate pair as the frontend does, but the remap precondition does not", () => {
    const translated = `a${EMOJI}b`;
    const split = [region("fmt-0", 0, 2), region("fmt-1", 2, 4)];
    expect(check({ translated, targetFormattingRegions: split })).toEqual({ complete: true });
    const refusal = checkRemapPreconditions(translated, split);
    expect(refusal?.code).toBe("REMAP_INVALID_TEMPLATE");
    expect(refusal?.message).toContain("code point boundary");
    expect(checkRemapPreconditions(translated, [region("fmt-0", 0, 3), region("fmt-1", 3, 4)])).toBeNull();
  });

  it("does not normalize: a decomposed letter is two units and is not repaired to one", () => {
    expect(S_CEDILLA_COMPOSED.length).toBe(1);
    expect(S_CEDILLA_DECOMPOSED.length).toBe(2);
    expect(S_CEDILLA_DECOMPOSED.normalize("NFC")).toBe(S_CEDILLA_COMPOSED);

    const oneUnit = [region("fmt-0", 0, 1)];
    const twoUnits = [region("fmt-0", 0, 2)];
    const single = { sourceRegionIds: ["fmt-0"], requiresProjection: false };
    expect(isFormattingContractComplete({ ...single, translated: S_CEDILLA_COMPOSED, targetFormattingRegions: oneUnit })).toBe(true);
    expect(isFormattingContractComplete({ ...single, translated: S_CEDILLA_DECOMPOSED, targetFormattingRegions: oneUnit })).toBe(false);
    expect(isFormattingContractComplete({ ...single, translated: S_CEDILLA_DECOMPOSED, targetFormattingRegions: twoUnits })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Remap precondition
// ---------------------------------------------------------------------------

describe("checkRemapPreconditions", () => {
  it("accepts a contiguous, complete, code-point-aligned template, zero-width included", () => {
    expect(checkRemapPreconditions(TEXT, [region("fmt-0", 0, 6), region("fmt-1", 6, 6)])).toBeNull();
  });

  it.each([
    ["no regions", []],
    ["a gap", [region("fmt-0", 0, 2), region("fmt-1", 3, 6)]],
    ["an overlap", [region("fmt-0", 0, 4), region("fmt-1", 3, 6)]],
    ["a start after zero", [region("fmt-0", 1, 6)]],
    ["a short template", [region("fmt-0", 0, 5)]],
    ["an end before its start", [region("fmt-0", 0, 3), region("fmt-1", 3, 2)]],
  ])("rejects %s", (_label, regions) => {
    expect(checkRemapPreconditions(TEXT, regions)?.code).toBe("REMAP_INVALID_TEMPLATE");
  });
});

// ---------------------------------------------------------------------------
// Styled slices
// ---------------------------------------------------------------------------

describe("styledSlices", () => {
  it("returns the marker and body text without relying on numeric offsets in the assertion", () => {
    const marker = `${STAR} `;
    const body = "Work the other arm in the same way.";
    expect(
      styledSlices(`${marker}${body}`, [region("fmt-0", 0, marker.length), region("fmt-1", marker.length, marker.length + body.length)]),
    ).toEqual([
      { regionId: "fmt-0", text: marker },
      { regionId: "fmt-1", text: body },
    ]);
  });

  it("returns one entry per run, in the given order, never merged or sorted", () => {
    expect(
      styledSlices(TEXT, [region("fmt-0", 0, 2), region("fmt-1", 2, 4), region("fmt-0", 4, 6)]),
    ).toEqual([
      { regionId: "fmt-0", text: "ab" },
      { regionId: "fmt-1", text: "cd" },
      { regionId: "fmt-0", text: "ef" },
    ]);
    expect(styledSlices(TEXT, [region("fmt-1", 3, 6), region("fmt-0", 0, 3)]).map(({ regionId }) => regionId)).toEqual([
      "fmt-1",
      "fmt-0",
    ]);
  });

  it("gives an empty string for a zero-width absorbed region", () => {
    expect(styledSlices(TEXT, [region("fmt-0", 0, 6), region("fmt-1", 6, 6)])).toEqual([
      { regionId: "fmt-0", text: TEXT },
      { regionId: "fmt-1", text: "" },
    ]);
  });

  it("concatenates back to the translated text for a complete map", () => {
    const regions = [region("fmt-0", 0, 1), region("fmt-1", 1, 4), region("fmt-0", 4, 6)];
    expect(check({ targetFormattingRegions: regions })).toEqual({ complete: true });
    expect(styledSlices(TEXT, regions).map(({ text }) => text).join("")).toBe(TEXT);
  });

  it("is deterministic and does not mutate its input", () => {
    const regions = Object.freeze([Object.freeze(region("fmt-0", 0, 3)), Object.freeze(region("fmt-1", 3, 6))]);
    const first = styledSlices(TEXT, regions);
    const second = styledSlices(TEXT, regions);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    first[0] = { regionId: "changed", text: "changed" };
    expect(styledSlices(TEXT, regions)[0]).toEqual({ regionId: "fmt-0", text: "abc" });
  });

  it("slices by UTF-16 offsets, so a region can cover an astral character whole", () => {
    expect(styledSlices(`a${EMOJI}b`, [region("fmt-0", 0, 3), region("fmt-1", 3, 4)])).toEqual([
      { regionId: "fmt-0", text: `a${EMOJI}` },
      { regionId: "fmt-1", text: "b" },
    ]);
  });

  it.each([
    ["a negative start", region("fmt-0", -1, 2)],
    ["an end past the text", region("fmt-0", 0, 7)],
    ["a start after its end", region("fmt-0", 4, 2)],
    ["a fractional bound", region("fmt-0", 0.5, 2)],
    ["a NaN bound", region("fmt-0", 0, Number.NaN)],
  ])("throws for %s instead of clamping", (_label, bad) => {
    expect(() => styledSlices(TEXT, [bad])).toThrow(FormattingContractError);
  });

  it("returns an empty list for no regions", () => {
    expect(styledSlices(TEXT, [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// requiresFormattingProjection
// ---------------------------------------------------------------------------

describe("requiresFormattingProjection", () => {
  const styles = (...list: Record<string, unknown>[]) =>
    list.map((style, index) => ({ regionId: `fmt-${index}`, style }));
  const ids = (count: number) => frontendRegionIds(count);

  it("is false for zero, one or identical regions", () => {
    expect(requiresFormattingProjection([], [])).toBe(false);
    expect(requiresFormattingProjection(ids(1), styles({ color: "#000000" }))).toBe(false);
    expect(
      requiresFormattingProjection(ids(2), styles({ color: "#000000" }, { color: "#000000" })),
    ).toBe(false);
  });

  it("is true for the salmon marker plus black body split", () => {
    expect(
      requiresFormattingProjection(
        ids(2),
        styles({ color: "#c97569", fontStyle: "italic" }, { color: "#000000" }),
      ),
    ).toBe(true);
  });

  it("ignores attributes the frontend does not compare", () => {
    expect(
      requiresFormattingProjection(
        ids(2),
        styles({ color: "#000000", note: "a" }, { color: "#000000", note: "b" }),
      ),
    ).toBe(false);
  });

  it("counts paragraph attributes", () => {
    expect(
      requiresFormattingProjection(ids(2), styles({ textAlign: "start" }, { textAlign: "center" })),
    ).toBe(true);
  });

  it("treats undefined as absent, null as a value, and a missing entry as an empty style", () => {
    expect(
      requiresFormattingProjection(ids(2), styles({ color: "#000000", fontSize: undefined }, { color: "#000000" })),
    ).toBe(false);
    expect(requiresFormattingProjection(ids(2), styles({ color: null }, {}))).toBe(true);
    expect(requiresFormattingProjection(ids(2), styles({ color: "#000000" }))).toBe(true);
    expect(requiresFormattingProjection(ids(2), styles({}))).toBe(false);
  });

  it("does not depend on attribute insertion order", () => {
    expect(
      requiresFormattingProjection(
        ids(2),
        styles({ color: "#000000", fontWeight: "bold" }, { fontWeight: "bold", color: "#000000" }),
      ),
    ).toBe(false);
  });

  it("uses exactly the thirteen attributes the frontend compares", () => {
    expect([...PROJECTION_STYLE_KEYS]).toEqual([
      "color",
      "fontWeight",
      "fontStyle",
      "decoration",
      "strikethrough",
      "link",
      "fontRef",
      "fontSize",
      "letterSpacingEm",
      "lineHeightEm",
      "textAlign",
      "listLevel",
      "listMarker",
    ]);
  });
});

describe("region id convention", () => {
  it("recognizes fmt-0 .. fmt-(n-1) in order only", () => {
    expect(frontendRegionIds(3)).toEqual(THREE);
    expect(followsFrontendRegionIdConvention(THREE)).toBe(true);
    expect(followsFrontendRegionIdConvention([])).toBe(true);
    expect(followsFrontendRegionIdConvention(["fmt-1", "fmt-0"])).toBe(false);
    expect(followsFrontendRegionIdConvention(["a", "b"])).toBe(false);
    expect(followsFrontendRegionIdConvention(["fmt-0", "fmt-0"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Differential tests against the literal frontend port
// ---------------------------------------------------------------------------

describe("mirror equals the frontend port", () => {
  const compare = (
    ids: readonly string[],
    requires: boolean,
    length: number,
    regions: readonly TargetRegion[],
    projection: string | undefined,
    absorbed: readonly string[] | undefined,
  ): boolean => {
    const translated = "x".repeat(length);
    const mirrored = checkFormattingContract({
      sourceRegionIds: ids,
      requiresProjection: requires,
      translated,
      targetFormattingRegions: regions,
      formattingProjection: projection,
      absorbedFormattingRegionIds: absorbed,
    });
    const reference = referenceHasComplete(ids.length, requires, regions, length, projection, absorbed);
    if (mirrored.complete !== reference) {
      throw new Error(
        `Mirror ${mirrored.complete} vs frontend ${reference}: ${JSON.stringify({ ids, requires, length, regions, projection, absorbed })}`,
      );
    }
    if (!mirrored.complete && mirrored.issue.message.length === 0) {
      throw new Error("A rejection must carry a reason.");
    }
    return reference;
  };

  const projections: (string | undefined)[] = [undefined, ATOMIC_COLLAPSE, "other"];

  it("agrees on every one- and two-region map over a small exhaustive grid", () => {
    const ids = ["fmt-0", "fmt-1", "zz"];
    const coordinates = [-1, 0, 1, 2, 3];
    const prototypes: TargetRegion[] = ids.flatMap((id) =>
      coordinates.flatMap((start) => coordinates.map((end) => region(id, start, end))),
    );
    const lists: TargetRegion[][] = [[]];
    for (const first of prototypes) {
      lists.push([first]);
      for (const second of prototypes) lists.push([first, second]);
    }
    const absorbedOptions: (readonly string[] | undefined)[] = [
      undefined,
      [],
      ["fmt-1"],
      ["fmt-1", "fmt-1"],
      ["zz"],
    ];

    let evaluations = 0;
    let complete = 0;
    for (const sourceIds of [["fmt-0"], TWO]) {
      for (const requires of [true, false]) {
        for (const length of [0, 3]) {
          for (const projection of projections) {
            for (const absorbed of absorbedOptions) {
              for (const list of lists) {
                evaluations += 1;
                if (compare(sourceIds, requires, length, list, projection, absorbed)) complete += 1;
              }
            }
          }
        }
      }
    }
    expect(evaluations).toBe(684_120);
    expect(complete).toBeGreaterThan(100);
  }, 60_000);

  it("agrees on every three-region map over a reduced grid", () => {
    const prototypes: TargetRegion[] = ["fmt-0", "fmt-1"].flatMap((id) =>
      [0, 1, 2, 3].flatMap((start) => [0, 1, 2, 3].map((end) => region(id, start, end))),
    );
    const absorbedOptions: (readonly string[] | undefined)[] = [undefined, ["fmt-1"], ["fmt-2"]];
    let evaluations = 0;
    let complete = 0;
    for (const first of prototypes) {
      for (const second of prototypes) {
        for (const third of prototypes) {
          for (const sourceIds of [TWO, THREE]) {
            for (const projection of [undefined, ATOMIC_COLLAPSE]) {
              for (const absorbed of absorbedOptions) {
                evaluations += 1;
                if (compare(sourceIds, true, 3, [first, second, third], projection, absorbed)) complete += 1;
              }
            }
          }
        }
      }
    }
    expect(evaluations).toBe(393_216);
    expect(complete).toBeGreaterThan(20);
  }, 60_000);

  it("agrees on requiresFormattingProjection over every list of up to three styles", () => {
    const pool: Formatting[] = [
      {},
      { color: "#000000" },
      { color: "#c97569", fontStyle: "italic" },
      { color: "#000000", note: "ignored" },
      { color: null },
      { textAlign: "start" },
      { fontSize: 12 },
      { color: "#000000", fontSize: undefined },
    ];
    const lists: Formatting[][] = [[]];
    for (const a of pool) {
      lists.push([a]);
      for (const b of pool) {
        lists.push([a, b]);
        for (const c of pool) lists.push([a, b, c]);
      }
    }
    for (const list of lists) {
      const mirrored = requiresFormattingProjection(
        frontendRegionIds(list.length),
        list.map((style, index) => ({ regionId: `fmt-${index}`, style })),
      );
      expect(mirrored).toBe(referenceRequires(list));
    }
    expect(lists.length).toBe(1 + 8 + 64 + 512);
  });

  it("agrees on every frontend test scenario for the two-style abcdef block", () => {
    const scenarios: [TargetRegion[], string | undefined, boolean][] = [
      [[region("fmt-0", 0, 3), region("fmt-1", 3, 3)], undefined, false],
      [[region("fmt-0", 0, 6)], ATOMIC_COLLAPSE, false],
      [[region("fmt-0", 0, 4), region("fmt-1", 3, 6)], ATOMIC_COLLAPSE, false],
      [[region("fmt-0", 0, 2), region("fmt-1", 3, 6)], ATOMIC_COLLAPSE, false],
      [[region("fmt-0", 0, 6), region("fmt-1", 6, 6)], ATOMIC_COLLAPSE, false],
      [[region("fmt-0", 0, 3), region("fmt-1", 3, 6)], undefined, true],
    ];
    for (const [regions, projection, expected] of scenarios) {
      expect(compare(TWO, true, 6, regions, projection, undefined)).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// Hermeticity
// ---------------------------------------------------------------------------

describe("formatting_contract.ts is a dependency-free oracle", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./formatting_contract.ts", import.meta.url)),
    "utf8",
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("has no imports at all", () => {
    expect([...code.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)]).toEqual([]);
    expect(code).not.toMatch(/^\s*import\s/m);
  });

  it("does not touch the environment, clock, randomness, network or locale defaults", () => {
    expect(code).not.toMatch(/process\.|Date\.now|new Date\(|Math\.random|fetch\s*\(|localeCompare|Intl\.|\.normalize\(/);
  });
});
