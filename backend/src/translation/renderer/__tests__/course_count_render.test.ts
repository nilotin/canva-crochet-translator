import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CourseCountFrame } from "../../parser/frame_ir.js";
import { parseFrames } from "../../parser/frame_parser.js";
import { renderCourseCount, type CourseCountRenderUnit } from "../frame_renderer.js";

const frameOf = (source: string): CourseCountFrame => {
  const frames = parseFrames(source).nodes.filter(
    (node): node is CourseCountFrame => node.kind === "frame" && node.action === "course_count",
  );
  expect(frames).toHaveLength(1);
  return frames[0]!;
};

const render = (source: string, courseKind: "row" | "round" | "unknown") =>
  renderCourseCount(frameOf(source), courseKind, "en");

/** [source raw, target text] per piece, in the unit's piece order. */
const pieceTexts = (unit: CourseCountRenderUnit) =>
  unit.pieces.map(({ sourceSpan, targetStart, targetEnd }) => [
    sourceSpan.raw,
    unit.text.slice(targetStart, targetEnd),
  ]);

describe("renderCourseCount: text", () => {
  it.each([
    ["5 sıra 16x", "row", "16sc for 5 rows"],
    ["1 sıra 16x", "row", "16sc for 1 row"],
    ["5 sıra 16x", "round", "16sc for 5 rounds"],
    ["1 sıra 16x", "round", "16sc for 1 round"],
    ["24 sıra 20x", "row", "20sc for 24 rows"],
    ["10 sıra 64x", "round", "64sc for 10 rounds"],
    ["15 sıra 8hdc", "round", "8hdc for 15 rounds"],
    ["5 sıra 16dc", "row", "16dc for 5 rows"],
    ["5 sıra 16tr", "row", "16tr for 5 rows"],
    ["5 sıra 16esc", "row", "16esc for 5 rows"],
    ["0 sıra 16x", "row", "16sc for 0 rows"],
  ] as const)("%j as %s -> %j", (source, courseKind, text) => {
    expect(render(source, courseKind)?.text).toBe(text);
  });

  it("never adds a leading verb or casing", () => {
    expect(render("5 sıra 16x", "row")?.text).not.toMatch(/^Work|^work/);
  });
});

describe("renderCourseCount: refusals", () => {
  it("returns undefined for unknown: no fallback and no round default", () => {
    expect(render("5 sıra 16x", "unknown")).toBeUndefined();
  });

  it("returns undefined for languages other than English", () => {
    expect(renderCourseCount(frameOf("5 sıra 16x"), "row", "es")).toBeUndefined();
    expect(renderCourseCount(frameOf("5 sıra 16x"), "round", "es")).toBeUndefined();
  });
});

describe("renderCourseCount: pieces", () => {
  it("splits '5 sıra 16x' into a stitch piece and a course piece, in target order", () => {
    const unit = render("5 sıra 16x", "row")!;
    expect(unit).toEqual({
      kind: "course_count",
      sourceSpan: { start: 0, end: 10, raw: "5 sıra 16x" },
      text: "16sc for 5 rows",
      pieces: [
        { sourceSpan: { start: 7, end: 10, raw: "16x" }, targetStart: 0, targetEnd: 4 },
        { sourceSpan: { start: 0, end: 7, raw: "5 sıra " }, targetStart: 4, targetEnd: 15 },
      ],
    });
    expect(pieceTexts(unit)).toEqual([
      ["16x", "16sc"],
      ["5 sıra ", " for 5 rows"],
    ]);
  });

  it("models reordering: target order is the reverse of source order", () => {
    const [stitch, course] = render("5 sıra 16x", "row")!.pieces;
    expect(course!.sourceSpan.start).toBeLessThan(stitch!.sourceSpan.start);
    expect(stitch!.targetStart).toBeLessThan(course!.targetStart);
  });

  it.each([
    ["5 sıra 16x", "row"],
    ["1 sıra 16x", "round"],
    ["24  sıra\t20hdc", "round"],
    ["13) 5 sıra 16x.", "row"],
    ["Başlık\n2-25) 24 sıra 20x", "round"],
  ] as const)("%j: pieces partition both the frame span and the text", (source, courseKind) => {
    const unit = render(source, courseKind)!;
    const bySource = [...unit.pieces].sort((left, right) => left.sourceSpan.start - right.sourceSpan.start);
    expect(bySource[0]!.sourceSpan.start).toBe(unit.sourceSpan.start);
    expect(bySource.at(-1)!.sourceSpan.end).toBe(unit.sourceSpan.end);
    for (let index = 1; index < bySource.length; index += 1) {
      expect(bySource[index]!.sourceSpan.start).toBe(bySource[index - 1]!.sourceSpan.end);
    }
    let cursor = 0;
    for (const piece of unit.pieces) {
      expect(piece.targetStart).toBe(cursor);
      expect(piece.targetEnd).toBeGreaterThan(piece.targetStart);
      cursor = piece.targetEnd;
    }
    expect(cursor).toBe(unit.text.length);
    for (const piece of unit.pieces) {
      expect(source.slice(piece.sourceSpan.start, piece.sourceSpan.end)).toBe(piece.sourceSpan.raw);
    }
  });

  it("gives whitespace inside the frame to the course piece, in source and target", () => {
    const unit = render("24  sıra\t20hdc", "round")!;
    expect(pieceTexts(unit)).toEqual([
      ["20hdc", "20hdc"],
      ["24  sıra\t", " for 24 rounds"],
    ]);
  });

  it("keeps the marker and trailing punctuation outside the unit", () => {
    const source = "13) 5 sıra 16x.";
    const unit = render(source, "row")!;
    expect(unit.sourceSpan).toEqual({ start: 4, end: 14, raw: "5 sıra 16x" });
    expect(source.slice(0, unit.sourceSpan.start) + unit.text + source.slice(unit.sourceSpan.end)).toBe(
      "13) 16sc for 5 rows.",
    );
  });

  it("uses JavaScript UTF-16 offsets", () => {
    const source = "🧶🧶\n5 sıra 16x";
    const unit = render(source, "row")!;
    expect(unit.sourceSpan.start).toBe(5);
    expect(unit.pieces.map(({ sourceSpan }) => [sourceSpan.start, sourceSpan.end])).toEqual([
      [12, 15],
      [5, 12],
    ]);
    expect(unit.pieces.at(-1)!.targetEnd).toBe(unit.text.length);
  });
});

describe("renderCourseCount: purity", () => {
  it("is deterministic and does not mutate the frame", () => {
    const frame = frameOf("5 sıra 16x");
    const snapshot = structuredClone(frame);
    const first = renderCourseCount(frame, "row", "en");
    expect(renderCourseCount(frame, "round", "en")?.text).toBe("16sc for 5 rounds");
    expect(renderCourseCount(frame, "row", "en")).toEqual(first);
    expect(frame).toEqual(snapshot);
  });
});

describe("renderCourseCount: module boundary", () => {
  const code = readFileSync(fileURLToPath(new URL("../frame_renderer.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("does not import PatternContext or anything from translation/context/", () => {
    expect(code).not.toMatch(/context\/|pattern_context|pattern_events/);
  });

  it("has no module-level mutable state", () => {
    expect(code).not.toMatch(/^(?:export\s+)?(?:let|var)\s/m);
  });
});
