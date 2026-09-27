/**
 * Shadow evidence for the typed-path `N.` owner (Stage 1, Task 11).
 *
 * Stage 1 closure invariant: the lexer states lexical facts only (`number` +
 * `punctuation`), and the parser-side classifier (`../number_dot.ts`) owns the
 * semantic decision. Production still decides with its own helpers
 * (`extractLeadingInstruction`, round-reference extraction); they are imported
 * here read-only, as a parity oracle. Where the typed path disagrees, it is
 * only ever MORE conservative (it withholds `instruction_marker`), and every
 * disagreement is listed explicitly. R1/R2 stay known-bad in production.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCorpus } from "../../__tests__/corpus/load_corpus.js";
import { extractLeadingInstruction } from "../../instruction_marker.js";
import { LEX_TOKEN_KINDS, lexSource } from "../../lexer/typed_lexer.js";
import { extractRoundReferences } from "../../natural_language/round_references.js";
import { classifyNumberDots, type NumberDotDecision, type NumberDotKind } from "../number_dot.js";

/** Production's current view of the `N.` starting at `start`. */
const productionKind = (source: string, start: number): NumberDotKind => {
  if (extractRoundReferences(source).some((reference) => reference.start === start)) {
    return "row_round_label";
  }
  const instruction = extractLeadingInstruction(source);
  return instruction !== undefined &&
    instruction.leadingWhitespace.length === start &&
    instruction.marker.endsWith(".")
    ? "instruction_marker"
    : "ordinal_or_ordinary";
};

type Comparison = { source: string; decision: NumberDotDecision; production: NumberDotKind };

const compare = (source: string): Comparison[] =>
  classifyNumberDots(source).map((decision) => ({
    source,
    decision,
    production: productionKind(source, decision.span.start),
  }));

/** Keeps the caller's element type, so corpus comparisons keep their `caseId`. */
const disagreements = <T extends Comparison>(comparisons: readonly T[]): T[] =>
  comparisons.filter(({ decision, production }) => decision.kind !== production);

const cases = loadCorpus().cases;
const reproOf = (hazard: string) => {
  const repro = cases.find(({ value }) => value.lane === "repro" && value.labels.hazards.includes(hazard));
  if (repro === undefined) throw new Error(`No repro for hazard ${hazard}.`);
  return repro;
};
const R1 = reproOf("ordinal-at-block-start");
const R2 = reproOf("ordinal-mid-block");
const R1_SOURCE = R1.value.request.blocks[0]!.text;
const R2_SOURCE = R2.value.request.blocks[0]!.text;

// ---------------------------------------------------------------------------
// Stage 1 closure evidence
// ---------------------------------------------------------------------------

describe("N. ownership: the lexer states facts, the parser decides", () => {
  it("the lexer emits number + punctuation and has no semantic N. kinds", () => {
    expect(lexSource("7. sık").slice(0, 2).map(({ kind, raw }) => [kind, raw])).toEqual([
      ["number", "7"],
      ["punctuation", "."],
    ]);
    for (const kind of ["instruction_marker", "row_round_label", "ordinal_or_ordinary", "ordinal"]) {
      expect(LEX_TOKEN_KINDS as readonly string[]).not.toContain(kind);
    }
  });

  it("the classifier exercises all three decisions", () => {
    const kinds = ["6. Bu kısmı ayrı örüyoruz.", "6. sıranın FLO’sundan", "Toplam 3. Sonra"].map(
      (source) => classifyNumberDots(source)[0]?.kind,
    );
    expect(kinds).toEqual(["instruction_marker", "row_round_label", "ordinal_or_ordinary"]);
  });
});

describe("N. ownership: R1 and R2 (typed characterization; production unchanged)", () => {
  it("R1: the block-leading 7. is a stitch ordinal in the typed path", () => {
    expect(R1_SOURCE).toBe("7. sık iğneye ipimizi sabitliyoruz.");
    expect(classifyNumberDots(R1_SOURCE)).toEqual([
      {
        kind: "ordinal_or_ordinary",
        reason: "ordinal-head",
        span: { start: 0, end: 2, raw: "7." },
        index: 0,
      },
    ]);
  });

  it("R1: production still claims 7. as an instruction marker (the known-bad seam)", () => {
    expect(extractLeadingInstruction(R1_SOURCE)?.marker).toBe("7.");
    expect(R1.value.status).toBe("known-bad");
    expect(R1.value.expected?.results[0]?.translated).toBe("7. sık iğneye ipimizi sabitliyoruz.");
  });

  it("R2: the mid-block 7. is never an instruction marker", () => {
    const [decision] = classifyNumberDots(R2_SOURCE);
    expect(decision).toMatchObject({ kind: "ordinal_or_ordinary", reason: "not-leading", span: { raw: "7." } });
    expect(R2_SOURCE.slice(decision!.span.start - 1, decision!.span.end)).toBe("\n7.");
  });

  it("R2: production output is still the recorded known-bad result", () => {
    expect(extractLeadingInstruction(R2_SOURCE)).toBeUndefined();
    expect(R2.value.status).toBe("known-bad");
    expect(R2.value.expected?.results[0]?.translated).toBe(
      "Görselde görüldüğü gibi birinci parçanın bittiği yerden 6sc sayıp atlıyoruz.\n7. sık iğneye ipimizi sabitliyoruz.\nAt the end of each row, ch 1 and turn.",
    );
  });
});

// ---------------------------------------------------------------------------
// Parity with production helpers
// ---------------------------------------------------------------------------

const corpusComparisons = cases.flatMap(({ caseId, value }) =>
  value.request.blocks.flatMap((block) => compare(block.text).map((comparison) => ({ caseId, ...comparison }))),
);

describe("N. ownership: corpus parity", () => {
  it(`[diagnostic] ${corpusComparisons.length} N. occurrence(s) across the corpus (not frozen)`, () => {
    expect(corpusComparisons.length).toBeGreaterThan(0);
  });

  it("agrees with round-reference extraction on every row/round label", () => {
    for (const { decision, production } of corpusComparisons) {
      expect(decision.kind === "row_round_label").toBe(production === "row_round_label");
    }
  });

  it("disagrees only on R1, and only by withholding instruction_marker", () => {
    expect(
      disagreements(corpusComparisons).map(({ caseId, decision, production }) => [
        caseId,
        decision.span.raw,
        production,
        decision.kind,
        decision.reason,
      ]),
    ).toEqual([[R1.caseId, "7.", "instruction_marker", "ordinal_or_ordinary", "ordinal-head"]]);
  });
});

describe("N. ownership: synthetic parity", () => {
  const agreeing = [
    "6.",
    "  6. Bu kısmı ayrı örüyoruz.",
    "\n6. Bu kısmı ayrı örüyoruz.",
    "6.\nBu kısmı ayrı örüyoruz.",
    "6.\nsırada",
    "3. zincire ipimizi sabitliyoruz.",
    "6. sıra",
    "6.sırada",
    "6.\tsırada",
    "12. Sıradan başlıyoruz.",
    "Sonra 9. sırada Blo’dan örüyoruz.",
    "Toplam 3. Sonra dönüyoruz.",
    "a6. sıra",
    ",6. sıra",
    "6.x örüyoruz",
    "Sonra 6. sıraya geçiyoruz.",
    "atlıyoruz.\n7. sık iğneye ipimizi sabitliyoruz.",
    "1. Bu kısmı ayrı örüyoruz.\n2. sırada 3. ilmeğe geçiyoruz.",
  ];

  it.each(agreeing)("%j agrees with production", (source) => {
    expect(disagreements(compare(source))).toEqual([]);
  });

  it.each([
    ["7. sık iğneye ipimizi sabitliyoruz.", "ordinal-head"],
    ["3. zincir çekip dönüyoruz.", "ordinal-head"],
    ["3. x’e ipimizi sabitliyoruz.", "ordinal-head"],
    ["6. sıraya geçiyoruz.", "row-stem"],
    ["6.\u00a0sırada", "row-stem"],
  ])("%j: intentional disagreement, a leading marker withheld (%s)", (source, reason) => {
    expect(
      disagreements(compare(source)).map(({ decision, production }) => [production, decision.kind, decision.reason]),
    ).toEqual([["instruction_marker", "ordinal_or_ordinary", reason]]);
  });

  it("never claims instruction_marker where production does not", () => {
    for (const source of [...agreeing, ...cases.flatMap(({ value }) => value.request.blocks.map(({ text }) => text))]) {
      for (const { decision, production } of compare(source)) {
        if (decision.kind === "instruction_marker") expect(production).toBe("instruction_marker");
      }
    }
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

describe("N. ownership: production isolation", () => {
  it("is not imported by any production module", () => {
    const importers = productionFiles(sourceRoot)
      .filter((path) => !path.includes(parserDirectory))
      // Shadow PatternContext consumes this module; its own isolation test
      // (context/__tests__/pattern_context_shadow.test.ts) keeps it out of production.
      .filter((path) => !path.includes(`${sep}translation${sep}context${sep}`))
      .filter((path) => /number_dot/.test(readFileSync(path, "utf8")))
      .map((path) => relative(sourceRoot, path));
    expect(importers).toEqual([]);
  });
});
