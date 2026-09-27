/**
 * The same-block course-decision pre-pass (next stage, Task 8).
 *
 * Each block is folded on its own from an empty PatternContext; every parsed
 * course_count gets one frozen decision (row / round / unknown, never a
 * coerced round). Invalid block ids or any error disable the whole result.
 */
import { describe, expect, it } from "vitest";
import { loadCorpus } from "../../__tests__/corpus/load_corpus.js";
import {
  lineIndexAt,
  prepareCourseDecisions,
  type BlockCourseAnalysis,
  type CourseDecisionBlock,
} from "../course_decisions.js";
import { foldPatternContext } from "../pattern_context.js";

const TURN = "12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.";
const R3_BLOCK_2 = "13) 5 sıra 16x";
const SAME_BLOCK_ROW = `${TURN}\n${R3_BLOCK_2}`;

const decide = (...blocks: CourseDecisionBlock[]) => prepareCourseDecisions(blocks);
const summary = (text: string) =>
  decide({ id: "b", text }).decisions.get("b")?.map(({ lineIndex, sourceSpan, courseKind, evidence }) => [
    lineIndex,
    sourceSpan.raw,
    courseKind,
    evidence?.sourceSpan.raw,
  ]);

describe("course decisions: shapes", () => {
  it("an empty request is enabled with no decisions", () => {
    const prepass = decide();
    expect(prepass.status).toBe("enabled");
    expect(prepass.decisions.size).toBe(0);
  });

  it("a block without a course_count has an empty decision list", () => {
    expect(summary(TURN)).toEqual([]);
  });

  it("same-block turn evidence then a continuous numbered course_count reads row, with evidence", () => {
    const prepass = decide({ id: "b", text: SAME_BLOCK_ROW });
    const [decision] = prepass.decisions.get("b")!;
    expect(decision).toEqual({
      blockId: "b",
      lineIndex: 1,
      sourceSpan: { start: TURN.length + 5, end: TURN.length + 15, raw: "5 sıra 16x" },
      courseKind: "row",
      evidence: {
        blockId: "b",
        sourceSpan: { start: 4, end: 50, raw: "Bütün sıra sonlarında 1 zincir çekip dönüyoruz" },
      },
    });
  });

  it("a marker-prefixed course_count without evidence stays unknown (never round) and has no evidence", () => {
    expect(summary(R3_BLOCK_2)).toEqual([[0, "5 sıra 16x", "unknown", undefined]]);
  });

  it("a range-marker course_count is decided like any other (unknown here)", () => {
    expect(summary("2-11) 10 sıra 64x")).toEqual([[0, "10 sıra 64x", "unknown", undefined]]);
  });

  it("a range-marker course_count continuing a turn range reads row", () => {
    expect(summary(`11-12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.\n13-17) 5 sıra 16x`)).toEqual([
      [1, "5 sıra 16x", "row", "Bütün sıra sonlarında 1 zincir çekip dönüyoruz"],
    ]);
  });

  it("decides several course_counts in one multi-line block, each on its own line", () => {
    expect(summary(`${SAME_BLOCK_ROW}\n14) 6 sıra 18x\n1) 5 sıra 16x`)).toEqual([
      [1, "5 sıra 16x", "row", "Bütün sıra sonlarında 1 zincir çekip dönüyoruz"],
      [2, "6 sıra 18x", "row", "Bütün sıra sonlarında 1 zincir çekip dönüyoruz"],
      [3, "5 sıra 16x", "unknown", undefined],
    ]);
  });

  it("agrees with a single-block PatternContext fold for every corpus block", () => {
    for (const { value } of loadCorpus().cases) {
      for (const { id, text } of value.request.blocks) {
        const kinds = prepareCourseDecisions([{ id, text }]).decisions.get(id)!.map(({ courseKind }) => courseKind);
        expect(kinds).toEqual(foldPatternContext([text])[0]!.reads.map(({ courseKind }) => courseKind));
      }
    }
  });
});

describe("course decisions: same-block scope", () => {
  it("does not carry context from block 1 to block 2 (R3 stays unknown)", () => {
    const prepass = decide({ id: "local-block-1", text: TURN }, { id: "local-block-2", text: R3_BLOCK_2 });
    expect(prepass.decisions.get("local-block-1")).toEqual([]);
    expect(prepass.decisions.get("local-block-2")!.map(({ courseKind }) => courseKind)).toEqual(["unknown"]);
    // The cross-block fold would say row: the pre-pass deliberately does not.
    expect(foldPatternContext([TURN, R3_BLOCK_2])[1]!.reads[0]!.courseKind).toBe("row");
  });

  it("gives each block the same decisions it gets alone, in any block order", () => {
    const blocks = [
      { id: "a", text: SAME_BLOCK_ROW },
      { id: "b", text: R3_BLOCK_2 },
      { id: "c", text: TURN },
    ];
    const together = prepareCourseDecisions(blocks);
    const reversed = prepareCourseDecisions([...blocks].reverse());
    for (const block of blocks) {
      const alone = prepareCourseDecisions([block]).decisions.get(block.id);
      expect(together.decisions.get(block.id)).toEqual(alone);
      expect(reversed.decisions.get(block.id)).toEqual(alone);
    }
  });
});

describe("course decisions: block identity and failure policy", () => {
  it.each([
    ["duplicate block ids", [{ id: "x", text: SAME_BLOCK_ROW }, { id: "x", text: R3_BLOCK_2 }], "duplicate_block_id"],
    ["an empty block id", [{ id: "", text: SAME_BLOCK_ROW }], "missing_block_id"],
    ["a missing block id", [{ text: SAME_BLOCK_ROW } as unknown as CourseDecisionBlock], "missing_block_id"],
  ] as const)("%s disable the whole pre-pass without throwing", (_label, blocks, reason) => {
    const prepass = prepareCourseDecisions(blocks);
    expect(prepass).toEqual({ status: "disabled", reason, blocks: new Map(), decisions: new Map() });
  });

  it("an error while analyzing disables the pre-pass instead of throwing", () => {
    const hostile = [{ id: "b", get text(): string { throw new Error("boom"); } }];
    expect(prepareCourseDecisions(hostile)).toMatchObject({ status: "disabled", reason: "prepass_error" });
  });
});

describe("course decisions: purity and immutability", () => {
  it("is deterministic across repeated runs", () => {
    const blocks = [
      { id: "a", text: SAME_BLOCK_ROW },
      { id: "b", text: R3_BLOCK_2 },
    ];
    expect(prepareCourseDecisions(blocks)).toEqual(prepareCourseDecisions(blocks));
  });

  it("reads frozen input without mutating it", () => {
    const blocks = Object.freeze([Object.freeze({ id: "a", text: SAME_BLOCK_ROW })]);
    const before = JSON.stringify(blocks);
    expect(prepareCourseDecisions(blocks).status).toBe("enabled");
    expect(JSON.stringify(blocks)).toBe(before);
  });

  it("returns frozen analyses, decisions and evidence", () => {
    const prepass = decide({ id: "a", text: SAME_BLOCK_ROW });
    const analysis = prepass.blocks.get("a")!;
    const [decision] = analysis.decisions;
    expect(Object.isFrozen(prepass)).toBe(true);
    expect(Object.isFrozen(analysis)).toBe(true);
    expect(Object.isFrozen(analysis.lineStarts)).toBe(true);
    expect(Object.isFrozen(analysis.decisions)).toBe(true);
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision!.evidence)).toBe(true);
    expect(prepass.decisions.get("a")).toBe(analysis.decisions);
  });
});

describe("course decisions: lineIndexAt", () => {
  const analysis: BlockCourseAnalysis = decide({ id: "a", text: "ab\ncd\r\nef" }).blocks.get("a")!;

  it("keeps lexical line starts (0, then each line break's end)", () => {
    expect(analysis.lineStarts).toEqual([0, 3, 7]);
  });

  it.each([
    [0, 0],
    [2, 0],
    [3, 1],
    [5, 1],
    [7, 2],
    [9, 2],
  ])("offset %i is on line %i", (position, line) => {
    expect(lineIndexAt(analysis, position)).toBe(line);
  });

  it.each([-1, 10, 1.5, Number.NaN])("offset %s lies outside the block", (position) => {
    expect(lineIndexAt(analysis, position)).toBeUndefined();
  });
});
