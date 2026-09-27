/**
 * Corpus shadow coverage for the frame parser (Stage 1, Tasks 2-3).
 *
 * Runs the parser over every corpus source block and asserts STRUCTURAL
 * invariants only: no dropped text, no overlaps, exact reconstruction,
 * determinism, and well-formed slots. Which clauses become frames is NOT
 * frozen per case. The one pinned number is the stitch_count total (7): Task 3
 * must not change stitch_count, so that count guards it. New chain/turn counts
 * are reported as diagnostics in test names, never asserted, so widening
 * admission later is not a corpus regression.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCorpus } from "../../__tests__/corpus/load_corpus.js";
import { parseInvariantIssues, reconstructParse, type Frame } from "../frame_ir.js";
import { CHAIN_CONCEPT, COURSE_WORDS, STITCH_COUNT_CONCEPTS, parseFrames } from "../frame_parser.js";

const corpusBlocks = loadCorpus().cases.flatMap(({ caseId, value }) =>
  value.request.blocks.map((block) => ({ caseId, blockId: block.id, text: block.text })),
);

const labelled = corpusBlocks.map((block) => [`${block.caseId} ${block.blockId}`, block.text] as const);

const corpusFrames: Frame[] = corpusBlocks.flatMap(({ text }) =>
  parseFrames(text).nodes.filter((node): node is Frame => node.kind === "frame"),
);
const countOf = (action: Frame["action"]) =>
  corpusFrames.filter((frame) => frame.action === action).length;

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

  it.each(labelled)("%s: every frame is one well-formed action", (_label, text) => {
    for (const node of parseFrames(text).nodes) {
      if (node.kind !== "frame") continue;
      switch (node.action) {
        case "stitch_count":
          expect(node.span.end).toBe(node.slots.verb.span.end);
          expect(node.slots.verb.form).toBe("finite");
          expect(STITCH_COUNT_CONCEPTS).toContain(node.slots.stitch.concept);
          expect(node.slots.count.value).toBe(Number(node.slots.count.span.raw));
          expect(node.span.start).toBe(node.slots.count.span.start);
          break;
        case "chain":
          expect(node.span.end).toBe(node.slots.verb.span.end);
          expect(node.slots.verb.form).toBe("converb");
          expect(node.slots.unit.concept).toBe(CHAIN_CONCEPT);
          expect(node.slots.count.value).toBe(Number(node.slots.count.span.raw));
          expect(node.span.start).toBe(node.slots.count.span.start);
          break;
        case "turn":
          expect(node.slots.verb.form).toBe("finite");
          expect(node.span).toEqual(node.slots.verb.span);
          break;
        case "course_end_turn":
          expect(node.span.end).toBe(node.slots.verb.span.end);
          expect(node.slots.verb.form).toBe("finite");
          expect(node.slots.converb.form).toBe("converb");
          expect(node.slots.unit.concept).toBe(CHAIN_CONCEPT);
          expect(node.slots.count.value).toBe(Number(node.slots.count.span.raw));
          expect(node.span.start).toBe(node.slots.scope.span.start);
          break;
        case "course_count":
          expect(COURSE_WORDS.has(node.slots.course.span.raw)).toBe(true);
          expect(STITCH_COUNT_CONCEPTS).toContain(node.slots.stitch.concept);
          expect(node.slots.courses.value).toBe(Number(node.slots.courses.span.raw));
          expect(node.slots.count.value).toBe(Number(node.slots.count.span.raw));
          expect(node.span.start).toBe(node.slots.courses.span.start);
          expect(node.span.end).toBe(node.slots.stitch.span.end);
          break;
      }
    }
  });

  it("keeps exactly the 7 stitch_count frames recognized before chain/turn existed", () => {
    expect(countOf("stitch_count")).toBe(7);
  });

  it("recognizes chain and turn only as linked pairs", () => {
    expect(countOf("chain")).toBe(countOf("turn"));
  });

  it("keeps the 4 chain/turn pairs and adds 4 course_end_turn frames, without counting their slots as pairs", () => {
    expect([countOf("chain"), countOf("turn"), countOf("course_end_turn")]).toEqual([4, 4, 4]);
  });

  it("adds 6 course_count frames without changing any other count", () => {
    expect(countOf("course_count")).toBe(6);
    expect([countOf("stitch_count"), countOf("chain"), countOf("turn"), countOf("course_end_turn")]).toEqual([
      7, 4, 4, 4,
    ]);
  });

  it(`[diagnostic] ${countOf("chain")} chain + ${countOf("turn")} turn frame(s) recognized across the corpus (not frozen)`, () => {
    expect(countOf("chain")).toBeGreaterThanOrEqual(0);
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
      // The shadow frame renderer consumes the IR; its own isolation test
      // (renderer/__tests__/frame_renderer_shadow.test.ts) keeps it out of production.
      .filter((path) => !path.includes(`${sep}translation${sep}renderer${sep}`))
      // Shadow frame protection consumes the IR and render units; its own isolation
      // test (assembly/__tests__/frame_protection_shadow.test.ts) keeps it out of production.
      .filter((path) => !path.includes(`${sep}translation${sep}assembly${sep}`))
      // Shadow PatternContext consumes this module; its own isolation test
      // (context/__tests__/pattern_context_shadow.test.ts) keeps it out of production.
      .filter((path) => !path.includes(`${sep}translation${sep}context${sep}`))
      .filter((path) => /frame_parser|frame_ir/.test(readFileSync(path, "utf8")))
      .map((path) => relative(sourceRoot, path));
    expect(importers).toEqual([]);
  });
});
