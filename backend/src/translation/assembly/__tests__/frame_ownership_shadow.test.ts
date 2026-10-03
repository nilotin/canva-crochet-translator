/**
 * Corpus shadow diagnostic for frame / normalizer ownership (Stage 1, Task 7).
 *
 * Classifies every render unit of every corpus block in the block's own target
 * language. Totals are reported in a test name only (not frozen: new frames
 * or normalizer changes may move them). A few representative cases are
 * pinned because they document current legacy ownership:
 *  - separable: the frame can leave normalizer ownership without changing the
 *    normalized text or resolution;
 *  - resolution-lost: the segment is fully resolved only because the
 *    normalizer sees the frame text;
 *  - normalized-text-differs: a larger normalizer rule uses the frame text.
 * These are migration-eligibility signals, not routing decisions.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCorpus } from "../../__tests__/corpus/load_corpus.js";
import { parseFrames } from "../../parser/frame_parser.js";
import { renderUnits } from "../../renderer/frame_renderer.js";
import { classifyFrameOwnership, type FrameOwnershipResult } from "../frame_ownership.js";

const cases = loadCorpus().cases;

const classified = cases.flatMap(({ caseId, value }) =>
  value.request.blocks.flatMap((block) =>
    classifyFrameOwnership(
      block.text,
      renderUnits(parseFrames(block.text), value.request.targetLanguage),
      value.request.targetLanguage,
    ).map((result) => ({ caseId, blockId: block.id, result })),
  ),
);

const separable = classified.filter(({ result }) => result.ownership === "separable").length;
const entangled = classified.length - separable;

/** The one classification of `raw` in the case whose id starts with `prefix`. */
const pinned = (prefix: string, raw: string): FrameOwnershipResult => {
  const matches = classified.filter(
    ({ caseId, result }) => caseId.startsWith(prefix) && result.unit.sourceSpan.raw === raw,
  );
  expect(matches).toHaveLength(1);
  return matches[0]!.result;
};

describe("frame ownership shadow: corpus diagnostic", () => {
  it(`[diagnostic] ${separable} separable + ${entangled} entangled unit(s) in own target language (not frozen)`, () => {
    expect(classified.length).toBe(separable + entangled);
  });

  it("classifies every result consistently: separable exactly when there are no reasons", () => {
    for (const { result } of classified) {
      expect(result.ownership === "separable").toBe(result.reasons.length === 0);
    }
  });

  it("is deterministic across the corpus", () => {
    for (const { value } of cases) {
      for (const block of value.request.blocks) {
        const units = renderUnits(parseFrames(block.text), value.request.targetLanguage);
        expect(classifyFrameOwnership(block.text, units, value.request.targetLanguage)).toEqual(
          classifyFrameOwnership(block.text, units, value.request.targetLanguage),
        );
      }
    }
  });
});

describe("frame ownership shadow: representative pins", () => {
  it.each([
    ["h-127de8dd49", "20x örüyoruz"],
    ["h-2c5ac91027", "28x örüyoruz"],
  ])("%s %j is separable", (prefix, raw) => {
    expect(pinned(prefix, raw)).toMatchObject({ ownership: "separable", reasons: [] });
  });

  it("c-a5774e3d02 20x örüyoruz: same text, but the segment stops being fully resolved", () => {
    expect(pinned("c-a5774e3d02", "20x örüyoruz")).toMatchObject({
      ownership: "entangled",
      reasons: ["resolution-lost"],
    });
  });

  it("h-90a8b78a12 chain -> turn: the normalizer rule consumes the frame text", () => {
    const result = pinned("h-90a8b78a12", "20 zincir çekip dönüyoruz");
    expect(result.ownership).toBe("entangled");
    expect(result.reasons).toContain("normalized-text-differs");
  });

  it("h-d439fbc34a 12x örüyoruz: part of the multi-clause 'Nx örüyoruz, ipimizi kesmeden ...' rule", () => {
    expect(pinned("h-d439fbc34a", "12x örüyoruz")).toMatchObject({
      ownership: "entangled",
      reasons: ["normalized-text-differs"],
    });
  });

  it("the sleeve-shaping units stay entangled", () => {
    const sleeve = classified.filter(
      ({ caseId }) => caseId.startsWith("c-1bb09c4de3") || caseId.startsWith("c-4132b504c9"),
    );
    expect(sleeve.length).toBeGreaterThan(0);
    for (const { result } of sleeve) expect(result.ownership).toBe("entangled");
  });
});

describe("frame ownership shadow: repro and Spanish cases", () => {
  it("R1-R4 produce no units and therefore no ownership results", () => {
    // The measured Stage 0 hazard cases (R4 is now an approved curated case).
    const repros = cases.filter(({ value }) => value.labels.hazards.length > 0);
    expect(repros).toHaveLength(4);
    expect(classified.filter(({ caseId }) => repros.some((repro) => repro.caseId === caseId))).toEqual([]);
  });

  it("Spanish blocks produce no units in their own language, so nothing is classified", () => {
    const spanish = new Set(cases.filter(({ value }) => value.request.targetLanguage === "es").map(({ caseId }) => caseId));
    expect(spanish.size).toBeGreaterThan(0);
    expect(classified.filter(({ caseId }) => spanish.has(caseId))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Production isolation: the ownership probe is a shadow measurement.
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

describe("frame ownership shadow: production isolation", () => {
  it("is not imported by any production module", () => {
    const importers = productionFiles(sourceRoot)
      .filter((path) => !path.includes(assemblyDirectory))
      .filter((path) => /frame_ownership/.test(readFileSync(path, "utf8")))
      .map((path) => relative(sourceRoot, path));
    expect(importers).toEqual([]);
  });
});
