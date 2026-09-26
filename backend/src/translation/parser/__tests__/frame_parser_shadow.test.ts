/**
 * Corpus shadow coverage for the frame parser (Stage 1, Task 2).
 *
 * Runs the parser over every corpus source block and asserts STRUCTURAL
 * invariants only: no dropped text, no overlaps, exact reconstruction,
 * determinism, and well-formed slots. Which clauses become frames is NOT
 * frozen per case: the number of recognized frames is reported as a
 * diagnostic in a test name, never asserted, so widening admission later is
 * not a corpus regression.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCorpus } from "../../__tests__/corpus/load_corpus.js";
import { parseInvariantIssues, reconstructParse } from "../frame_ir.js";
import { STITCH_COUNT_CONCEPTS, parseFrames } from "../frame_parser.js";

const corpusBlocks = loadCorpus().cases.flatMap(({ caseId, value }) =>
  value.request.blocks.map((block) => ({ caseId, blockId: block.id, text: block.text })),
);

const labelled = corpusBlocks.map((block) => [`${block.caseId} ${block.blockId}`, block.text] as const);

const recognizedFrames = corpusBlocks.reduce(
  (sum, { text }) => sum + parseFrames(text).nodes.filter(({ kind }) => kind === "frame").length,
  0,
);

describe("frame parser shadow: corpus source blocks", () => {
  it("covers every corpus case, pending and known-bad included", () => {
    expect(new Set(corpusBlocks.map(({ caseId }) => caseId)).size).toBe(loadCorpus().cases.length);
  });

  it.each(labelled)("%s: exact, gap-free, overlap-free and deterministic", (_label, text) => {
    const parse = parseFrames(text);
    expect(parseInvariantIssues(parse)).toEqual([]);
    expect(reconstructParse(parse.nodes)).toBe(text);
    expect(parseFrames(text)).toEqual(parse);
  });

  it.each(labelled)("%s: every frame is one well-formed stitch_count action", (_label, text) => {
    for (const node of parseFrames(text).nodes) {
      if (node.kind !== "frame") continue;
      expect(node.action).toBe("stitch_count");
      expect(STITCH_COUNT_CONCEPTS).toContain(node.slots.stitch.concept);
      expect(node.slots.count.value).toBe(Number(node.slots.count.span.raw));
      expect(node.span.start).toBe(node.slots.count.span.start);
      expect(node.span.end).toBe(node.slots.verb.span.end);
    }
  });

  it(`[diagnostic] ${recognizedFrames} stitch_count frame(s) recognized across the corpus (not frozen)`, () => {
    expect(recognizedFrames).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Production isolation: the parser is a shadow until a later task wires it.
// ---------------------------------------------------------------------------

const sourceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const parserDirectory = `${sep}translation${sep}parser${sep}`;

const productionFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : productionFiles(path);
    }
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });

describe("frame parser shadow: production isolation", () => {
  it("is not imported by any production module", () => {
    const importers = productionFiles(sourceRoot)
      .filter((path) => !path.includes(parserDirectory))
      .filter((path) => /frame_parser|frame_ir/.test(readFileSync(path, "utf8")))
      .map((path) => relative(sourceRoot, path));
    expect(importers).toEqual([]);
  });
});
