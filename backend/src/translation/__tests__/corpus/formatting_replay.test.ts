/**
 * Stage 0, Option 2: tests for the split formatting checks.
 *
 * Geometry is always checked. The style-dependent frontend verdict is checked
 * only when `regionStyles` exist; when they are absent it is evaluated under
 * both possible answers and reported as NOT EVALUATED when the answers differ.
 * Missing styles are never treated as uniform and no style object is invented.
 */
import { describe, expect, it } from "vitest";
import { blockScopedStyledSlices, formattingReport, type FormattingReplayCase } from "./formatting_replay.js";
import type { ExpectedResult } from "./schema.js";

const TEXT = "abcd";
const TWO = [
  { id: "fmt-0", start: 0, end: 2 },
  { id: "fmt-1", start: 2, end: 4 },
];

const request = (
  regions: { id: string; start: number; end: number }[] = TWO,
): FormattingReplayCase["request"] => ({
  targetLanguage: "en",
  blocks: [{ id: "b1", text: TEXT, formattingRegions: regions }],
});

const result = (overrides: Partial<ExpectedResult> = {}): ExpectedResult => ({
  id: "b1",
  source: TEXT,
  translated: TEXT,
  valid: true,
  errorCodes: [],
  warningCodes: [],
  ...overrides,
});

const uniform = [
  { blockId: "b1", regionId: "fmt-0", style: { color: "#111111" } },
  { blockId: "b1", regionId: "fmt-1", style: { color: "#111111" } },
];
const mixed = [
  { blockId: "b1", regionId: "fmt-0", style: { color: "#111111" } },
  { blockId: "b1", regionId: "fmt-1", style: { color: "#222222" } },
];

describe("formattingReport: geometry without regionStyles", () => {
  it("accepts mapped geometry and evaluates it (no style is needed)", () => {
    const report = formattingReport({ request: request() }, [result({ targetFormattingRegions: TWO })]);
    expect(report).toEqual({ findings: [], notEvaluated: [] });
  });

  it("reports geometry violations even though styles are absent", () => {
    const gap = formattingReport({ request: request() }, [
      result({
        targetFormattingRegions: [
          { id: "fmt-0", start: 0, end: 1 },
          { id: "fmt-1", start: 2, end: 4 },
        ],
      }),
    ]);
    expect(gap.findings).toHaveLength(1);
    expect(gap.findings[0]).toMatch(/REGION_START_AFTER_CURSOR/);
    expect(gap.notEvaluated).toEqual([]);

    const short = formattingReport({ request: request() }, [
      result({ targetFormattingRegions: [{ id: "fmt-0", start: 0, end: 2 }] }),
    ]);
    expect(short.findings[0]).toMatch(/COVERAGE_INCOMPLETE/);

    const unknown = formattingReport({ request: request() }, [
      result({ targetFormattingRegions: [{ id: "fmt-7", start: 0, end: 4 }] }),
    ]);
    expect(unknown.findings[0]).toMatch(/REGION_ID_UNKNOWN/);
  });

  it("still checks zero-width provenance without styles", () => {
    const report = formattingReport({ request: request() }, [
      result({
        targetFormattingRegions: [
          { id: "fmt-0", start: 0, end: 0 },
          { id: "fmt-1", start: 0, end: 4 },
        ],
      }),
    ]);
    expect(report.findings[0]).toMatch(/ZERO_WIDTH_UNPROVEN/);

    const proven = formattingReport({ request: request() }, [
      result({
        targetFormattingRegions: [
          { id: "fmt-0", start: 0, end: 0 },
          { id: "fmt-1", start: 0, end: 4 },
        ],
        formattingProjection: "atomic_collapse",
        absorbedFormattingRegionIds: ["fmt-0"],
      }),
    ]);
    expect(proven).toEqual({ findings: [], notEvaluated: [] });
  });
});

describe("formattingReport: the style-dependent verdict", () => {
  it("is NOT EVALUATED for several source regions, a valid result and no target regions, when styles are absent", () => {
    const report = formattingReport({ request: request() }, [result()]);
    expect(report.findings).toEqual([]);
    expect(report.notEvaluated).toHaveLength(1);
    expect(report.notEvaluated[0]).toMatchObject({ blockId: "b1", regionCount: 2 });
    expect(report.notEvaluated[0]?.reason).toMatch(/not evaluated/);
  });

  it("does not treat missing styles as uniform: the same result is not silently a pass", () => {
    const missing = formattingReport({ request: request() }, [result()]);
    const assumedUniform = formattingReport({ request: request(), regionStyles: uniform }, [result()]);
    expect(assumedUniform).toEqual({ findings: [], notEvaluated: [] });
    expect(missing).not.toEqual(assumedUniform);
  });

  it("does not treat missing styles as mixed either: it is not reported as a failure", () => {
    const missing = formattingReport({ request: request() }, [result()]);
    const assumedMixed = formattingReport({ request: request(), regionStyles: mixed }, [result()]);
    expect(assumedMixed.findings[0]).toMatch(/MAPPING_REQUIRED_BUT_ABSENT/);
    expect(missing.findings).toEqual([]);
  });

  it("is decided when regionStyles are provided: uniform passes, mixed fails", () => {
    expect(formattingReport({ request: request(), regionStyles: uniform }, [result()])).toEqual({
      findings: [],
      notEvaluated: [],
    });
    const failing = formattingReport({ request: request(), regionStyles: mixed }, [result()]);
    expect(failing.notEvaluated).toEqual([]);
    expect(failing.findings).toHaveLength(1);
    expect(failing.findings[0]).toMatch(/MAPPING_REQUIRED_BUT_ABSENT/);
  });

  it("is decided without styles for a source of fewer than two regions (no projection is possible)", () => {
    const one = [{ id: "fmt-0", start: 0, end: 4 }];
    expect(formattingReport({ request: request(one) }, [result()])).toEqual({ findings: [], notEvaluated: [] });
  });

  it("is not raised for an invalid result, which the frontend never applies", () => {
    expect(formattingReport({ request: request() }, [result({ valid: false, errorCodes: ["X"] })])).toEqual({
      findings: [],
      notEvaluated: [],
    });
  });

  it("is not raised for a block without formatting regions", () => {
    const plain: FormattingReplayCase["request"] = {
      targetLanguage: "en",
      blocks: [{ id: "b1", text: TEXT }],
    };
    expect(formattingReport({ request: plain }, [result()])).toEqual({ findings: [], notEvaluated: [] });
  });

  it("reports every not-evaluated block, in request order", () => {
    const two: FormattingReplayCase["request"] = {
      targetLanguage: "en",
      blocks: [
        { id: "b1", text: TEXT, formattingRegions: TWO },
        {
          id: "b2",
          text: TEXT,
          formattingRegions: [
            { id: "fmt-2", start: 0, end: 2 },
            { id: "fmt-3", start: 2, end: 4 },
          ],
        },
      ],
    };
    const report = formattingReport({ request: two }, [result(), result({ id: "b2" })]);
    expect(report.notEvaluated.map((entry) => entry.blockId)).toEqual(["b1", "b2"]);
  });

  it("a missing result for a block is a finding, not a skip", () => {
    const report = formattingReport({ request: request() }, []);
    expect(report.findings).toEqual(["b1: no result for this block"]);
  });
});

describe("formattingReport: styled slices", () => {
  it("does not need any style value: slices depend on target regions and translated text only", () => {
    const report = formattingReport({ request: request() }, [
      result({ translated: "wxyz", targetFormattingRegions: TWO }),
    ]);
    expect(report).toEqual({ findings: [], notEvaluated: [] });
  });
});

// ---------------------------------------------------------------------------
// Block-local region identity: two blocks may both use fmt-0 and fmt-1
// without colliding, because formatting region ids are block-local (the
// frontend derives them per block, `fmt-N` over that block's own snapshot).
// ---------------------------------------------------------------------------

describe("formattingReport: block-local region identity", () => {
  const twoBlocksSharingIds: FormattingReplayCase["request"] = {
    targetLanguage: "en",
    blocks: [
      { id: "block-a", text: "abcd", formattingRegions: TWO },
      { id: "block-b", text: "wxyz", formattingRegions: TWO },
    ],
  };
  const textOf = (blockId: string): string => (blockId === "block-a" ? "abcd" : "wxyz");
  const resultFor = (blockId: string, overrides: Partial<ExpectedResult> = {}): ExpectedResult =>
    result({ id: blockId, source: textOf(blockId), translated: textOf(blockId), ...overrides });

  it("validates each block independently: one block's geometry violation does not affect the other", () => {
    const report = formattingReport({ request: twoBlocksSharingIds }, [
      resultFor("block-a", { targetFormattingRegions: TWO }),
      resultFor("block-b", {
        targetFormattingRegions: [
          { id: "fmt-0", start: 0, end: 1 },
          { id: "fmt-1", start: 2, end: 4 },
        ],
      }),
    ]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatch(/^block-b: REGION_START_AFTER_CURSOR/);
  });

  it("keeps target bounds block-local: a region fitting one block's text is not implicitly checked against another's", () => {
    // block-a's text is 4 chars; block-b's target region here goes to 4 as well
    // but against block-b's OWN (different) translated text, not a combined one.
    const report = formattingReport({ request: twoBlocksSharingIds }, [
      resultFor("block-a", { targetFormattingRegions: TWO }),
      resultFor("block-b", { translated: "wx", targetFormattingRegions: [{ id: "fmt-0", start: 0, end: 4 }] }),
    ]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatch(/^block-b: REGION_END_BEYOND_TARGET/);
  });

  it("interprets absorbedFormattingRegionIds only against the result's own block", () => {
    const zeroWidth = [
      { id: "fmt-0", start: 0, end: 0 },
      { id: "fmt-1", start: 0, end: 4 },
    ];
    // block-a proves fmt-0 as absorbed; block-b does NOT list it as absorbed,
    // so block-b's own zero-width fmt-0 must still fail on its own.
    const report = formattingReport({ request: twoBlocksSharingIds }, [
      resultFor("block-a", {
        targetFormattingRegions: zeroWidth,
        formattingProjection: "atomic_collapse",
        absorbedFormattingRegionIds: ["fmt-0"],
      }),
      resultFor("block-b", { translated: "wxyz", targetFormattingRegions: zeroWidth }),
    ]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatch(/^block-b: ZERO_WIDTH_UNPROVEN/);
  });

  it("evaluates the style-dependent verdict per block: styles known for A, unknown for B", () => {
    const report = formattingReport(
      {
        request: twoBlocksSharingIds,
        regionStyles: [
          { blockId: "block-a", regionId: "fmt-0", style: { color: "#111111" } },
          { blockId: "block-a", regionId: "fmt-1", style: { color: "#111111" } },
        ],
      },
      [resultFor("block-a"), resultFor("block-b")],
    );
    // block-a's is decided (uniform, so complete); block-b has no styles at all
    // for it, so the mapped-vs-not-mapped source-region-shape is what decides:
    // both blocks have 2 regions and no target regions, so both are style-dependent,
    // but block-a is DECIDED because its own styles are known (uniform => complete),
    // and block-b is NOT EVALUATED because nothing is known about it.
    expect(report.findings).toEqual([]);
    expect(report.notEvaluated.map((entry) => entry.blockId)).toEqual(["block-b"]);
  });

  it("keeps regionStyles for block A's fmt-0 distinct from block B's fmt-0 in the verdict", () => {
    const styledOnlyA = [
      { blockId: "block-a", regionId: "fmt-0", style: { color: "#111111" } },
      { blockId: "block-a", regionId: "fmt-1", style: { color: "#222222" } },
      { blockId: "block-b", regionId: "fmt-0", style: { color: "#333333" } },
      { blockId: "block-b", regionId: "fmt-1", style: { color: "#333333" } },
    ];
    const report = formattingReport({ request: twoBlocksSharingIds, regionStyles: styledOnlyA }, [
      resultFor("block-a"),
      resultFor("block-b"),
    ]);
    // block-a is mixed (two colors) => MAPPING_REQUIRED_BUT_ABSENT.
    // block-b is uniform (one color) => complete.
    expect(report.notEvaluated).toEqual([]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatch(/^block-a: MAPPING_REQUIRED_BUT_ABSENT/);
  });

  it("produces block-scoped styled slices that distinguish the same region id across blocks", () => {
    const slices = blockScopedStyledSlices([
      resultFor("block-a", { targetFormattingRegions: TWO }),
      resultFor("block-b", { targetFormattingRegions: TWO }),
    ]);
    expect(slices).toEqual([
      { blockId: "block-a", regionId: "fmt-0", text: "ab" },
      { blockId: "block-a", regionId: "fmt-1", text: "cd" },
      { blockId: "block-b", regionId: "fmt-0", text: "wx" },
      { blockId: "block-b", regionId: "fmt-1", text: "yz" },
    ]);
  });
});
