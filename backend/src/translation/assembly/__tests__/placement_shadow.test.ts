/**
 * Shadow evidence for frame placement (next stage, Task 4).
 *
 * R3: the typed pipeline (PatternContext -> renderCourseCount -> protect ->
 * restore on the marker-stripped body -> place -> shift by the marker prefix)
 * gives exact final pieces for "13) 16sc for 5 rows". h-2c6ae438a1: the final
 * pieces project onto the corpus golden formatting runs, the same result as
 * production's semantic helper. Style normalization is NOT run: placed
 * coordinates are only valid for the exact restored text, and a later caller
 * must drop them if style normalization changes it. Production is unchanged.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCorpus } from "../../__tests__/corpus/load_corpus.js";
import { foldPatternContext } from "../../context/pattern_context.js";
import { projectBareRoundCountAtomicFormattingRegions } from "../../formatting_projection.js";
import { extractLeadingInstruction } from "../../instruction_marker.js";
import type { CourseCountFrame } from "../../parser/frame_ir.js";
import { parseFrames } from "../../parser/frame_parser.js";
import { renderCourseCount, renderUnits } from "../../renderer/frame_renderer.js";
import { protectFrames, restoreFrames } from "../frame_protection.js";
import {
  placeRenderedUnits,
  prefixIdentityPiece,
  shiftPlacedPieces,
  toProjectionPieces,
  type PlacedPiece,
} from "../placement.js";

const cases = loadCorpus().cases;

const courseCountFrame = (source: string): CourseCountFrame =>
  parseFrames(source).nodes.find(
    (node): node is CourseCountFrame => node.kind === "frame" && node.action === "course_count",
  )!;

type Region = { readonly id: string; readonly start: number; readonly end: number };

/**
 * Test-only copy of production's owner-per-piece rule (`projectOwnedSemanticPieces`
 * in formatting_projection.ts, not exported): each piece's source must lie in
 * exactly one region; runs are sorted, merged when adjacent and of one region,
 * and must cover the target exactly. Otherwise undefined.
 */
const projectOwnedPieces = (
  pieces: readonly { sourceStart: number; sourceEnd: number; targetStart: number; targetEnd: number }[],
  regions: readonly Region[],
  targetLength: number,
): Region[] | undefined => {
  const runs: Region[] = [];
  for (const piece of pieces) {
    const owners = regions.filter(({ start, end }) => start <= piece.sourceStart && end >= piece.sourceEnd);
    if (owners.length !== 1) return undefined;
    runs.push({ id: owners[0]!.id, start: piece.targetStart, end: piece.targetEnd });
  }
  const merged: Region[] = [];
  for (const run of [...runs].sort((left, right) => left.start - right.start)) {
    const previous = merged.at(-1);
    if (previous !== undefined && previous.id === run.id && previous.end === run.start) {
      merged[merged.length - 1] = { ...previous, end: run.end };
    } else {
      merged.push(run);
    }
  }
  let cursor = 0;
  for (const run of merged) {
    if (run.start !== cursor || run.end <= run.start) return undefined;
    cursor = run.end;
  }
  return cursor === targetLength ? merged : undefined;
};

const described = (pieces: readonly PlacedPiece[], output: string) =>
  pieces.map(({ sourceSpan, targetStart, targetEnd }) => [
    [sourceSpan.start, sourceSpan.end],
    [targetStart, targetEnd],
    sourceSpan.raw,
    output.slice(targetStart, targetEnd),
  ]);

// ---------------------------------------------------------------------------
// R3
// ---------------------------------------------------------------------------

describe("placement shadow: R3 final pieces", () => {
  const r3 = cases.find(({ value }) => value.lane === "repro" && value.labels.hazards.includes("cross-block-context"))!;
  const blocks = r3.value.request.blocks.map(({ text }) => text);
  const source = blocks[1]!;

  // 1-3: typed frame, typed context, context-aware render.
  const parse = parseFrames(source);
  const frame = courseCountFrame(source);
  const [read] = foldPatternContext(blocks)[1]!.reads;
  const unit = renderCourseCount(frame, read!.courseKind, "en")!;
  // 4-5: protect in block coordinates, then restore on the marker-stripped body,
  // exactly where production restores the marker afterwards.
  const frames = protectFrames(parse, [unit]);
  const instruction = extractLeadingInstruction(source)!;
  const bodyStart = source.length - instruction.body.length;
  const restoredBody = restoreFrames(frames.text.slice(bodyStart), frames);
  // 6: body coordinates.
  const bodyPlacement = placeRenderedUnits(restoredBody, [unit]);
  // 7-8: marker prefix.
  const finalText = source.slice(0, bodyStart) + restoredBody.text;
  const finalPieces = [
    prefixIdentityPiece(source, bodyStart, finalText)!,
    ...shiftPlacedPieces(bodyPlacement.pieces, bodyStart),
  ];

  it("reads row from PatternContext and renders the unit", () => {
    expect(read?.courseKind).toBe("row");
    expect(unit.text).toBe("16sc for 5 rows");
    expect(bodyStart).toBe(4);
  });

  it("places the pieces in body coordinates first", () => {
    expect(restoredBody.text).toBe("16sc for 5 rows");
    expect(bodyPlacement.valid).toBe(true);
    expect(described(bodyPlacement.pieces, restoredBody.text)).toEqual([
      [[11, 14], [0, 4], "16x", "16sc"],
      [[4, 11], [4, 15], "5 sıra ", " for 5 rows"],
    ]);
  });

  it("gives exact final pieces after the marker shift", () => {
    expect(finalText).toBe("13) 16sc for 5 rows");
    expect(described(finalPieces, finalText)).toEqual([
      [[0, 4], [0, 4], "13) ", "13) "],
      [[11, 14], [4, 8], "16x", "16sc"],
      [[4, 11], [8, 19], "5 sıra ", " for 5 rows"],
    ]);
  });

  it("covers the final text exactly, with no gaps or overlaps", () => {
    const byTarget = [...finalPieces].sort((left, right) => left.targetStart - right.targetStart);
    let cursor = 0;
    for (const piece of byTarget) {
      expect(piece.targetStart).toBe(cursor);
      cursor = piece.targetEnd;
    }
    expect(cursor).toBe(finalText.length);
  });

  it("leaves production unchanged: R3 stays known-bad with its recorded output", () => {
    expect(r3.value.status).toBe("known-bad");
    expect(r3.value.expected?.results[1]?.translated).toBe("13) 16sc for 5 rounds");
  });
});

// ---------------------------------------------------------------------------
// h-2c6ae438a1
// ---------------------------------------------------------------------------

describe("placement shadow: h-2c6ae438a1 final formatting", () => {
  const found = cases.find(({ caseId }) => caseId.startsWith("h-2c6ae438a1"))!;
  const block = found.value.request.blocks[0]!;
  const golden = found.value.expected!.results[0]!;
  const lineEnd = block.text.indexOf("\n");
  const line = block.text.slice(0, lineEnd);

  // The typed context is unknown here; "round" is passed explicitly for the
  // provenance proof only.
  const unit = renderCourseCount(courseCountFrame(line), "round", "en")!;
  const frames = protectFrames(parseFrames(line), [unit]);
  const restored = restoreFrames(frames.text, frames);
  const placement = placeRenderedUnits(restored, [unit]);
  // `extractLeadingInstruction` does not extract range markers, so "2-11) "
  // stays ordinary copied text inside the body; its identity is proven here.
  const prefixEnd = unit.sourceSpan.start;
  const finalPieces = [prefixIdentityPiece(line, prefixEnd, restored.text)!, ...placement.pieces];
  const lineRegions: Region[] = (block.formattingRegions ?? [])
    .filter(({ start }) => start < lineEnd)
    .map(({ id, start, end }) => ({ id, start, end: Math.min(end, lineEnd) }));

  it("keeps the typed context unknown and leaves the range marker to copied text", () => {
    expect(foldPatternContext([block.text])[0]?.reads.map(({ courseKind }) => courseKind)).toEqual(["unknown"]);
    expect(extractLeadingInstruction(line)).toBeUndefined();
  });

  it("gives exact final pieces", () => {
    expect(restored.text).toBe("2-11) 64sc for 10 rounds");
    expect(described(finalPieces, restored.text)).toEqual([
      [[0, 6], [0, 6], "2-11) ", "2-11) "],
      [[14, 17], [6, 10], "64x", "64sc"],
      [[6, 14], [10, 24], "10 sıra ", " for 10 rounds"],
    ]);
  });

  it("projects onto the golden runs, the same as production's semantic helper", () => {
    const projected = projectOwnedPieces(toProjectionPieces(finalPieces), lineRegions, restored.text.length);
    expect(projected).toEqual([
      { id: "fmt-0", start: 0, end: 6 },
      { id: "fmt-2", start: 6, end: 10 },
      { id: "fmt-1", start: 10, end: 24 },
    ]);
    expect(projected).toEqual(projectBareRoundCountAtomicFormattingRegions(line, restored.text, lineRegions));
    expect(golden.targetFormattingRegions?.slice(0, 3)).toEqual(projected);
  });
});

// ---------------------------------------------------------------------------
// Stage 1 assembly behavior is unchanged
// ---------------------------------------------------------------------------

describe("placement shadow: Stage 1 restoration is unchanged", () => {
  it("restoreFrames still emits exactly one whole-unit piece per render unit across the corpus", () => {
    for (const { value } of cases) {
      for (const { text } of value.request.blocks) {
        const parse = parseFrames(text);
        const units = renderUnits(parse, "en");
        if (units.length === 0 || text.includes("__XQ")) continue;
        const frames = protectFrames(parse, units);
        const restored = restoreFrames(frames.text, frames);
        expect(restored.pieces).toHaveLength(units.length);
        const placed = placeRenderedUnits(restored, units);
        expect(placed.valid).toBe(true);
        expect(toProjectionPieces(placed.pieces)).toEqual(restored.pieces);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Production isolation
// ---------------------------------------------------------------------------

const sourceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const assemblyDirectory = `${sep}translation${sep}assembly${sep}`;

const productionFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : productionFiles(path);
    }
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });

describe("placement shadow: production isolation", () => {
  it("no production module imports the placement helpers", () => {
    const importers = productionFiles(sourceRoot)
      .filter((path) => !path.includes(assemblyDirectory))
      .filter((path) => /assembly\/placement|placeRenderedUnits|PlacedPiece/.test(readFileSync(path, "utf8")))
      .map((path) => relative(sourceRoot, path));
    expect(importers).toEqual([]);
  });
});
