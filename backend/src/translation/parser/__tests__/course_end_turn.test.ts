import { describe, expect, it } from "vitest";
import {
  parseInvariantIssues,
  reconstructParse,
  type CourseEndTurnFrame,
  type FrameParse,
} from "../frame_ir.js";
import { CHAIN_CONCEPT, COURSE_END_PHRASES, parseFrames } from "../frame_parser.js";

const exact = (source: string): FrameParse => {
  const parse = parseFrames(source);
  expect(parseInvariantIssues(parse)).toEqual([]);
  expect(reconstructParse(parse.nodes)).toBe(source);
  return parse;
};

/** `[kind or action, raw]` per node. */
const shape = (source: string): [string, string][] =>
  exact(source).nodes.map((node) => [node.kind === "frame" ? node.action : "opaque", node.span.raw]);

const courseEndTurns = (source: string): CourseEndTurnFrame[] =>
  exact(source).nodes.filter(
    (node): node is CourseEndTurnFrame => node.kind === "frame" && node.action === "course_end_turn",
  );

const only = (source: string): CourseEndTurnFrame => {
  const found = courseEndTurns(source);
  expect(found).toHaveLength(1);
  return found[0]!;
};

describe("course_end_turn lexicon", () => {
  it("lists exactly three finite phrases, capitalizable only in the first word", () => {
    expect(
      COURSE_END_PHRASES.map(({ words, scope }) => [scope, words.map((spellings) => [...spellings].sort())]),
    ).toEqual([
      ["every", [["Bütün", "bütün"], ["sıra"], ["sonlarında"]]],
      ["plural", [["Sıra", "sıra"], ["sonlarında"]]],
      ["single", [["Sıra", "sıra"], ["sonunda"]]],
    ]);
  });
});

describe("course_end_turn: recognized", () => {
  it.each([
    ["Bütün sıra sonlarında 1 zincir çekip dönüyoruz.", "every", "Bütün sıra sonlarında", 1, "zincir"],
    ["bütün sıra sonlarında 1 zincir çekip dönüyoruz.", "every", "bütün sıra sonlarında", 1, "zincir"],
    ["Sıra sonlarında 1 zincir çekip dönüyoruz.", "plural", "Sıra sonlarında", 1, "zincir"],
    ["Sıra sonunda 1 zincir çekip dönüyoruz.", "single", "Sıra sonunda", 1, "zincir"],
    ["sıra sonunda 1 zincir çekip dönüyoruz.", "single", "sıra sonunda", 1, "zincir"],
    ["Sıra sonunda 2 zincir çekip dönüyoruz.", "single", "Sıra sonunda", 2, "zincir"],
    ["Sıra sonunda 1 zn çekip dönüyoruz.", "single", "Sıra sonunda", 1, "zn"],
  ] as const)("%j", (source, scope, scopeRaw, count, unit) => {
    const clause = source.slice(0, -1);
    expect(shape(source)).toEqual([
      ["course_end_turn", clause],
      ["opaque", "."],
    ]);
    const frame = only(source);
    expect(frame.slots.scope).toEqual({ span: { start: 0, end: scopeRaw.length, raw: scopeRaw }, value: scope });
    expect(frame.slots.count.value).toBe(count);
    expect(frame.slots.unit).toMatchObject({ span: { raw: unit }, concept: CHAIN_CONCEPT });
    expect(frame.slots.converb).toMatchObject({ span: { raw: "çekip" }, form: "converb" });
    expect(frame.slots.verb).toMatchObject({ span: { raw: "dönüyoruz" }, form: "finite" });
    expect(frame.span).toEqual({ start: 0, end: clause.length, raw: clause });
  });

  it("gives exact spans for every slot", () => {
    const source = "Bütün sıra sonlarında 12 zincir çekip dönüyoruz.";
    expect(only(source)).toEqual({
      kind: "frame",
      action: "course_end_turn",
      span: { start: 0, end: 47, raw: "Bütün sıra sonlarında 12 zincir çekip dönüyoruz" },
      slots: {
        scope: { span: { start: 0, end: 21, raw: "Bütün sıra sonlarında" }, value: "every" },
        count: { span: { start: 22, end: 24, raw: "12" }, value: 12 },
        unit: { span: { start: 25, end: 31, raw: "zincir" }, concept: CHAIN_CONCEPT },
        converb: { span: { start: 32, end: 37, raw: "çekip" }, form: "converb" },
        verb: { span: { start: 38, end: 47, raw: "dönüyoruz" }, form: "finite" },
      },
    });
  });

  it("keeps every slot an exact source slice inside the frame", () => {
    const source = "Önce 6x örüyoruz. Sıra sonlarında 3 zn çekip dönüyoruz.";
    const frame = only(source);
    for (const slot of Object.values(frame.slots)) {
      expect(source.slice(slot.span.start, slot.span.end)).toBe(slot.span.raw);
      expect(slot.span.start).toBeGreaterThanOrEqual(frame.span.start);
      expect(frame.span.end).toBeGreaterThanOrEqual(slot.span.end);
    }
    expect(source.slice(frame.span.start, frame.span.end)).toBe(frame.span.raw);
  });

  it("uses UTF-16 offsets after astral characters", () => {
    const source = "🧶🧶\nSıra sonunda 1 zincir çekip dönüyoruz.";
    const frame = only(source);
    expect(frame.span.start).toBe(5);
    expect(frame.slots.count.span).toEqual({ start: 18, end: 19, raw: "1" });
    expect(source.slice(frame.span.start, frame.span.end)).toBe(frame.span.raw);
  });
});

describe("course_end_turn: boundaries", () => {
  it.each([
    ["at the start of the text", "Sıra sonunda 1 zincir çekip dönüyoruz."],
    ["after a line break", "6x örüyoruz.\nSıra sonunda 1 zincir çekip dönüyoruz."],
    ["after a period", "6x örüyoruz. Sıra sonunda 1 zincir çekip dönüyoruz."],
    ["after an instruction bracket", "12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz."],
    ["before a comma", "Sıra sonunda 1 zincir çekip dönüyoruz, sonra devam ediyoruz."],
    ["at the end of the text", "Sıra sonunda 1 zincir çekip dönüyoruz"],
  ])("admits the frame %s", (_label, source) => {
    expect(courseEndTurns(source)).toHaveLength(1);
  });

  it.each([
    ["a word before the phrase", "Yine bütün sıra sonlarında 1 zincir çekip dönüyoruz."],
    ["a comma before the phrase", "6x örüyoruz, sıra sonunda 1 zincir çekip dönüyoruz."],
    ["a word after the verb", "Sıra sonunda 1 zincir çekip dönüyoruz ve devam ediyoruz."],
  ])("rejects %s", (_label, source) => {
    expect(courseEndTurns(source)).toEqual([]);
  });

  it("does not claim the text before or after it", () => {
    expect(shape("1) 28x örüyoruz. Bütün sıra sonlarında 1 zincir çekip dönüyoruz.")).toEqual([
      ["opaque", "1) "],
      ["stitch_count", "28x örüyoruz"],
      ["opaque", ". "],
      ["course_end_turn", "Bütün sıra sonlarında 1 zincir çekip dönüyoruz"],
      ["opaque", "."],
    ]);
  });
});

describe("course_end_turn: stays Opaque", () => {
  it.each([
    ["Her sıra sonunda 1 zincir çekip dönüyoruz.", "unlisted quantifier"],
    ["Bütün sıra sonunda 1 zincir çekip dönüyoruz.", "quantifier with the singular form"],
    ["Sıranın sonunda 1 zincir çekip dönüyoruz.", "unlisted inflection of sıra"],
    ["Sıra sonuna 1 zincir çekip dönüyoruz.", "unlisted inflection of son"],
    ["SIRA SONUNDA 1 zincir çekip dönüyoruz.", "upper case"],
    ["Sıra Sonunda 1 zincir çekip dönüyoruz.", "capitalized second word"],
    ["Bütün Sıra sonlarında 1 zincir çekip dönüyoruz.", "capitalized inner word"],
    ["Sıra sonunda dönüyoruz.", "no chain"],
    ["Sıra sonunda 1 zincir.", "no converb or turn"],
    ["Sıra sonunda 1 zincir çekip.", "dangling converb"],
    ["Sıra sonunda 1 zincir çekip hemen dönüyoruz.", "word between the members"],
    ["Sıra sonlarında iki zincir çekip dönüyoruz.", "written-number count"],
    ["Sıra sonunda 1.5 zincir çekip dönüyoruz.", "decimal count"],
    ["Sıra sonunda 1,5 zincir çekip dönüyoruz.", "decimal count"],
    ["Sıra sonunda 1zn çekip dönüyoruz.", "count not separated from the unit"],
    ["Sıra sonunda, 1 zincir çekip dönüyoruz.", "comma before the count"],
    ["Sıra\nsonunda 1 zincir çekip dönüyoruz.", "line break inside the phrase"],
    ["Sıra sonunda 1 zincir çekip\ndönüyoruz.", "line break inside the pair"],
    ["Kolun sonunda 1 zincir çekip dönüyoruz.", "unrelated sonunda"],
    ["Sıra sonlarında cc ile birleştirip, 1 zincir çekip bir üst sıraya geçiyoruz.", "other verbs"],
    ["Sıra sonunda 1 zincir çekiyoruz.", "finite chain verb"],
  ])("%j (%s)", (source) => {
    expect(shape(source)).toEqual([["opaque", source]]);
  });
});

describe("course_end_turn: standalone chain -> turn is unchanged", () => {
  it("still parses the bare pair as chain + whitespace + turn", () => {
    expect(shape("1 zincir çekip dönüyoruz.")).toEqual([
      ["chain", "1 zincir çekip"],
      ["opaque", " "],
      ["turn", "dönüyoruz"],
      ["opaque", "."],
    ]);
  });

  it("emits no standalone chain or turn for the pair inside a course-end frame", () => {
    const nodes = exact("Sıra sonunda 1 zincir çekip dönüyoruz.").nodes;
    expect(nodes.some((node) => node.kind === "frame" && (node.action === "chain" || node.action === "turn"))).toBe(
      false,
    );
  });

  it("does not join a phrase and a pair across a line break (the pair stands alone)", () => {
    expect(shape("Sıra sonunda\n1 zincir çekip dönüyoruz.")).toEqual([
      ["opaque", "Sıra sonunda\n"],
      ["chain", "1 zincir çekip"],
      ["opaque", " "],
      ["turn", "dönüyoruz"],
      ["opaque", "."],
    ]);
  });

  it("keeps a following standalone pair separate", () => {
    expect(shape("Sıra sonunda 1 zincir çekip dönüyoruz.\n2 zincir çekip dönüyoruz.")).toEqual([
      ["course_end_turn", "Sıra sonunda 1 zincir çekip dönüyoruz"],
      ["opaque", ".\n"],
      ["chain", "2 zincir çekip"],
      ["opaque", " "],
      ["turn", "dönüyoruz"],
      ["opaque", "."],
    ]);
  });
});

describe("course_end_turn: purity", () => {
  const source = "Bütün sıra sonlarında 1 zincir çekip dönüyoruz.\nSıra sonunda 2 zn çekip dönüyoruz.";

  it("is deterministic and does not depend on earlier calls", () => {
    const first = parseFrames(source);
    parseFrames("Sıra sonlarında 1 zincir çekip dönüyoruz.");
    expect(parseFrames(source)).toEqual(first);
  });

  it("does not mutate the shared lexicon", () => {
    const snapshot = COURSE_END_PHRASES.map(({ words, scope }) => [scope, words.map((spellings) => [...spellings])]);
    parseFrames(source);
    expect(COURSE_END_PHRASES.map(({ words, scope }) => [scope, words.map((spellings) => [...spellings])])).toEqual(
      snapshot,
    );
  });
});
