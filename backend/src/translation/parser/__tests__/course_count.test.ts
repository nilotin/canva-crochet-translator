import { describe, expect, it } from "vitest";
import {
  parseInvariantIssues,
  reconstructParse,
  type CourseCountFrame,
  type FrameParse,
} from "../frame_ir.js";
import { COURSE_WORDS, STITCH_COUNT_FORMS, parseFrames } from "../frame_parser.js";
import { classifyNumberParens } from "../number_paren.js";

const exact = (source: string): FrameParse => {
  const parse = parseFrames(source);
  expect(parseInvariantIssues(parse)).toEqual([]);
  expect(reconstructParse(parse.nodes)).toBe(source);
  return parse;
};

/** `[kind or action, raw]` per node. */
const shape = (source: string): [string, string][] =>
  exact(source).nodes.map((node) => [node.kind === "frame" ? node.action : "opaque", node.span.raw]);

const courseCounts = (source: string): CourseCountFrame[] =>
  exact(source).nodes.filter(
    (node): node is CourseCountFrame => node.kind === "frame" && node.action === "course_count",
  );

const only = (source: string): CourseCountFrame => {
  const found = courseCounts(source);
  expect(found).toHaveLength(1);
  return found[0]!;
};

describe("course_count lexicon", () => {
  it("admits exactly the lowercase course noun sıra", () => {
    expect([...COURSE_WORDS]).toEqual(["sıra"]);
  });

  it("reuses the stitch_count glossary spellings", () => {
    expect([...STITCH_COUNT_FORMS.keys()].sort()).toEqual(["dc", "esc", "hdc", "tr", "x"]);
  });
});

describe("course_count: recognized", () => {
  it.each([
    ["5 sıra 16x", 5, 16, "x", "single_crochet"],
    ["24 sıra 20x", 24, 20, "x", "single_crochet"],
    ["5 sıra 16hdc", 5, 16, "hdc", "half_double_crochet"],
    ["5 sıra 16dc", 5, 16, "dc", "double_crochet"],
    ["5 sıra 16tr", 5, 16, "tr", "treble_crochet"],
    ["5 sıra 16esc", 5, 16, "esc", "extended_single_crochet"],
  ] as const)("%j is one course_count frame", (source, courses, count, stitch, concept) => {
    expect(shape(source)).toEqual([["course_count", source]]);
    const frame = only(source);
    expect(frame.slots.courses.value).toBe(courses);
    expect(frame.slots.count.value).toBe(count);
    expect(frame.slots.course.span.raw).toBe("sıra");
    expect(frame.slots.stitch).toMatchObject({ span: { raw: stitch }, concept });
  });

  it("gives exact spans for the frame and every slot", () => {
    expect(only("13) 5 sıra 16x")).toEqual({
      kind: "frame",
      action: "course_count",
      span: { start: 4, end: 14, raw: "5 sıra 16x" },
      slots: {
        courses: { span: { start: 4, end: 5, raw: "5" }, value: 5 },
        course: { span: { start: 6, end: 10, raw: "sıra" } },
        count: { span: { start: 11, end: 13, raw: "16" }, value: 16 },
        stitch: { span: { start: 13, end: 14, raw: "x" }, concept: "single_crochet" },
      },
    });
  });

  it("keeps every slot an exact source slice inside the frame", () => {
    const source = "Başlık\n2-25) 24 sıra 20x\n26) 13x örüyoruz.";
    const frame = only(source);
    for (const slot of Object.values(frame.slots)) {
      expect(source.slice(slot.span.start, slot.span.end)).toBe(slot.span.raw);
      expect(slot.span.start).toBeGreaterThanOrEqual(frame.span.start);
      expect(frame.span.end).toBeGreaterThanOrEqual(slot.span.end);
    }
    expect(source.slice(frame.span.start, frame.span.end)).toBe(frame.span.raw);
  });

  it("uses UTF-16 offsets after astral characters", () => {
    const source = "🧶🧶\n5 sıra 16x";
    const frame = only(source);
    expect(frame.span).toEqual({ start: 5, end: 15, raw: "5 sıra 16x" });
    expect(frame.slots.stitch.span).toEqual({ start: 14, end: 15, raw: "x" });
  });
});

describe("course_count: markers stay outside the frame", () => {
  it("13) 5 sıra 16x: Opaque marker, then the frame; number_paren owns 13", () => {
    expect(shape("13) 5 sıra 16x")).toEqual([
      ["opaque", "13) "],
      ["course_count", "5 sıra 16x"],
    ]);
    expect(classifyNumberParens("13) 5 sıra 16x")).toMatchObject([
      { kind: "instruction_marker", first: 13, last: 13, span: { raw: "13)" } },
    ]);
  });

  it("2-25) 24 sıra 20x: number_paren owns the range; the count is not checked against it", () => {
    expect(shape("2-25) 24 sıra 20x")).toEqual([
      ["opaque", "2-25) "],
      ["course_count", "24 sıra 20x"],
    ]);
    expect(only("2-25) 24 sıra 20x").slots.courses.value).toBe(24);
    expect(classifyNumberParens("2-25) 24 sıra 20x")).toMatchObject([
      { kind: "instruction_marker", first: 2, last: 25, span: { raw: "2-25)" } },
    ]);
    expect(only("2-25) 99 sıra 20x").slots.courses.value).toBe(99);
  });
});

describe("course_count: boundaries", () => {
  it.each([
    ["at the start of the text", "5 sıra 16x"],
    ["after a line break", "4) 24x örüyoruz.\n5 sıra 16x"],
    ["after a period", "Başlıyoruz. 5 sıra 16x"],
    ["after a bracket marker", "13) 5 sıra 16x"],
    ["before a period", "5 sıra 16x."],
    ["before a comma", "2-16) 15 sıra 8hdc, iki ucu birleştirmek için ipimizi uzun kesiyoruz."],
    ["before a line break", "2-11) 10 sıra 64x\n4) 24x"],
  ])("admits the frame %s", (_label, source) => {
    expect(courseCounts(source)).toHaveLength(1);
  });

  it("does not claim the text around it", () => {
    expect(shape("2-11) 10 sıra 64x\n4) 24x örüyoruz.")).toEqual([
      ["opaque", "2-11) "],
      ["course_count", "10 sıra 64x"],
      ["opaque", "\n4) "],
      ["stitch_count", "24x örüyoruz"],
      ["opaque", "."],
    ]);
  });
});

describe("course_count: stays Opaque", () => {
  it.each([
    ["5 sırada 16x", "inflected course noun"],
    ["5 sırayı 16x", "inflected course noun"],
    ["5 sıra boyunca 16x", "postposition"],
    ["5 Sıra 16x", "capitalized course noun"],
    ["5 SIRA 16x", "upper-case course noun"],
    ["5 sıra 16", "no stitch"],
    ["5 sıra x", "no stitch count"],
    ["5 sıra 16 x", "stitch not attached to its count"],
    ["5sıra 16x", "count glued to the course noun"],
    ["beş sıra 16x", "written-number course count"],
    ["5.5 sıra 16x", "decimal course count"],
    ["5 sıra 16.5x", "decimal stitch count"],
    ["5 sıra 1,5x", "decimal stitch count"],
    ["5 sıra 16sc", "target-language abbreviation"],
    ["5 sıra 16v", "not a stitch-count concept"],
    ["5 sıra 16zn", "not a stitch-count concept"],
    ["abc 5 sıra 16x", "prose before it"],
    ["5 sıra 16x örüyoruz", "a verb after it"],
    ["5 sıra 16x-2", "a dash after it"],
    ["5 sıra\n16x", "line break inside"],
    ["5\nsıra 16x", "line break inside"],
  ])("%j (%s)", (source) => {
    expect(courseCounts(source)).toEqual([]);
  });
});

describe("course_count: spacing", () => {
  it("treats a wider space or tab run as the one whitespace token it lexes to", () => {
    expect(only("5  sıra\t16x").span.raw).toBe("5  sıra\t16x");
  });
});

describe("course_count: purity", () => {
  const source = "2-25) 24 sıra 20x\n13) 5 sıra 16x";

  it("is deterministic and does not depend on earlier calls", () => {
    const first = parseFrames(source);
    parseFrames("5 sıra 16hdc");
    expect(parseFrames(source)).toEqual(first);
  });

  it("does not mutate the shared lexicon", () => {
    const before = [...COURSE_WORDS];
    parseFrames(source);
    expect([...COURSE_WORDS]).toEqual(before);
  });
});

describe("course_count: written-chain yarn-cut boundary (Task 14D)", () => {
  it.each(["25 sıra 12x", "3 sıra 7x"])("claims only %s, leaving the continuation Opaque", (count) => {
    const source = `🧶\r\n11-35) ${count} bir zincir çekip ipimizi kesiyoruz.`;
    expect(shape(source)).toEqual([
      ["opaque", "🧶\r\n11-35) "],
      ["course_count", count],
      ["opaque", " bir zincir çekip ipimizi kesiyoruz."],
    ]);
    const frame = only(source);
    expect(frame.span.start).toBe(source.indexOf(count));
    expect(source.slice(frame.span.start, frame.span.end)).toBe(count);
  });

  it.each([
    "bir", "bir zincir", "bir zincir çekip", "bir zincir çekip ipimizi",
    "bir zincir çekip ipimizi kesmiyoruz.",
    "bir zincir çekip ipimizi kesiyoruzlar.",
    "bir zincir çekip ipimizi kesiyoruz sonra",
    "iki zincir çekip ipimizi kesiyoruz.",
    "bir zincir\nçekip ipimizi kesiyoruz.",
  ])("keeps an unsupported continuation Opaque: %s", (tail) => {
    expect(courseCounts(`25 sıra 12x ${tail}`)).toEqual([]);
  });
});

describe("course_count: worked chain-and-cut boundary (Task 14I)", () => {
  it.each([
    "26 sıra 14x örüyoruz, 1 zincir çekip ipimizi kesiyoruz.",
    "26 sıra 14x  örüyoruz , 1 zincir çekip ipimizi kesiyoruz",
    "1 sıra 7x örüyoruz, 2 zincir çekip ipimizi kesiyoruz.",
  ])("claims only the count in %j, leaving the continuation Opaque", (tail) => {
    const source = `🧶\r\n13-38) ${tail}`;
    const count = /^\d+ sıra \d+x/u.exec(tail)![0];
    expect(shape(source)).toEqual([
      ["opaque", "🧶\r\n13-38) "],
      ["course_count", count],
      ["opaque", tail.slice(count.length)],
    ]);
    const frame = only(source);
    expect(source.slice(frame.span.start, frame.span.end)).toBe(count);
  });

  it.each([
    "örüyoruz",
    "örüyoruz,",
    "örüyoruz, 1 zincir çekip ipimizi",
    "örüyoruz 1 zincir çekip ipimizi kesiyoruz.",
    "örüyoruz, bir zincir çekip ipimizi kesiyoruz.",
    "örüyoruz, 1 zincir çekip ipimizi kesiyoruz sonra",
    "örüyoruz, 1 zincir çekip ipimizi kesmiyoruz.",
    "örüyoruz, 1 zincir \nçekip ipimizi kesiyoruz.",
    "örüyoruz, 1.5 zincir çekip ipimizi kesiyoruz.",
  ])("keeps an unsupported continuation Opaque: %s", (tail) => {
    expect(courseCounts(`26 sıra 14x ${tail}`)).toEqual([]);
  });
});

describe("course_count: dash-separated yarn-cut boundary (Task 15B)", () => {
  it.each([
    ["10-15) ", "6 sıra 18x", " --- ipimizi kesiyoruz."],
    ["10-15) ", "6 sıra 18x", " - ipimizi kesiyoruz ve dikiyoruz."],
    ["10-15) ", "6 sıra 18x", " – ipimizi kesiyoruz."],
    ["10-15) ", "6 sıra 18x", " — ipimizi kesiyoruz"],
    ["1) ", "1 sıra 18x", "-ipimizi kesiyoruz."],
  ])("claims only %s%s, leaving %j Opaque", (marker, count, tail) => {
    const source = `🧶\r\n${marker}${count}${tail}`;
    expect(shape(source)).toEqual([
      ["opaque", `🧶\r\n${marker}`],
      ["course_count", count],
      ["opaque", tail],
    ]);
    const frame = only(source);
    expect(frame.span.start).toBe(source.indexOf(count));
    expect(source.slice(frame.span.start, frame.span.end)).toBe(count);
  });

  it.each([
    "6 sıra 18x -",
    "6 sıra 18x --- ipimizi",
    "6 sıra 18x --- kesiyoruz.",
    "6 sıra 18x --- ipimizi kesmiyoruz.",
    "6 sıra 18x - ipimizi kesiyoruz sonra",
    "6 sıra 18x - ipimizi kesiyoruz ve",
    "6 sıra 18x - ipimizi kesiyoruz ve dikmiyoruz.",
    "6 sıra 18x - ipimizi kesiyoruz ve dikiyoruz sonra",
    "6 sıra 18x ‐ ipimizi kesiyoruz.",
    "6 sıra 18x –– ipimizi kesiyoruz.",
    "6 sıra 18x - ipimizi\nkesiyoruz.",
    "6 sıra 18x-2",
    "6 sıra 18x - sonra",
    "6 sıra 18x - 2 zincir",
  ])("keeps a partial or unrelated dash continuation Opaque: %j", (source) => {
    expect(courseCounts(source)).toEqual([]);
  });
});
