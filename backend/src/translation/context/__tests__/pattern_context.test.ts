import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CourseEndScope, SourceSpan } from "../../parser/frame_ir.js";
import {
  COURSE_END_POLICY,
  applyPatternEvent,
  courseKindAt,
  foldPatternContext,
  initialPatternContext,
  type PatternContext,
} from "../pattern_context.js";
import {
  patternEventsOf,
  type CourseEndTurnEvent,
  type InstructionEvent,
} from "../pattern_events.js";

const span = (start: number, raw: string): SourceSpan => ({ start, end: start + raw.length, raw });

const instruction = (first: number, last = first, line = 0): InstructionEvent => ({
  type: "instruction",
  first,
  last,
  span: span(0, `${first === last ? first : `${first}-${last}`})`),
  line,
});

const courseEnd = (scope: CourseEndScope): CourseEndTurnEvent => ({
  type: "course_end_turn",
  scope,
  span: span(4, "Bütün sıra sonlarında 1 zincir çekip dönüyoruz"),
  line: 0,
});

const row = (last: number, first = last): PatternContext => ({
  courseKind: "row",
  lastInstruction: { first, last, blockIndex: 0, line: 0 },
  evidence: { blockIndex: 0, span: span(4, "Bütün sıra sonlarında 1 zincir çekip dönüyoruz"), scope: "every" },
});

/** [type, summary] per event. */
const summary = (source: string) =>
  patternEventsOf(source).map((event) => {
    switch (event.type) {
      case "instruction":
        return [event.type, event.first, event.last, event.span.raw, event.line];
      case "course_end_turn":
        return [event.type, event.scope, event.span.raw, event.line];
      case "course_count":
        return [event.type, event.courses, event.count, event.stitch, event.span.raw, event.line];
    }
  });

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

describe("patternEventsOf", () => {
  it("maps a leading N) marker and a course_end_turn frame, in source order", () => {
    expect(summary("12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.")).toEqual([
      ["instruction", 12, 12, "12)", 0],
      ["course_end_turn", "every", "Bütün sıra sonlarında 1 zincir çekip dönüyoruz", 0],
    ]);
  });

  it("maps a range marker and a course_count frame", () => {
    expect(summary("2-25) 24 sıra 20x")).toEqual([
      ["instruction", 2, 25, "2-25)", 0],
      ["course_count", 24, 20, "single_crochet", "24 sıra 20x", 0],
    ]);
  });

  it("maps a number_dot instruction marker with first === last", () => {
    expect(summary("7. Bu kısmı ayrı örüyoruz.")).toEqual([["instruction", 7, 7, "7.", 0]]);
  });

  it.each([
    ["a row/round label", "6. sıranın BLO’sundan örüyoruz."],
    ["an ordinal", "7. sık iğneye ipimizi sabitliyoruz."],
    ["a mid-text number", "Toplam 3. Sonra dönüyoruz."],
    ["a parenthesized number", "İpimizi (catania 110) ile başlıyoruz."],
    ["a stitch_count frame", "20x örüyoruz."],
  ])("produces no event for %s", (_label, source) => {
    expect(patternEventsOf(source)).toEqual([]);
  });

  it("ignores stitch_count and standalone chain/turn frames next to a marker", () => {
    expect(summary("1) 28x örüyoruz, 1 zincir çekip dönüyoruz.\n2) 1 zincir çekip dönüyoruz.")).toEqual([
      ["instruction", 1, 1, "1)", 0],
      ["instruction", 2, 2, "2)", 1],
    ]);
  });

  it("counts lexer line breaks before each event (CRLF is one line break)", () => {
    expect(summary("Başlık\r\n\n13) 5 sıra 16x").map((event) => event.at(-1))).toEqual([2, 2]);
    expect(summary("12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.\n13) 5 sıra 16x")).toEqual([
      ["instruction", 12, 12, "12)", 0],
      ["course_end_turn", "every", "Bütün sıra sonlarında 1 zincir çekip dönüyoruz", 0],
      ["instruction", 13, 13, "13)", 1],
      ["course_count", 5, 16, "single_crochet", "5 sıra 16x", 1],
    ]);
  });

  it("keeps exact UTF-16 spans", () => {
    const source = "🧶\n13) 5 sıra 16x";
    for (const event of patternEventsOf(source)) {
      expect(source.slice(event.span.start, event.span.end)).toBe(event.span.raw);
    }
    expect(patternEventsOf(source).map(({ span: { start } }) => start)).toEqual([3, 7]);
  });

  it("is deterministic and never produces overlapping events", () => {
    const source = "12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.\n13) 5 sıra 16x";
    const events = patternEventsOf(source);
    expect(patternEventsOf(source)).toEqual(events);
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index]!.span.start).toBeGreaterThanOrEqual(events[index - 1]!.span.end);
    }
  });
});

describe("Opaque text never updates the context", () => {
  it.each([
    "Sıra sonlarında cc ile birleştirip, 1 zincir çekip bir üst sıraya geçiyoruz.",
    "Yine bütün sıra sonlarında 1 zincir çekip dönüyoruz.",
    "Her sıra sonunda 1 zincir çekip dönüyoruz.",
    "Bu sırada dönüyoruz, zincir çekmeden devam ediyoruz.",
  ])("%j yields no event and leaves the context unchanged", (source) => {
    expect(patternEventsOf(source)).toEqual([]);
    const [trace] = foldPatternContext([source], row(12));
    expect(trace?.after).toBe(trace?.before);
  });
});

// ---------------------------------------------------------------------------
// Instruction continuity
// ---------------------------------------------------------------------------

describe("applyPatternEvent: instruction continuity", () => {
  it.each([
    ["12 -> 13", row(12), instruction(13)],
    ["2-25 -> 26", row(25, 2), instruction(26)],
    ["2-25 -> 26-30", row(25, 2), instruction(26, 30)],
    ["25-2 -> 3 (a descending range is taken literally)", row(2, 25), instruction(3)],
  ] as const)("%s is continuous: the course kind and its evidence carry over", (_label, context, event) => {
    const next = applyPatternEvent(context, event, 1);
    expect(next.courseKind).toBe("row");
    expect(next.evidence).toEqual(context.evidence);
    expect(next.lastInstruction).toEqual({ first: event.first, last: event.last, blockIndex: 1, line: 0 });
  });

  it.each([
    ["2-25 -> 2-25", row(25, 2), instruction(2, 25)],
    ["2-25 -> 27", row(25, 2), instruction(27)],
    ["12 -> 1)", row(12), instruction(1)],
    ["0 -> 1 (1 always resets)", row(0), instruction(1)],
    ["12 -> 0)", row(12), instruction(0)],
    ["25-2 -> 26 (the previous last is 2)", row(2, 25), instruction(26)],
    ["no previous marker -> 13", { courseKind: "row" } as PatternContext, instruction(13)],
  ] as const)("%s resets to unknown and drops the evidence", (_label, context, event) => {
    const next = applyPatternEvent(context, event, 3);
    expect(next).toEqual({
      courseKind: "unknown",
      lastInstruction: { first: event.first, last: event.last, blockIndex: 3, line: 0 },
    });
  });

  it("resets on a 1. number_dot instruction marker", () => {
    const [event] = patternEventsOf("1. Bu kısmı ayrı örüyoruz.");
    expect(event).toMatchObject({ type: "instruction", first: 1, last: 1 });
    expect(applyPatternEvent(row(12), event!, 0).courseKind).toBe("unknown");
  });

  it("records the marker's block and line", () => {
    expect(applyPatternEvent(initialPatternContext, instruction(4, 4, 2), 5).lastInstruction).toEqual({
      first: 4,
      last: 4,
      blockIndex: 5,
      line: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// Course-end policy (Policy B)
// ---------------------------------------------------------------------------

describe("COURSE_END_POLICY (Policy B)", () => {
  it("is exactly: every -> row, plural and single -> no change", () => {
    expect(COURSE_END_POLICY).toEqual({ every: "row", plural: undefined, single: undefined });
    expect(Object.values(COURSE_END_POLICY)).not.toContain("round");
  });

  it("every establishes row, with its evidence", () => {
    const event = courseEnd("every");
    expect(applyPatternEvent(initialPatternContext, event, 2)).toEqual({
      courseKind: "row",
      evidence: { blockIndex: 2, span: event.span, scope: "every" },
    });
  });

  it.each([
    ["row + plural", row(12), "plural"],
    ["unknown + plural", initialPatternContext, "plural"],
    ["row + single", row(12), "single"],
    ["unknown + single", initialPatternContext, "single"],
  ] as const)("%s changes nothing", (_label, context, scope) => {
    expect(applyPatternEvent(context, courseEnd(scope), 0)).toBe(context);
  });

  it("never sets round from any course-end scope", () => {
    for (const scope of ["every", "plural", "single"] as const) {
      expect(applyPatternEvent(initialPatternContext, courseEnd(scope), 0).courseKind).not.toBe("round");
    }
  });
});

describe("applyPatternEvent: course_count is read-only", () => {
  it("returns the same context", () => {
    const [, event] = patternEventsOf("13) 5 sıra 16x");
    expect(event?.type).toBe("course_count");
    const context = row(12);
    expect(applyPatternEvent(context, event!, 0)).toBe(context);
  });
});

// ---------------------------------------------------------------------------
// Reading and folding
// ---------------------------------------------------------------------------

describe("courseKindAt", () => {
  it("returns the course kind only on the latest marker's block and line", () => {
    const context: PatternContext = { ...row(13), lastInstruction: { first: 13, last: 13, blockIndex: 1, line: 2 } };
    expect(courseKindAt(context, 1, 2)).toBe("row");
    expect(courseKindAt(context, 1, 3)).toBe("unknown");
    expect(courseKindAt(context, 0, 2)).toBe("unknown");
    expect(courseKindAt({ courseKind: "row" }, 0, 0)).toBe("unknown");
  });

  it("returns unknown, never round, when the context is unknown", () => {
    expect(courseKindAt(applyPatternEvent(initialPatternContext, instruction(5), 0), 0, 0)).toBe("unknown");
  });
});

describe("foldPatternContext", () => {
  it("carries the context through a block without markers, which cannot consume it", () => {
    const traces = foldPatternContext([
      "12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.",
      "Sonra devam ediyoruz.",
      "5 sıra 16x",
      "13) 5 sıra 16x",
    ]);
    expect(traces[1]?.after).toBe(traces[1]?.before);
    expect(traces[2]?.reads.map(({ courseKind }) => courseKind)).toEqual(["unknown"]);
    expect(traces[2]?.after.courseKind).toBe("row");
    expect(traces[3]?.reads.map(({ courseKind }) => courseKind)).toEqual(["row"]);
  });

  it("does not let an unnumbered line in the same block consume the context", () => {
    const [trace] = foldPatternContext(["12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.\n5 sıra 16x"]);
    expect(trace?.reads.map(({ courseKind }) => courseKind)).toEqual(["unknown"]);
    expect(trace?.after.courseKind).toBe("row");
  });

  it("resets across a numbering restart inside one block", () => {
    const [trace] = foldPatternContext([
      "1) 28x örüyoruz, 1 zincir çekip dönüyoruz. Bütün sıra sonlarında 1 zincir çekip dönüyoruz.\n♦ Yeni bölüm\n1) 5 sıra 16x, 1 zincir çekip ipimizi kesiyoruz.",
    ]);
    expect(trace?.reads.map(({ courseKind }) => courseKind)).toEqual(["unknown"]);
  });

  it("starts from the given initial context and records before/after per block", () => {
    const traces = foldPatternContext(["13) 5 sıra 16x"], row(12));
    expect(traces).toHaveLength(1);
    expect(traces[0]?.before).toEqual(row(12));
    expect(traces[0]?.after.lastInstruction).toEqual({ first: 13, last: 13, blockIndex: 0, line: 0 });
    expect(traces[0]?.reads).toEqual([
      { event: traces[0]?.events[1], courseKind: "row" },
    ]);
  });

  it("returns nothing for no blocks, and starts from unknown by default", () => {
    expect(foldPatternContext([])).toEqual([]);
    expect(foldPatternContext(["Merhaba."])[0]?.before).toEqual({ courseKind: "unknown" });
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe("PatternContext: purity", () => {
  const blocks = ["12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.", "13) 5 sıra 16x"];

  it("is deterministic", () => {
    expect(foldPatternContext(blocks)).toEqual(foldPatternContext(blocks));
  });

  it("does not mutate the context, the events or the blocks", () => {
    const context = row(12);
    const event = instruction(13);
    const contextSnapshot = structuredClone(context);
    const eventSnapshot = structuredClone(event);
    const blocksSnapshot = [...blocks];
    applyPatternEvent(context, event, 0);
    applyPatternEvent(context, courseEnd("every"), 0);
    foldPatternContext(blocks, context);
    expect(context).toEqual(contextSnapshot);
    expect(event).toEqual(eventSnapshot);
    expect(blocks).toEqual(blocksSnapshot);
  });

  it("freezes the shared initial context and policy", () => {
    expect(Object.isFrozen(initialPatternContext)).toBe(true);
    expect(Object.isFrozen(COURSE_END_POLICY)).toBe(true);
  });
});

describe("context: module contract", () => {
  const code = (file: string) =>
    readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  const imports = (file: string) =>
    [...code(file).matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((match) => match[1]).sort();

  it("pattern_events imports only the lexer, the parser IR and the parser-space classifiers", () => {
    expect(imports("pattern_events.ts")).toEqual([
      "../lexer/typed_lexer.js",
      "../parser/frame_ir.js",
      "../parser/frame_parser.js",
      "../parser/number_dot.js",
      "../parser/number_paren.js",
    ]);
  });

  it("pattern_context imports only the events module and IR types", () => {
    expect(imports("pattern_context.ts")).toEqual(["../parser/frame_ir.js", "./pattern_events.js"]);
  });

  it.each(["pattern_events.ts", "pattern_context.ts"])("%s reads no text and has no hidden state", (file) => {
    const source = code(file);
    expect(source).not.toMatch(/matchAll|\.match\(|\.exec\(|\.replace\(|\.search\(|\.test\(|new RegExp/);
    expect(source).not.toMatch(/translator|normalizer|validator|provider|prompt|instruction_marker\.js|round_references/);
    expect(source).not.toMatch(/process\.|Date\.now|new Date\(|Math\.random|performance\.now/);
    expect(source).not.toMatch(/localeCompare|Intl\.|toLocale(?:Lower|Upper)Case/);
    expect(source).not.toMatch(/^let\s/m);
  });
});
