/**
 * Course unit resolution (next stage, Task 8): the block resolver built from
 * the same-block pre-pass.
 *
 * A typed unit takes effect only where the legacy inference agrees, so the
 * resolver's answer always equals legacy's. Unknown, missing, ambiguous and
 * unsupported lookups fall back with a named reason; a typed/legacy
 * disagreement falls back with `typed_disagrees_with_legacy`. The three
 * former disagreement shapes (Task 8 debt) are closed by reset parity
 * (Task 9): the typed decision is now unknown there, like legacy's round.
 */
import { describe, expect, it } from "vitest";
import {
  prepareCourseDecisions,
  type CourseDecision,
  type CourseDecisionPrepass,
} from "../context/course_decisions.js";
import {
  courseUnitResolverForBlock,
  lookupTypedCourseUnit,
  resolveCourseUnitWithReason,
} from "../course_unit_resolution.js";
import {
  legacyCourseUnitResolver,
  type CourseUnitResolver,
} from "../natural_language/bare_round_count.js";
import { loadCorpus } from "./corpus/load_corpus.js";

const TURN = "12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.";
const R3_BLOCK_2 = "13) 5 sıra 16x";
const SAME_BLOCK_ROW = `${TURN}\n${R3_BLOCK_2}`;

/** The three shapes where the typed decision was row and legacy round until reset parity (Task 9). */
const DISAGREEMENT_SHAPES = [
  ["a blank line between the turn and the count", `${TURN}\n\n${R3_BLOCK_2}`],
  ["a yarn cut between the turn and the count", `${TURN}\nipimizi kesiyoruz\n${R3_BLOCK_2}`],
  [
    "turn evidence on an unnumbered line",
    "12) 3x\nBütün sıra sonlarında 1 zincir çekip dönüyoruz.\n13) 5 sıra 16x",
  ],
] as const;

const single = (text: string) => prepareCourseDecisions([{ id: "b", text }]);
const resolveAt = (text: string, position: number) =>
  resolveCourseUnitWithReason(single(text), "b", text, position);
const lastLineStart = (text: string) => text.lastIndexOf("\n") + 1;

/** A hand-built enabled pre-pass for shapes the current policy never produces. */
const handBuilt = (text: string, decisions: readonly Omit<CourseDecision, "blockId">[]): CourseDecisionPrepass => {
  const full = decisions.map((decision) => ({ blockId: "b", ...decision }));
  const lineStarts = [0, ...[...text.matchAll(/\n/gu)].map(({ index }) => index + 1)];
  return {
    status: "enabled",
    blocks: new Map([["b", { blockId: "b", text, lineStarts, decisions: full }]]),
    decisions: new Map([["b", full]]),
  };
};

describe("course unit resolution: agreement", () => {
  it("typed row == legacy row: the typed unit takes effect", () => {
    const position = lastLineStart(SAME_BLOCK_ROW);
    expect(legacyCourseUnitResolver(SAME_BLOCK_ROW, position)).toBe("row");
    expect(resolveAt(SAME_BLOCK_ROW, position)).toEqual({ unit: "row", source: "typed", typedUnit: "row" });
    // Anywhere on the course_count's line, including the span start.
    expect(resolveAt(SAME_BLOCK_ROW, position + 4)).toMatchObject({ unit: "row", source: "typed" });
  });

  it("typed round == legacy round: the typed unit takes effect (hand-built: no current event sets round)", () => {
    const prepass = handBuilt(R3_BLOCK_2, [
      { lineIndex: 0, sourceSpan: { start: 4, end: 14, raw: "5 sıra 16x" }, courseKind: "round" },
    ]);
    expect(legacyCourseUnitResolver(R3_BLOCK_2, 0)).toBe("round");
    expect(resolveCourseUnitWithReason(prepass, "b", R3_BLOCK_2, 0)).toEqual({
      unit: "round",
      source: "typed",
      typedUnit: "round",
    });
  });

  it("unknown falls back to legacy (R3 block 2 alone: round)", () => {
    expect(lookupTypedCourseUnit(single(R3_BLOCK_2), "b", R3_BLOCK_2, 0)).toEqual({
      kind: "fallback",
      reason: "unknown_decision",
    });
    expect(resolveAt(R3_BLOCK_2, 0)).toEqual({ unit: "round", source: "fallback", reason: "unknown_decision" });
  });
});

describe("course unit resolution: former disagreements closed by reset parity (Task 9)", () => {
  it.each(DISAGREEMENT_SHAPES)("%s: typed unknown, legacy round, effective round", (_label, text) => {
    const position = lastLineStart(text);
    const lookup = lookupTypedCourseUnit(single(text), "b", text, position);
    expect(lookup).toEqual({ kind: "fallback", reason: "unknown_decision" });
    expect(legacyCourseUnitResolver(text, position)).toBe("round");
    expect(resolveAt(text, position)).toEqual({ unit: "round", source: "fallback", reason: "unknown_decision" });
    expect(courseUnitResolverForBlock(single(text), "b")(text, position)).toBe("round");
  });
});

describe("course unit resolution: the agreement gate stays", () => {
  it("a typed answer that legacy contradicts still falls back with typed_disagrees_with_legacy", () => {
    const text = R3_BLOCK_2;
    const prepass = handBuilt(text, [
      { lineIndex: 0, sourceSpan: { start: 4, end: 14, raw: "5 sıra 16x" }, courseKind: "row" },
    ]);
    expect(legacyCourseUnitResolver(text, 0)).toBe("round");
    expect(resolveCourseUnitWithReason(prepass, "b", text, 0)).toEqual({
      unit: "round",
      source: "fallback",
      reason: "typed_disagrees_with_legacy",
      typedUnit: "row",
    });
  });
});

describe("course unit resolution: fallback reasons", () => {
  it("no course_count decision on the asked line", () => {
    expect(resolveAt(SAME_BLOCK_ROW, 0)).toMatchObject({ source: "fallback", reason: "no_decision_on_line" });
  });

  it("an unsupported sourceContext (a segment body, not the block text) is never mapped", () => {
    const prepass = single(SAME_BLOCK_ROW);
    expect(resolveCourseUnitWithReason(prepass, "b", "5 sıra 16x", 0)).toEqual({
      unit: legacyCourseUnitResolver("5 sıra 16x", 0),
      source: "fallback",
      reason: "unsupported_source_context",
    });
  });

  it("a position outside the block", () => {
    expect(resolveAt(SAME_BLOCK_ROW, SAME_BLOCK_ROW.length + 1)).toMatchObject({
      source: "fallback",
      reason: "position_outside_block",
    });
  });

  it("a block the pre-pass did not analyze", () => {
    expect(resolveCourseUnitWithReason(single(SAME_BLOCK_ROW), "other", SAME_BLOCK_ROW, 0)).toMatchObject({
      source: "fallback",
      reason: "block_not_analyzed",
    });
  });

  it("a disabled pre-pass (duplicate ids) falls back for every block", () => {
    const prepass = prepareCourseDecisions([
      { id: "b", text: SAME_BLOCK_ROW },
      { id: "b", text: SAME_BLOCK_ROW },
    ]);
    const position = lastLineStart(SAME_BLOCK_ROW);
    expect(resolveCourseUnitWithReason(prepass, "b", SAME_BLOCK_ROW, position)).toEqual({
      unit: "row",
      source: "fallback",
      reason: "prepass_disabled",
    });
  });

  it("decisions of different kinds on one line are ambiguous", () => {
    const text = "13) 5 sıra 16x, 6 sıra 18x";
    const prepass = handBuilt(text, [
      { lineIndex: 0, sourceSpan: { start: 4, end: 14, raw: "5 sıra 16x" }, courseKind: "row" },
      { lineIndex: 0, sourceSpan: { start: 16, end: 26, raw: "6 sıra 18x" }, courseKind: "unknown" },
    ]);
    expect(resolveCourseUnitWithReason(prepass, "b", text, 0)).toMatchObject({
      source: "fallback",
      reason: "ambiguous_line",
    });
  });

  it("identical source lines are told apart by line index, never by text search", () => {
    const text = `${R3_BLOCK_2}\n${TURN}\n${R3_BLOCK_2}`;
    expect(resolveAt(text, 0)).toMatchObject({ unit: "round", reason: "unknown_decision" });
    expect(resolveAt(text, lastLineStart(text))).toMatchObject({ unit: "row", source: "typed" });
    // The line's own text as context is a sub-context: never searched for.
    expect(resolveCourseUnitWithReason(single(text), "b", R3_BLOCK_2, 0)).toMatchObject({
      reason: "unsupported_source_context",
    });
  });

  it("an error in the typed lookup falls back instead of throwing", () => {
    const hostile = {
      status: "enabled",
      blocks: { get: () => { throw new Error("boom"); } },
      decisions: new Map(),
    } as unknown as CourseDecisionPrepass;
    expect(resolveCourseUnitWithReason(hostile, "b", R3_BLOCK_2, 0)).toEqual({
      unit: "round",
      source: "fallback",
      reason: "typed_lookup_error",
    });
    expect(courseUnitResolverForBlock(hostile, "b")(R3_BLOCK_2, 0)).toBe("round");
  });

  it("asks the fallback with the caller's own arguments", () => {
    const calls: [string, number][] = [];
    const fallback: CourseUnitResolver = (context, position) => {
      calls.push([context, position]);
      return "round";
    };
    courseUnitResolverForBlock(single(SAME_BLOCK_ROW), "b", fallback)("segment body", 3);
    expect(calls).toEqual([["segment body", 3]]);
  });
});

describe("course unit resolution: legacy equivalence", () => {
  const blocks = [
    ...loadCorpus().cases.flatMap(({ value }) => value.request.blocks.map(({ text }) => text)),
    SAME_BLOCK_ROW,
    R3_BLOCK_2,
    ...DISAGREEMENT_SHAPES.map(([, text]) => text),
  ];

  it("equals the legacy resolver at every offset of every corpus block and shape", () => {
    for (const text of blocks) {
      const resolver = courseUnitResolverForBlock(single(text), "b");
      for (let position = 0; position <= text.length; position += 1) {
        expect(resolver(text, position)).toBe(legacyCourseUnitResolver(text, position));
      }
    }
  });

  it("has no typed/legacy disagreement at any corpus course_count", () => {
    const counts = { total: 0, typed: 0, fallback: 0, disagreements: 0 };
    for (const { value } of loadCorpus().cases) {
      for (const { id, text } of value.request.blocks) {
        const prepass = prepareCourseDecisions([{ id, text }]);
        for (const decision of prepass.decisions.get(id)!) {
          const lineStart = text.lastIndexOf("\n", decision.sourceSpan.start - 1) + 1;
          for (const position of [lineStart, decision.sourceSpan.start]) {
            const resolution = resolveCourseUnitWithReason(prepass, id, text, position);
            counts.total += 1;
            if (resolution.source === "typed") counts.typed += 1;
            else counts.fallback += 1;
            if (resolution.reason === "typed_disagrees_with_legacy") counts.disagreements += 1;
          }
        }
      }
    }
    expect(counts.total).toBeGreaterThan(0);
    expect(counts.typed + counts.fallback).toBe(counts.total);
    expect(counts.disagreements).toBe(0);
  });
});
