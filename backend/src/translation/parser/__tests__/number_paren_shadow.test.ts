/**
 * Shadow evidence for the typed-path `N)` / `A-B)` owner (Stage 2, Task 3).
 *
 * The classifier (`../number_paren.ts`) owns line-leading instruction markers.
 * Production still decides with `extractLeadingInstruction` (single markers,
 * at a segment start) and the unit inference's numbered-line rule (which also
 * accepts ranges); `extractLeadingInstruction` and segmentation are imported
 * here read-only, as a parity oracle. Counts are characterized here, never in
 * the module. R3 stays known-bad in production.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCorpus } from "../../__tests__/corpus/load_corpus.js";
import { extractLeadingInstruction } from "../../instruction_marker.js";
import { lexSource } from "../../lexer/typed_lexer.js";
import { segmentTranslationBlock } from "../../segmentation.js";
import type { CourseEndTurnFrame } from "../frame_ir.js";
import { parseFrames } from "../frame_parser.js";
import { classifyNumberParens, type NumberParenDecision } from "../number_paren.js";

const cases = loadCorpus().cases;

const corpusDecisions = cases.flatMap(({ caseId, value }) =>
  value.request.blocks.flatMap((block) =>
    classifyNumberParens(block.text).map((decision) => ({ caseId, text: block.text, decision })),
  ),
);

const markers = corpusDecisions.filter(({ decision }) => decision.kind === "instruction_marker");
const isRange = (decision: NumberParenDecision) => decision.span.raw.includes("-");

/** Logical lines of `source` (split at the lexer's line-break tokens), with their start offsets. */
const linesOf = (source: string): { start: number; text: string }[] => {
  const lines: { start: number; text: string }[] = [];
  let start = 0;
  for (const token of lexSource(source)) {
    if (token.kind !== "line_break") continue;
    lines.push({ start, text: source.slice(start, token.start) });
    start = token.end;
  }
  lines.push({ start, text: source.slice(start) });
  return lines;
};

// ---------------------------------------------------------------------------
// Corpus characterization
// ---------------------------------------------------------------------------

describe("N) ownership: corpus characterization", () => {
  it("finds 70 occurrences: 61 single markers, 6 range markers and 3 ordinary uses", () => {
    expect(corpusDecisions).toHaveLength(70);
    expect(markers.filter(({ decision }) => !isRange(decision))).toHaveLength(61);
    expect(markers.filter(({ decision }) => isRange(decision))).toHaveLength(6);
    expect(
      corpusDecisions
        .filter(({ decision }) => decision.kind === "ordinary")
        .map(({ decision }) => [decision.span.raw, decision.reason]),
    ).toEqual([
      ["2456)", "not-leading"],
      ["110)", "not-leading"],
      ["110)", "not-leading"],
    ]);
  });

  it("every range marker leads an 'N sıra Mx' course-count line (the future Task 4 shape)", () => {
    for (const { text, decision } of markers.filter(({ decision }) => isRange(decision))) {
      const rest = lexSource(text.slice(decision.span.end))
        .filter(({ kind }) => kind !== "whitespace")
        .slice(0, 3)
        .map(({ kind, raw }) => (kind === "number" ? "number" : raw));
      expect(rest).toEqual(["number", "sıra", "number"]);
    }
  });

  it("pins a real range marker", () => {
    const found = markers.find(({ decision }) => decision.span.raw === "2-25)");
    expect(found?.decision).toMatchObject({ first: 2, last: 25 });
  });
});

// ---------------------------------------------------------------------------
// Parity with production helpers
// ---------------------------------------------------------------------------

describe("N) ownership: production parity", () => {
  it("claims every ')' marker production strips at a segment start, with the same raw text", () => {
    let compared = 0;
    for (const { value } of cases) {
      for (const block of value.request.blocks) {
        const typed = classifyNumberParens(block.text);
        for (const segment of segmentTranslationBlock(block.text)) {
          const instruction = extractLeadingInstruction(segment.text);
          if (!instruction?.marker.endsWith(")")) continue;
          compared += 1;
          const start = segment.start + instruction.leadingWhitespace.length;
          expect(typed.find(({ span }) => span.start === start)).toMatchObject({
            kind: "instruction_marker",
            span: { raw: instruction.marker },
          });
        }
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it("agrees line by line with extractLeadingInstruction on single markers; ranges are the one intended difference", () => {
    const rangesOnlyTyped: string[] = [];
    for (const { value } of cases) {
      for (const block of value.request.blocks) {
        const typed = classifyNumberParens(block.text).filter(({ kind }) => kind === "instruction_marker");
        for (const line of linesOf(block.text)) {
          const production = extractLeadingInstruction(line.text);
          const productionMarker = production?.marker.endsWith(")") ? production : undefined;
          const typedMarker = typed.find(({ span }) => span.start >= line.start && span.end <= line.start + line.text.length);
          if (typedMarker !== undefined && isRange(typedMarker)) {
            expect(productionMarker).toBeUndefined();
            rangesOnlyTyped.push(typedMarker.span.raw);
            continue;
          }
          expect(typedMarker?.span.raw).toBe(productionMarker?.marker);
          if (productionMarker !== undefined) {
            expect(typedMarker?.span.start).toBe(line.start + productionMarker.leadingWhitespace.length);
          }
        }
      }
    }
    expect(rangesOnlyTyped).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// R3
// ---------------------------------------------------------------------------

describe("N) ownership: R3 (typed characterization; production unchanged)", () => {
  const r3 = cases.find(({ value }) => value.lane === "repro" && value.labels.hazards.includes("cross-block-context"));
  const [first, second] = r3?.value.request.blocks ?? [];

  it("block 1: marker 12 and the course_end_turn(every) signal", () => {
    expect(first?.text).toBe("12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.");
    expect(classifyNumberParens(first!.text)).toEqual([
      {
        kind: "instruction_marker",
        reason: "leading-line",
        first: 12,
        last: 12,
        span: { start: 0, end: 3, raw: "12)" },
        index: 0,
      },
    ]);
    const signals = parseFrames(first!.text).nodes.filter(
      (node): node is CourseEndTurnFrame => node.kind === "frame" && node.action === "course_end_turn",
    );
    expect(signals.map(({ slots }) => slots.scope.value)).toEqual(["every"]);
  });

  it("block 2: marker 13 and still no frame for the course count", () => {
    expect(second?.text).toBe("13) 5 sıra 16x");
    expect(classifyNumberParens(second!.text)).toEqual([
      {
        kind: "instruction_marker",
        reason: "leading-line",
        first: 13,
        last: 13,
        span: { start: 0, end: 3, raw: "13)" },
        index: 0,
      },
    ]);
    expect(parseFrames(second!.text).nodes.every(({ kind }) => kind === "opaque")).toBe(true);
  });

  it("stays known-bad with its recorded production output", () => {
    expect(r3?.value.status).toBe("known-bad");
    expect(r3?.value.expected?.results.map(({ translated }) => translated)).toEqual([
      "12) At the end of each row, ch 1 and turn.",
      "13) 16sc for 5 rounds",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Production isolation: the classifier is a shadow until a later task wires it.
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

describe("N) ownership: production isolation", () => {
  it("is not imported by any production module", () => {
    const importers = productionFiles(sourceRoot)
      .filter((path) => !path.includes(parserDirectory))
      .filter((path) => /number_paren/.test(readFileSync(path, "utf8")))
      .map((path) => relative(sourceRoot, path));
    expect(importers).toEqual([]);
  });
});
