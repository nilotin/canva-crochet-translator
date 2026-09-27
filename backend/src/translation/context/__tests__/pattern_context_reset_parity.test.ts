/**
 * PatternContext reset parity (next stage, Task 9).
 *
 * Production's numbered-instruction inference (`inferCrochetCountUnitAtSourcePosition`,
 * imported here read-only as the oracle) looks back from a numbered `N)` /
 * `A-B)` line and stops at a blank line or at any line containing
 * `ipimizi kesiyoruz`; it skips unnumbered lines (including `N.` lines) and
 * only accepts turn evidence on numbered lines before the current one. The
 * typed path now mirrors that with `course_reset` events and the
 * `numberedLine` metadata, so same-block typed decisions never say row where
 * production says round. Where the typed path cannot prove what production
 * does (a glued `N)x` marker, a U+2028 line model) it stays unknown.
 */
import { describe, expect, it } from "vitest";
import { legacyCourseUnitResolver } from "../../natural_language/bare_round_count.js";
import { lookupTypedCourseUnit, resolveCourseUnitWithReason } from "../../course_unit_resolution.js";
import { lineIndexAt, prepareCourseDecisions } from "../course_decisions.js";
import {
  applyPatternEvent,
  foldPatternContext,
  initialPatternContext,
  readCourseKind,
  type PatternContext,
} from "../pattern_context.js";
import {
  contextEventsOf,
  courseResetEventsOf,
  patternEventsOf,
  type CourseCountEvent,
  type CourseEndTurnEvent,
  type CourseResetEvent,
  type InstructionEvent,
} from "../pattern_events.js";

const TURN = "Bütün sıra sonlarında 1 zincir çekip dönüyoruz.";
const COUNT = "5 sıra 16x";

/** Typed decision and legacy unit at the start of the last line (the course_count's line). */
const atLastLine = (text: string) => {
  const position = text.lastIndexOf("\n") + 1;
  const prepass = prepareCourseDecisions([{ id: "b", text }]);
  return {
    typed: prepass.decisions.get("b")!.at(-1)?.courseKind,
    legacy: legacyCourseUnitResolver(text, position),
    effective: resolveCourseUnitWithReason(prepass, "b", text, position).unit,
  };
};

const resets = (text: string) => courseResetEventsOf(text).map(({ reason, line }) => [reason, line]);

// ---------------------------------------------------------------------------
// Blank-line reset
// ---------------------------------------------------------------------------

describe("reset parity: blank lines", () => {
  it.each([
    ["turn, blank line, count", `12) ${TURN}\n\n13) ${COUNT}`],
    ["turn, whitespace-only line, count", `12) ${TURN}\n \t \n13) ${COUNT}`],
    ["turn, several blank lines, count", `12) ${TURN}\n\n\n13) ${COUNT}`],
    ["turn, blank line (CRLF), count", `12) ${TURN}\r\n\r\n13) ${COUNT}`],
  ])("%s: typed unknown, legacy round, effective round", (_label, text) => {
    expect(atLastLine(text)).toEqual({ typed: "unknown", legacy: "round", effective: "round" });
  });

  it("turn, a non-blank unnumbered prose line, count: legacy skips the line, both say row", () => {
    expect(atLastLine(`12) ${TURN}\nSonra devam ediyoruz.\n13) ${COUNT}`)).toEqual({
      typed: "row",
      legacy: "row",
      effective: "row",
    });
  });

  it.each([
    ["a blank line before the first instruction", `\n12) ${TURN}\n13) ${COUNT}`],
    ["a blank line after the course_count", `12) ${TURN}\n13) ${COUNT}\n\n`],
  ])("%s does not affect the reading: both say row", (_label, text) => {
    const prepass = prepareCourseDecisions([{ id: "b", text }]);
    const decision = prepass.decisions.get("b")![0]!;
    const lineStart = text.lastIndexOf("\n", decision.sourceSpan.start - 1) + 1;
    expect(decision.courseKind).toBe("row");
    expect(legacyCourseUnitResolver(text, lineStart)).toBe("row");
  });

  it("emits one blank_line reset per blank lexical line, with that line's span", () => {
    const text = `12) ${TURN}\n  \n\n13) ${COUNT}`;
    expect(resets(text)).toEqual([
      ["blank_line", 1],
      ["blank_line", 2],
    ]);
    expect(courseResetEventsOf(text)[0]!.span.raw).toBe("  ");
  });
});

// ---------------------------------------------------------------------------
// Yarn-cut reset
// ---------------------------------------------------------------------------

describe("reset parity: yarn cut", () => {
  it.each([
    ["turn, yarn cut line, count", `12) ${TURN}\nipimizi kesiyoruz\n13) ${COUNT}`],
    ["a yarn cut on the numbered turn line itself", `12) ${TURN.slice(0, -1)}, ipimizi kesiyoruz.\n13) ${COUNT}`],
    ["a yarn cut before the turn on its line", `12) ipimizi kesiyoruz. ${TURN}\n13) ${COUNT}`],
    ["upper-case ASCII", `12) ${TURN}\nIPIMIZI KESIYORUZ\n13) ${COUNT}`],
    ["several spaces between the words", `12) ${TURN}\nipimizi   kesiyoruz\n13) ${COUNT}`],
    ["a tab and punctuation", `12) ${TURN}\nipimizi\tkesiyoruz!\n13) ${COUNT}`],
    ["a non-ASCII letter glued before (production's ASCII word boundary)", `12) ${TURN}\nçipimizi kesiyoruz\n13) ${COUNT}`],
  ])("%s: typed unknown, legacy round", (_label, text) => {
    expect(atLastLine(text)).toEqual({ typed: "unknown", legacy: "round", effective: "round" });
  });

  it.each([
    ["İpimizi (U+0130 does not fold to i)", `12) ${TURN}\nİpimizi kesiyoruz\n13) ${COUNT}`],
    ["a different verb containing kes", `12) ${TURN}\nipimizi kesmeden devam ediyoruz\n13) ${COUNT}`],
    ["kesiyoruz alone", `12) ${TURN}\nkesiyoruz\n13) ${COUNT}`],
    ["a digit glued before (an ASCII word character)", `12) ${TURN}\n5ipimizi kesiyoruz\n13) ${COUNT}`],
    ["an underscore glued after", `12) ${TURN}\nipimizi kesiyoruz_x\n13) ${COUNT}`],
  ])("%s does not reset: both say row", (_label, text) => {
    expect(resets(text)).toEqual([]);
    expect(atLastLine(text)).toEqual({ typed: "row", legacy: "row", effective: "row" });
  });

  it("a yarn cut with no prior context: typed unknown, legacy round", () => {
    expect(atLastLine(`ipimizi kesiyoruz\n13) ${COUNT}`)).toEqual({ typed: "unknown", legacy: "round", effective: "round" });
  });

  it("a yarn cut on the course_count's own line does not affect that count, only the next line", () => {
    const text = `12) ${TURN}\n13) ${COUNT}, 1 zincir çekip ipimizi kesiyoruz.\n14) 6 sıra 18x`;
    const decisions = prepareCourseDecisions([{ id: "b", text }]).decisions.get("b")!;
    expect(decisions.map(({ courseKind }) => courseKind)).toEqual(["row", "unknown"]);
    const lineStart = (line: number) => text.split("\n").slice(0, line).join("\n").length + (line > 0 ? 1 : 0);
    expect(legacyCourseUnitResolver(text, lineStart(1))).toBe("row");
    expect(legacyCourseUnitResolver(text, lineStart(2))).toBe("round");
  });

  it("places the yarn-cut reset at the end of its line, with the words as trigger", () => {
    const text = `12) ipimizi kesiyoruz. ${TURN}\n13) ${COUNT}`;
    const [reset] = courseResetEventsOf(text);
    const lineEnd = text.indexOf("\n");
    expect(reset).toEqual({
      type: "course_reset",
      reason: "yarn_cut",
      span: { start: lineEnd, end: lineEnd, raw: "" },
      trigger: { start: 4, end: 21, raw: "ipimizi kesiyoruz" },
      line: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Numbered-line evidence
// ---------------------------------------------------------------------------

describe("reset parity: numbered-line evidence", () => {
  it.each([
    ["numbered N) turn line", `12) ${TURN}\n13) ${COUNT}`, "row", "row"],
    ["numbered range turn line", `11-12) ${TURN}\n13-17) ${COUNT}`, "row", "row"],
    ["unnumbered turn line", `12) 3x\n${TURN}\n13) ${COUNT}`, "unknown", "round"],
    ["N. turn line (production does not count N.)", `12. ${TURN}\n13) ${COUNT}`, "unknown", "round"],
    ["N. course_count line (not a numbered line)", `12) ${TURN}\n13. ${COUNT}`, "unknown", "round"],
    ["range gap", `11-12) ${TURN}\n14-17) ${COUNT}`, "unknown", "round"],
  ] as const)("%s: typed %s, legacy %s", (_label, text, typed, legacy) => {
    const result = atLastLine(text);
    expect(result.typed).toBe(typed);
    expect(result.legacy).toBe(legacy);
    expect(result.effective).toBe(legacy);
  });

  it("turn evidence on the course_count's own line is not used (production reads earlier lines only)", () => {
    const text = `12) 3x\n13) ${TURN} ${COUNT}`;
    const events = patternEventsOf(text).map(({ type, line }) => [type, line]);
    expect(events).toEqual([
      ["instruction", 0],
      ["instruction", 1],
      ["course_end_turn", 1],
      ["course_count", 1],
    ]);
    expect(atLastLine(text)).toEqual({ typed: "unknown", legacy: "round", effective: "round" });
  });

  it("turn evidence before a marker on its line leaves the marker non-leading, so nothing is numbered", () => {
    const text = `${TURN} 12) 3x\n13) ${COUNT}`;
    expect(patternEventsOf(text).filter(({ type }) => type === "instruction").map(({ line }) => line)).toEqual([1]);
    expect(atLastLine(text)).toEqual({ typed: "unknown", legacy: "round", effective: "round" });
  });

  it("marks course_end_turn and course_count events with numberedLine", () => {
    const text = `12) ${TURN}\n${TURN}\n13) ${COUNT}\n${COUNT}`;
    expect(
      patternEventsOf(text)
        .filter((event): event is CourseEndTurnEvent | CourseCountEvent => event.type !== "instruction")
        .map(({ type, line, numberedLine }) => [type, line, numberedLine]),
    ).toEqual([
      ["course_end_turn", 0, true],
      ["course_end_turn", 1, false],
      ["course_count", 2, true],
      ["course_count", 3, false],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Lines the typed path cannot prove: stay unknown
// ---------------------------------------------------------------------------

describe("reset parity: conservative cases", () => {
  it("a glued N)x marker (production counts it, number_paren does not) resets: typed unknown", () => {
    expect(resets(`12) ${TURN}\n5)x\n13) ${COUNT}`)).toEqual([["attached_marker", 1]]);
    expect(atLastLine(`12) ${TURN}\n5)x\n13) ${COUNT}`)).toEqual({ typed: "unknown", legacy: "round", effective: "round" });
    // A correctly numbered glued line: production continues, typed stays unknown; effective is legacy's row.
    expect(atLastLine(`12) ${TURN}\n13)x\n14) ${COUNT}`)).toEqual({ typed: "unknown", legacy: "row", effective: "row" });
  });

  it.each([" ", " "])("a U+%s line separator makes the whole block unknown", (separator) => {
    const text = `12) ${TURN}${separator}13) ${COUNT}`;
    const prepass = prepareCourseDecisions([{ id: "b", text }]);
    expect(prepass.decisions.get("b")!.map(({ courseKind }) => courseKind)).toEqual(["unknown"]);
    expect(legacyCourseUnitResolver(text, text.indexOf("13)"))).toBe("round");
  });

  it("an offset between the halves of a CRLF lies in no line, as in production", () => {
    const text = `12) ${TURN}\r\n13) ${COUNT}`;
    const analysis = prepareCourseDecisions([{ id: "b", text }]).blocks.get("b")!;
    const middle = text.indexOf("\n");
    expect(lineIndexAt(analysis, middle)).toBeUndefined();
    expect(lineIndexAt(analysis, middle - 1)).toBe(0);
    expect(lineIndexAt(analysis, middle + 1)).toBe(1);
    expect(lookupTypedCourseUnit(prepareCourseDecisions([{ id: "b", text }]), "b", text, middle)).toEqual({
      kind: "fallback",
      reason: "position_outside_block",
    });
  });
});

// ---------------------------------------------------------------------------
// PatternContext transitions
// ---------------------------------------------------------------------------

const instruction = (first: number, line = 0): InstructionEvent => ({
  type: "instruction",
  first,
  last: first,
  span: { start: 0, end: `${first})`.length, raw: `${first})` },
  line,
});
const turn = (numberedLine: boolean, line = 0): CourseEndTurnEvent => ({
  type: "course_end_turn",
  scope: "every",
  span: { start: 4, end: 50, raw: TURN.slice(0, -1) },
  line,
  numberedLine,
});
const reset = (reason: CourseResetEvent["reason"]): CourseResetEvent => ({
  type: "course_reset",
  reason,
  span: { start: 51, end: 51, raw: "" },
  trigger: { start: 51, end: 51, raw: "" },
  line: 1,
});
const count = (line: number, numberedLine = true): CourseCountEvent => ({
  type: "course_count",
  courses: 5,
  count: 16,
  stitch: "single_crochet",
  span: { start: 4, end: 14, raw: COUNT },
  line,
  numberedLine,
});

const fold = (events: readonly (InstructionEvent | CourseEndTurnEvent | CourseResetEvent)[]): PatternContext =>
  events.reduce<PatternContext>((context, event) => applyPatternEvent(context, event, 0), initialPatternContext);

describe("reset parity: PatternContext transitions", () => {
  const established = fold([instruction(12), turn(true)]);

  it("every on a numbered line establishes row with its line", () => {
    expect(established).toMatchObject({ courseKind: "row", evidence: { line: 0, blockIndex: 0 } });
  });

  it("every on an unnumbered line changes nothing", () => {
    const context = fold([instruction(12)]);
    expect(applyPatternEvent(context, turn(false, 1), 0)).toBe(context);
  });

  it.each(["blank_line", "yarn_cut", "attached_marker"] as const)(
    "a %s reset clears the course kind, the evidence and the last marker",
    (reason) => {
      expect(applyPatternEvent(established, reset(reason), 0)).toEqual({ courseKind: "unknown" });
    },
  );

  it("continuity cannot cross a reset: the next marker starts from unknown", () => {
    const next = applyPatternEvent(applyPatternEvent(established, reset("blank_line"), 0), instruction(13, 2), 0);
    expect(next).toEqual({
      courseKind: "unknown",
      lastInstruction: { first: 13, last: 13, blockIndex: 0, line: 2 },
    });
  });

  it("a reset never produces round", () => {
    for (const reason of ["blank_line", "yarn_cut", "attached_marker"] as const) {
      expect(applyPatternEvent(established, reset(reason), 0).courseKind).not.toBe("round");
    }
  });

  it("readCourseKind: unknown on an unnumbered line, on the evidence's own line, and without the latest marker", () => {
    const onLine1 = applyPatternEvent(established, instruction(13, 1), 0);
    expect(readCourseKind(onLine1, count(1), 0)).toBe("row");
    expect(readCourseKind(onLine1, count(1, false), 0)).toBe("unknown");
    expect(readCourseKind(established, count(0), 0)).toBe("unknown");
    expect(readCourseKind(onLine1, count(2), 0)).toBe("unknown");
  });

  it("processes events in source order; a yarn-cut reset sorts at its line end", () => {
    const text = `12) ipimizi kesiyoruz. ${TURN}\n13) ${COUNT}, 1 zincir çekip ipimizi kesiyoruz.`;
    expect(contextEventsOf(text).map((event) => (event.type === "course_reset" ? `reset:${event.reason}` : event.type))).toEqual([
      "instruction",
      "course_end_turn",
      "reset:yarn_cut",
      "instruction",
      "course_count",
      "reset:yarn_cut",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Same-block only, and exhaustive parity
// ---------------------------------------------------------------------------

describe("reset parity: scope", () => {
  it("R3: the same-block pre-pass still says unknown for block 2 (no cross-block carry)", () => {
    const prepass = prepareCourseDecisions([
      { id: "local-block-1", text: `12) ${TURN}` },
      { id: "local-block-2", text: `13) ${COUNT}` },
    ]);
    expect(prepass.decisions.get("local-block-2")!.map(({ courseKind }) => courseKind)).toEqual(["unknown"]);
  });

  it("the cross-block shadow fold keeps its R3 row (numbered evidence, no reset between)", () => {
    expect(foldPatternContext([`12) ${TURN}`, `13) ${COUNT}`])[1]!.reads[0]!.courseKind).toBe("row");
  });
});

describe("reset parity: exhaustive three-line sweep", () => {
  const templates = [
    `12) ${TURN}`,
    `11-12) ${TURN}`,
    `12. ${TURN}`,
    TURN,
    `12) 3x`,
    "",
    "   ",
    "ipimizi kesiyoruz",
    "çipimizi kesiyoruz",
    "ipimizi kesmeden devam",
    "5)x",
    "13)x",
    `13) ${COUNT}`,
    `13) ${COUNT}, 1 zincir çekip ipimizi kesiyoruz.`,
    `14) ${COUNT}`,
    `13-17) ${COUNT}`,
    `13. ${COUNT}`,
    `13) ${TURN} ${COUNT}`,
    "♦ Başlık",
  ];

  it("typed never contradicts legacy, and the resolver equals legacy, at every offset", () => {
    let typedRows = 0;
    for (const first of templates) {
      for (const second of templates) {
        for (const third of templates) {
          const text = `${first}\n${second}\n${third}`;
          const prepass = prepareCourseDecisions([{ id: "b", text }]);
          for (let position = 0; position <= text.length; position += 1) {
            const legacy = legacyCourseUnitResolver(text, position);
            const lookup = lookupTypedCourseUnit(prepass, "b", text, position);
            if (lookup.kind === "typed") {
              expect(lookup.unit).toBe(legacy);
              typedRows += 1;
            }
            expect(resolveCourseUnitWithReason(prepass, "b", text, position).unit).toBe(legacy);
          }
        }
      }
    }
    expect(typedRows).toBeGreaterThan(0);
  });
});
