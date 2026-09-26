/**
 * Corpus shadow coverage for frame placeholder protection (Stage 1, Task 5).
 *
 * For every corpus block, English render units are protected and the carrier
 * is restored as-is (echo, standing in for a provider that returns the
 * placeholders untouched). The restored text is a deliberate SHADOW artifact:
 * the source with only the unit spans replaced by canonical frame text. It is
 * never compared with the stored English translations.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCorpus } from "../../__tests__/corpus/load_corpus.js";
import { parseFrames } from "../../parser/frame_parser.js";
import { renderUnits, type RenderUnit } from "../../renderer/frame_renderer.js";
import { protectFrames, restoreFrames } from "../frame_protection.js";

const cases = loadCorpus().cases;

const blocks = cases.flatMap(({ caseId, value }) =>
  value.request.blocks.map((block) => ({
    label: `${caseId} ${block.id}`,
    lane: value.lane,
    targetLanguage: value.request.targetLanguage,
    text: block.text,
  })),
);

/** The source with only the unit spans replaced by their canonical text. */
const expectedEcho = (source: string, units: readonly RenderUnit[]): string => {
  let text = "";
  let cursor = 0;
  for (const unit of units) {
    text += source.slice(cursor, unit.sourceSpan.start) + unit.text;
    cursor = unit.sourceSpan.end;
  }
  return text + source.slice(cursor);
};

const frameBearing = blocks.filter(({ text }) => parseFrames(text).nodes.some(({ kind }) => kind === "frame"));

describe("frame protection shadow: frame-bearing corpus blocks", () => {
  it(`[diagnostic] ${frameBearing.length} frame-bearing block(s) (not frozen)`, () => {
    expect(frameBearing.length).toBeGreaterThan(0);
  });

  it.each(frameBearing.map(({ label, text }) => [label, text] as const))(
    "%s: protects, echo-restores exactly, and emits exact pieces",
    (_label, text) => {
      const parse = parseFrames(text);
      const units = renderUnits(parse, "en");
      const frames = protectFrames(parse, units);

      for (const unit of units) expect(frames.text).not.toContain(unit.sourceSpan.raw);
      let outside = "";
      let cursor = 0;
      for (const unit of units) {
        outside += text.slice(cursor, unit.sourceSpan.start);
        cursor = unit.sourceSpan.end;
      }
      outside += text.slice(cursor);
      expect(frames.text.split(/__XQ[A-Z]{4}QX__/u).join("")).toBe(outside);

      const restored = restoreFrames(frames.text, frames);
      expect(restored.valid).toBe(true);
      expect(restored.text).toBe(expectedEcho(text, units));
      expect(restored.pieces).toHaveLength(units.length);
      restored.pieces.forEach((piece, index) => {
        const unit = units[index]!;
        expect([piece.sourceStart, piece.sourceEnd]).toEqual([unit.sourceSpan.start, unit.sourceSpan.end]);
        expect(restored.text.slice(piece.targetStart, piece.targetEnd)).toBe(unit.text);
      });

      expect(protectFrames(parseFrames(text), renderUnits(parseFrames(text), "en"))).toEqual(frames);
    },
  );
});

describe("frame protection shadow: blocks without English units", () => {
  const withoutUnits = blocks.filter(({ targetLanguage, lane }) => targetLanguage === "es" || lane === "repro");

  it.each(withoutUnits.map(({ label, text, targetLanguage }) => [label, text, targetLanguage] as const))(
    "%s: no units in its own language, carrier equals source, restore is identity",
    (_label, text, targetLanguage) => {
      const parse = parseFrames(text);
      const units = renderUnits(parse, targetLanguage);
      expect(units).toEqual([]);
      const frames = protectFrames(parse, units);
      expect(frames).toEqual({ source: text, text, tokens: [] });
      expect(restoreFrames(text, frames)).toEqual({ text, valid: true, errors: [], pieces: [] });
    },
  );

  it("covers all four repro cases, which have no units even in English", () => {
    const repros = cases.filter(({ value }) => value.lane === "repro");
    expect(repros).toHaveLength(4);
    for (const { value } of repros) {
      for (const block of value.request.blocks) {
        expect(renderUnits(parseFrames(block.text), "en")).toEqual([]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Production isolation: assembly is a shadow until a later task wires it.
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

describe("frame protection shadow: production isolation", () => {
  it("is not imported by any production module", () => {
    const importers = productionFiles(sourceRoot)
      .filter((path) => !path.includes(assemblyDirectory))
      .filter((path) => /frame_protection/.test(readFileSync(path, "utf8")))
      .map((path) => relative(sourceRoot, path));
    expect(importers).toEqual([]);
  });
});
