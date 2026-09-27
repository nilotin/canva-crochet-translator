import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CourseCountFrame, SourceSpan } from "../../parser/frame_ir.js";
import { parseFrames } from "../../parser/frame_parser.js";
import { renderCourseCount, renderUnits, type RenderPiece } from "../../renderer/frame_renderer.js";
import { protectFrames, restoreFrames, type RestoredFrames } from "../frame_protection.js";
import {
  PlacementError,
  placeRenderedUnits,
  prefixIdentityPiece,
  shiftPlacedPieces,
  toProjectionPieces,
  type PlaceableUnit,
  type PlacedPiece,
} from "../placement.js";

const span = (source: string, start: number, end: number): SourceSpan => ({ start, end, raw: source.slice(start, end) });

/** [source raw, target text] per placed piece, in the given order. */
const described = (pieces: readonly PlacedPiece[], output: string) =>
  pieces.map(({ sourceSpan, targetStart, targetEnd }) => [sourceSpan.raw, output.slice(targetStart, targetEnd)]);

const courseCountUnit = (source: string, courseKind: "row" | "round") => {
  const parse = parseFrames(source);
  const frame = parse.nodes.find(
    (node): node is CourseCountFrame => node.kind === "frame" && node.action === "course_count",
  )!;
  return { parse, unit: renderCourseCount(frame, courseKind, "en")! };
};

const TWO_STITCH_COUNTS = "20x örüyoruz. 28x örüyoruz.";

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

describe("placeRenderedUnits: composition", () => {
  it("places a course_count unit's reordered pieces at its restored start", () => {
    const source = "13) 5 sıra 16x";
    const { parse, unit } = courseCountUnit(source, "row");
    const frames = protectFrames(parse, [unit]);
    const restored = restoreFrames(frames.text, frames);
    expect(restored.text).toBe("13) 16sc for 5 rows");
    const result = placeRenderedUnits(restored, [unit]);
    expect(result).toEqual({
      valid: true,
      errors: [],
      pieces: [
        { sourceSpan: span(source, 11, 14), targetStart: 4, targetEnd: 8 },
        { sourceSpan: span(source, 4, 11), targetStart: 8, targetEnd: 19 },
      ],
    });
    expect(described(result.pieces, restored.text)).toEqual([
      ["16x", "16sc"],
      ["5 sıra ", " for 5 rows"],
    ]);
  });

  it("emits one whole-unit piece for a unit without semantic pieces (every Stage 1 unit)", () => {
    const parse = parseFrames("20x örüyoruz.");
    const units = renderUnits(parse, "en");
    const frames = protectFrames(parse, units);
    const restored = restoreFrames(frames.text, frames);
    expect(placeRenderedUnits(restored, units)).toEqual({
      valid: true,
      errors: [],
      pieces: [{ sourceSpan: units[0]!.sourceSpan, targetStart: 0, targetEnd: 9 }],
    });
    expect(restored.pieces).toEqual([{ sourceStart: 0, sourceEnd: 12, targetStart: 0, targetEnd: 9 }]);
  });

  it("places several units, each from its own restoration anchor", () => {
    const parse = parseFrames(TWO_STITCH_COUNTS);
    const units = renderUnits(parse, "en");
    expect(units.map(({ text }) => text)).toEqual(["work 20sc", "work 28sc"]);
    const frames = protectFrames(parse, units);
    const restored = restoreFrames(frames.text, frames);
    expect(restored.text).toBe("work 20sc. work 28sc.");
    const result = placeRenderedUnits(restored, units);
    expect(result.pieces.map(({ targetStart, targetEnd }) => [targetStart, targetEnd])).toEqual([
      [0, 9],
      [11, 20],
    ]);
    expect(described(result.pieces, restored.text)).toEqual([
      ["20x örüyoruz", "work 20sc"],
      ["28x örüyoruz", "work 28sc"],
    ]);
  });

  it("follows provider-style length changes before, between and after units", () => {
    const parse = parseFrames(TWO_STITCH_COUNTS);
    const units = renderUnits(parse, "en");
    const frames = protectFrames(parse, units);
    const [first, second] = frames.tokens;
    const output = `First, ${first!.placeholder}; then, carefully, ${second!.placeholder}!!`;
    const restored = restoreFrames(output, frames);
    expect(restored.text).toBe("First, work 20sc; then, carefully, work 28sc!!");
    const result = placeRenderedUnits(restored, units);
    expect(result.valid).toBe(true);
    expect(described(result.pieces, restored.text)).toEqual([
      ["20x örüyoruz", "work 20sc"],
      ["28x örüyoruz", "work 28sc"],
    ]);
    expect(result.pieces.map(({ targetStart }) => targetStart)).toEqual([7, 35]);
  });

  it("mixes a whole-unit piece and semantic pieces in one carrier", () => {
    const source = "20x örüyoruz.\n2-25) 24 sıra 20x";
    const parse = parseFrames(source);
    const [stitch] = renderUnits(parse, "en");
    const { unit: course } = courseCountUnit(source, "round");
    const frames = protectFrames(parse, [stitch!, course]);
    const restored = restoreFrames(frames.text, frames);
    expect(restored.text).toBe("work 20sc.\n2-25) 20sc for 24 rounds");
    const result = placeRenderedUnits(restored, [stitch!, course]);
    expect(described(result.pieces, restored.text)).toEqual([
      ["20x örüyoruz", "work 20sc"],
      ["20x", "20sc"],
      ["24 sıra ", " for 24 rounds"],
    ]);
  });

  it("uses JavaScript UTF-16 offsets", () => {
    const source = "🧶🧶\n13) 5 sıra 16x";
    const { parse, unit } = courseCountUnit(source, "row");
    const frames = protectFrames(parse, [unit]);
    const restored = restoreFrames(frames.text, frames);
    const result = placeRenderedUnits(restored, [unit]);
    expect(result.pieces.map(({ targetStart, targetEnd }) => [targetStart, targetEnd])).toEqual([
      [9, 13],
      [13, 24],
    ]);
    expect(described(result.pieces, restored.text)).toEqual([
      ["16x", "16sc"],
      ["5 sıra ", " for 5 rows"],
    ]);
    expect(restored.text.length).toBe(24);
  });
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

describe("placeRenderedUnits: refusals", () => {
  const source = "13) 5 sıra 16x";
  const { parse, unit } = courseCountUnit(source, "row");
  const frames = protectFrames(parse, [unit]);
  const restored = restoreFrames(frames.text, frames);
  const withPieces = (pieces: readonly RenderPiece[]): PlaceableUnit => ({ ...unit, pieces });
  const [stitchPiece, coursePiece] = unit.pieces;

  const refused = (restoredInput: RestoredFrames, units: readonly PlaceableUnit[]) => {
    const result = placeRenderedUnits(restoredInput, units);
    expect(result.valid).toBe(false);
    expect(result.pieces).toEqual([]);
    return result.errors;
  };

  it("refuses an invalid restoration (for example a duplicated placeholder)", () => {
    const duplicated = restoreFrames(`${frames.tokens[0]!.placeholder} ${frames.tokens[0]!.placeholder}`, frames);
    expect(duplicated.valid).toBe(false);
    expect(refused(duplicated, [unit])).toEqual(["Restoration is invalid; nothing can be placed."]);
  });

  it("refuses a placement/unit count mismatch (a missing or extra unit)", () => {
    expect(refused(restored, [])).toEqual(["Expected 0 placement(s), got 1."]);
    expect(refused(restored, [unit, unit])).toEqual(["Expected 2 placement(s), got 1."]);
  });

  it("refuses a placement whose source span is not the unit's", () => {
    const other: PlaceableUnit = { ...unit, sourceSpan: span(source, 3, 14) };
    expect(refused(restored, [other])).toEqual(["Unit 0 placement source 4..14 is not the unit span 3..14."]);
  });

  it("refuses when the restored text at the placement is not the unit text", () => {
    const tampered: RestoredFrames = { ...restored, text: "13) 16sc for 5 rounds" };
    expect(refused(tampered, [unit])).toEqual(["Unit 0 text does not match the restored text at 4..19."]);
  });

  it("refuses a malformed placement", () => {
    const beyond: RestoredFrames = { ...restored, pieces: [{ ...restored.pieces[0]!, targetEnd: 99 }] };
    const negative: RestoredFrames = { ...restored, pieces: [{ ...restored.pieces[0]!, targetStart: -1 }] };
    expect(refused(beyond, [unit])).toEqual(["Unit 0 placement 4..99 is malformed."]);
    expect(refused(negative, [unit])).toEqual(["Unit 0 placement -1..19 is malformed."]);
  });

  it("refuses a semantic piece outside the unit source span", () => {
    const moved = { ...coursePiece!, sourceSpan: span(source, 0, 11) };
    expect(refused(restored, [withPieces([stitchPiece!, moved])])[0]).toBe(
      "Unit 0 piece 1 source 0..11 lies outside the unit source span 4..14.",
    );
  });

  it("refuses a semantic piece target outside the unit text", () => {
    expect(refused(restored, [withPieces([stitchPiece!, { ...coursePiece!, targetEnd: 16 }])])).toEqual([
      "Unit 0 piece 1 target 4..16 lies outside the unit text (0..15).",
    ]);
  });

  it("refuses overlapping source pieces", () => {
    const overlapping = { ...coursePiece!, sourceSpan: span(source, 4, 12) };
    expect(refused(restored, [withPieces([stitchPiece!, overlapping])])).toEqual([
      "Unit 0 source pieces overlap at 11.",
    ]);
  });

  it("refuses a source gap", () => {
    const short = { ...coursePiece!, sourceSpan: span(source, 4, 10) };
    expect(refused(restored, [withPieces([stitchPiece!, short])])).toEqual([
      "Unit 0 source pieces leave a gap at 10..11.",
    ]);
  });

  it("refuses overlapping target pieces", () => {
    expect(refused(restored, [withPieces([{ ...stitchPiece!, targetEnd: 5 }, coursePiece!])])).toEqual([
      "Unit 0 target pieces overlap at 4.",
    ]);
  });

  it("refuses a target gap", () => {
    expect(refused(restored, [withPieces([{ ...stitchPiece!, targetEnd: 3 }, coursePiece!])])).toEqual([
      "Unit 0 target pieces leave a gap at 3..4.",
    ]);
  });

  it("refuses an empty piece list", () => {
    expect(refused(restored, [withPieces([])])).toEqual(["Unit 0 has an empty piece list."]);
  });

  it("refuses a piece whose raw text is not the source slice", () => {
    const wrong = { ...stitchPiece!, sourceSpan: { ...stitchPiece!.sourceSpan, raw: "17x" } };
    expect(refused(restored, [withPieces([wrong, coursePiece!])])).toEqual([
      "Unit 0 piece 0 source raw text is not the unit source slice.",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Shift, prefix and projection adapter
// ---------------------------------------------------------------------------

describe("shiftPlacedPieces", () => {
  const pieces: PlacedPiece[] = [{ sourceSpan: { start: 4, end: 7, raw: "abc" }, targetStart: 0, targetEnd: 3 }];

  it("shifts target ranges only", () => {
    expect(shiftPlacedPieces(pieces, 4)).toEqual([{ sourceSpan: pieces[0]!.sourceSpan, targetStart: 4, targetEnd: 7 }]);
    expect(shiftPlacedPieces(pieces, 0)).toEqual(pieces);
  });

  it("shifts by a UTF-16 prefix length", () => {
    expect(shiftPlacedPieces(pieces, "🧶) ".length)[0]).toMatchObject({ targetStart: 4, targetEnd: 7 });
  });

  it("rejects a negative or non-integer offset", () => {
    expect(() => shiftPlacedPieces(pieces, -1)).toThrow(PlacementError);
    expect(() => shiftPlacedPieces(pieces, 1.5)).toThrow(PlacementError);
  });

  it("returns new objects and does not mutate its input", () => {
    const snapshot = structuredClone(pieces);
    const shifted = shiftPlacedPieces(pieces, 2);
    expect(shifted).not.toBe(pieces);
    expect(pieces).toEqual(snapshot);
  });
});

describe("prefixIdentityPiece", () => {
  it("maps an exact restored prefix to itself", () => {
    expect(prefixIdentityPiece("13) 5 sıra 16x", 4, "13) 16sc for 5 rows")).toEqual({
      sourceSpan: { start: 0, end: 4, raw: "13) " },
      targetStart: 0,
      targetEnd: 4,
    });
  });

  it("measures in UTF-16", () => {
    expect(prefixIdentityPiece("🧶 5 sıra 16x", 3, "🧶 16sc")).toMatchObject({ targetEnd: 3 });
  });

  it.each([
    ["the output does not start with the prefix", "13) 5 sıra 16x", 4, "14) 16sc for 5 rows"],
    ["an empty prefix", "13) 5 sıra 16x", 0, "13) x"],
    ["a prefix past the source", "13)", 5, "13) x"],
    ["a non-integer prefix end", "13) 5", 1.5, "13) 5"],
  ])("is undefined when %s", (_label, source, prefixEnd, output) => {
    expect(prefixIdentityPiece(source, prefixEnd, output)).toBeUndefined();
  });
});

describe("toProjectionPieces", () => {
  it("converts to the existing projection piece shape without reordering", () => {
    const pieces: PlacedPiece[] = [
      { sourceSpan: { start: 11, end: 14, raw: "16x" }, targetStart: 4, targetEnd: 8 },
      { sourceSpan: { start: 4, end: 11, raw: "5 sıra " }, targetStart: 8, targetEnd: 19 },
    ];
    expect(toProjectionPieces(pieces)).toEqual([
      { sourceStart: 11, sourceEnd: 14, targetStart: 4, targetEnd: 8 },
      { sourceStart: 4, sourceEnd: 11, targetStart: 8, targetEnd: 19 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Purity and module contract
// ---------------------------------------------------------------------------

describe("placement: purity", () => {
  it("is deterministic and does not mutate the restoration, units or pieces", () => {
    const { parse, unit } = courseCountUnit("13) 5 sıra 16x", "row");
    const frames = protectFrames(parse, [unit]);
    const restored = restoreFrames(frames.text, frames);
    const restoredSnapshot = structuredClone(restored);
    const unitSnapshot = structuredClone(unit);
    const first = placeRenderedUnits(restored, [unit]);
    expect(placeRenderedUnits(restored, [unit])).toEqual(first);
    expect(first.pieces).not.toBe(placeRenderedUnits(restored, [unit]).pieces);
    expect(restored).toEqual(restoredSnapshot);
    expect(unit).toEqual(unitSnapshot);
  });
});

describe("placement: module contract", () => {
  const code = readFileSync(fileURLToPath(new URL("../placement.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("imports types only, from the parser IR, the renderer and frame protection", () => {
    const imports = [...code.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((match) => match[1]);
    expect(imports.sort()).toEqual(["../parser/frame_ir.js", "../renderer/frame_renderer.js", "./frame_protection.js"]);
    expect(code).not.toMatch(/^import\s+(?!type\b)/m);
  });

  it("stays independent of natural-language, translator, projection and provider code", () => {
    expect(code).not.toMatch(/natural_language|normalizeTranslationStyle|translator|formatting_projection|provider|validator/);
  });

  it("has no module-level mutable state and no code-point indexing", () => {
    expect(code).not.toMatch(/^(?:export\s+)?(?:let|var)\s/m);
    expect(code).not.toMatch(/Array\.from|codePointAt|\[\.\.\.\w+\]\.length/);
  });
});
