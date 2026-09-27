/**
 * Shadow evidence for context-aware course_count rendering (next stage, Task 2).
 *
 * R3: the typed PatternContext reads row, and `renderCourseCount` renders
 * "13) 16sc for 5 rows" in shadow (production is unchanged and R3 stays
 * known-bad). h-2c6ae438a1: the render pieces reproduce production's
 * reordered formatting ownership exactly. Production's semantic projection
 * helper (`projectBareRoundCountAtomicFormattingRegions`) and PatternContext
 * are imported here read-only; the renderer imports neither.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCorpus } from "../../__tests__/corpus/load_corpus.js";
import { foldPatternContext } from "../../context/pattern_context.js";
import { projectBareRoundCountAtomicFormattingRegions } from "../../formatting_projection.js";
import type { CourseCountFrame } from "../../parser/frame_ir.js";
import { parseFrames } from "../../parser/frame_parser.js";
import {
  renderCourseCount,
  renderUnits,
  type CourseCountRenderUnit,
  type RenderPiece,
} from "../frame_renderer.js";

const cases = loadCorpus().cases;

const courseCountFrames = (source: string): CourseCountFrame[] =>
  parseFrames(source).nodes.filter(
    (node): node is CourseCountFrame => node.kind === "frame" && node.action === "course_count",
  );

/** Splices a rendered unit into its source, leaving everything outside the unit as is. */
const splice = (source: string, unit: CourseCountRenderUnit): string =>
  source.slice(0, unit.sourceSpan.start) + unit.text + source.slice(unit.sourceSpan.end);

type Region = { readonly id: string; readonly start: number; readonly end: number };

/**
 * Test-only adapter reproducing production's owner-per-piece rule
 * (`projectOwnedSemanticPieces` in formatting_projection.ts, not exported):
 * every piece's source span must lie inside exactly one region, runs are
 * sorted by target, adjacent runs of one region merge, and together they must
 * cover the target exactly. Otherwise it refuses (undefined), never guesses.
 */
const projectOwnedPieces = (
  pieces: readonly RenderPiece[],
  regions: readonly Region[],
  targetLength: number,
): Region[] | undefined => {
  const runs: Region[] = [];
  for (const piece of pieces) {
    const owners = regions.filter(
      ({ start, end }) => start <= piece.sourceSpan.start && end >= piece.sourceSpan.end,
    );
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

// ---------------------------------------------------------------------------
// R3: typed context -> rendered text
// ---------------------------------------------------------------------------

describe("course_count rendering shadow: R3", () => {
  const r3 = cases.find(({ value }) => value.lane === "repro" && value.labels.hazards.includes("cross-block-context"));
  const blocks = r3?.value.request.blocks.map(({ text }) => text) ?? [];

  it("the course_count reads row from the typed PatternContext", () => {
    const traces = foldPatternContext(blocks);
    expect(traces[1]?.reads.map(({ event, courseKind }) => [event.span.raw, courseKind])).toEqual([
      ["5 sıra 16x", "row"],
    ]);
  });

  it("renders '16sc for 5 rows', keeps the marker outside and rebuilds '13) 16sc for 5 rows'", () => {
    const [read] = foldPatternContext(blocks)[1]!.reads;
    const [frame] = courseCountFrames(blocks[1]!);
    expect(frame!.span).toEqual(read!.event.span);
    const unit = renderCourseCount(frame!, read!.courseKind, "en")!;
    expect(unit.text).toBe("16sc for 5 rows");
    expect(unit.sourceSpan).toEqual({ start: 4, end: 14, raw: "5 sıra 16x" });
    expect(splice(blocks[1]!, unit)).toBe("13) 16sc for 5 rows");
  });

  it("leaves production unchanged: R3 stays known-bad with its recorded output", () => {
    expect(r3?.value.status).toBe("known-bad");
    expect(r3?.value.expected?.results.map(({ translated }) => translated)).toEqual([
      "12) At the end of each row, ch 1 and turn.",
      "13) 16sc for 5 rounds",
    ]);
  });
});

// ---------------------------------------------------------------------------
// h-2c6ae438a1: reordered formatting ownership
// ---------------------------------------------------------------------------

describe("course_count rendering shadow: h-2c6ae438a1 formatting", () => {
  const found = cases.find(({ caseId }) => caseId.startsWith("h-2c6ae438a1"));
  const block = found!.value.request.blocks[0]!;
  const golden = found!.value.expected!.results[0]!;
  const lineEnd = block.text.indexOf("\n");
  const line = block.text.slice(0, lineEnd);
  const [frame] = courseCountFrames(block.text);
  // The typed context for this block is unknown (no typed row/round evidence),
  // so the proof passes production's round wording explicitly.
  const unit = renderCourseCount(frame!, "round", "en")!;
  const markerPiece: RenderPiece = {
    sourceSpan: { start: 0, end: unit.sourceSpan.start, raw: line.slice(0, unit.sourceSpan.start) },
    targetStart: 0,
    targetEnd: unit.sourceSpan.start,
  };
  const targetLine = line.slice(0, unit.sourceSpan.start) + unit.text;
  const linePieces: RenderPiece[] = [
    markerPiece,
    ...unit.pieces.map((piece) => ({
      ...piece,
      targetStart: piece.targetStart + unit.sourceSpan.start,
      targetEnd: piece.targetEnd + unit.sourceSpan.start,
    })),
  ];
  const lineRegions: Region[] = (block.formattingRegions ?? [])
    .filter(({ start }) => start < lineEnd)
    .map(({ id, start, end }) => ({ id, start, end: Math.min(end, lineEnd) }));

  it("typed PatternContext is unknown here; the line renders as production's golden text with round", () => {
    expect(foldPatternContext([block.text])[0]?.reads.map(({ courseKind }) => courseKind)).toEqual(["unknown"]);
    expect(line).toBe("2-11) 10 sıra 64x");
    expect(targetLine).toBe("2-11) 64sc for 10 rounds");
    expect(golden.translated.startsWith(`${targetLine}\n`)).toBe(true);
  });

  it("projects the pieces onto the same reordered runs as production's semantic helper and the golden", () => {
    const projected = projectOwnedPieces(linePieces, lineRegions, targetLine.length);
    expect(projected).toEqual([
      { id: "fmt-0", start: 0, end: 6 },
      { id: "fmt-2", start: 6, end: 10 },
      { id: "fmt-1", start: 10, end: 24 },
    ]);
    expect(projected).toEqual(projectBareRoundCountAtomicFormattingRegions(line, targetLine, lineRegions));
    expect(golden.targetFormattingRegions?.slice(0, 3)).toEqual(projected);
  });

  it.each([
    ["inside the stitch piece '64x'", 15],
    ["inside the course piece '10 sıra '", 9],
  ])("refuses, like production, when a formatting boundary falls %s", (_label, split) => {
    const regions: Region[] = [
      { id: "fmt-0", start: 0, end: 6 },
      { id: "fmt-a", start: 6, end: split },
      { id: "fmt-b", start: split, end: 17 },
    ];
    expect(projectOwnedPieces(linePieces, regions, targetLine.length)).toBeUndefined();
    expect(projectBareRoundCountAtomicFormattingRegions(line, targetLine, regions)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// renderUnits is unchanged
// ---------------------------------------------------------------------------

describe("course_count rendering shadow: renderUnits is unchanged", () => {
  it("still emits only stitch_count and chain_turn units across the corpus, and none for course_count", () => {
    for (const { value } of cases) {
      for (const { text } of value.request.blocks) {
        const units = renderUnits(parseFrames(text), "en");
        for (const unit of units) expect(["stitch_count", "chain_turn"]).toContain(unit.kind);
        for (const frame of courseCountFrames(text)) {
          expect(units.some(({ sourceSpan }) => sourceSpan.start === frame.span.start)).toBe(false);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Production isolation: renderCourseCount is shadow infrastructure only.
// ---------------------------------------------------------------------------

const sourceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const rendererDirectory = `${sep}translation${sep}renderer${sep}`;

const productionFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : productionFiles(path);
    }
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });

describe("course_count rendering shadow: production isolation", () => {
  it("no module outside the renderer uses renderCourseCount", () => {
    const users = productionFiles(sourceRoot)
      .filter((path) => !path.includes(rendererDirectory))
      .filter((path) => /renderCourseCount|CourseCountRenderUnit|RenderPiece/.test(readFileSync(path, "utf8")))
      .map((path) => relative(sourceRoot, path));
    expect(users).toEqual([]);
  });
});
