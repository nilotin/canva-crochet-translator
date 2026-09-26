/**
 * Corpus shadow coverage for the frame renderer (Stage 1, Task 4).
 *
 * Differential check: for every CHARACTERIZED English corpus case, each unit
 * the renderer produces must already appear (case-insensitively) in that
 * block's stored `expected` translation. Casing and punctuation are assembly
 * concerns, so only the canonical wording is compared. Pending cases have no
 * expected output and Spanish is not rendered, so neither is compared.
 *
 * Unit counts are reported as a diagnostic in a test name, never frozen.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCorpus } from "../../__tests__/corpus/load_corpus.js";
import { parseFrames } from "../../parser/frame_parser.js";
import { renderUnits } from "../frame_renderer.js";

const cases = loadCorpus().cases;

const characterizedEnglish = cases.flatMap(({ caseId, value }) =>
  value.status === "characterized" && value.request.targetLanguage === "en"
    ? value.request.blocks.map((block, index) => ({
        label: `${caseId} ${block.id}`,
        text: block.text,
        expected: value.expected?.results[index]?.translated ?? "",
      }))
    : [],
);

const rendered = characterizedEnglish
  .map((block) => ({ ...block, units: renderUnits(parseFrames(block.text), "en") }))
  .filter(({ units }) => units.length > 0);

const unitCount = rendered.reduce((sum, { units }) => sum + units.length, 0);

describe("frame renderer shadow: corpus differential", () => {
  it(`[diagnostic] ${unitCount} unit(s) rendered across ${rendered.length} characterized English block(s) (not frozen)`, () => {
    expect(rendered.length).toBeGreaterThan(0);
  });

  it.each(rendered.map(({ label, units, expected }) => [label, units, expected] as const))(
    "%s: every rendered unit appears in the stored translation",
    (_label, units, expected) => {
      for (const unit of units) {
        expect(expected.toLowerCase()).toContain(unit.text);
      }
    },
  );

  it.each(rendered.map(({ label, units, text }) => [label, units, text] as const))(
    "%s: every unit's source span is the exact source slice",
    (_label, units, text) => {
      for (const { sourceSpan } of units) {
        expect(text.slice(sourceSpan.start, sourceSpan.end)).toBe(sourceSpan.raw);
      }
    },
  );
});

describe("frame renderer shadow: repro guard", () => {
  const repros = cases.filter(({ value }) => value.lane === "repro");

  it("covers all four repro cases", () => {
    expect(repros).toHaveLength(4);
  });

  it.each(repros.map(({ caseId, value }) => [caseId, value.request] as const))(
    "%s: produces zero render units",
    (_caseId, request) => {
      for (const block of request.blocks) {
        expect(renderUnits(parseFrames(block.text), request.targetLanguage)).toEqual([]);
        expect(renderUnits(parseFrames(block.text), "en")).toEqual([]);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Production isolation: the renderer is a shadow until a later task wires it.
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

describe("frame renderer shadow: production isolation", () => {
  it("is not imported by any production module", () => {
    const importers = productionFiles(sourceRoot)
      .filter((path) => !path.includes(rendererDirectory))
      // Shadow frame protection consumes the IR and render units; its own isolation
      // test (assembly/__tests__/frame_protection_shadow.test.ts) keeps it out of production.
      .filter((path) => !path.includes(`${sep}translation${sep}assembly${sep}`))
      .filter((path) => /frame_renderer/.test(readFileSync(path, "utf8")))
      .map((path) => relative(sourceRoot, path));
    expect(importers).toEqual([]);
  });
});
