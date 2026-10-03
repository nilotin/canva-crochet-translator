/**
 * Shadow evidence for PatternContext (Stage 2, Task 5).
 *
 * R3 resolves to row in the typed path; R4 stays unknown by Policy B. Every
 * corpus course_count is characterized against production's unit inference
 * (`inferCrochetCountUnitAtSourcePosition`, imported read-only as an oracle):
 * where the typed path says row, production also says row for the same text;
 * where it says unknown, production falls back to its default round. That
 * unknown is an intended difference, never a silent round. Production output
 * and Stage 0 statuses are unchanged.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCorpus } from "../../__tests__/corpus/load_corpus.js";
import { inferCrochetCountUnitAtSourcePosition } from "../../natural_language/bare_round_count.js";
import { foldPatternContext, type BlockTrace } from "../pattern_context.js";

const cases = loadCorpus().cases;
const reproOf = (hazard: string) => {
  // By hazard, not lane: R4 was promoted from the repro lane to curated (Task 18C).
  const repro = cases.find(({ value }) => value.labels.hazards.includes(hazard));
  if (repro === undefined) throw new Error(`No repro for hazard ${hazard}.`);
  return repro;
};

/** Event summaries of a block trace. */
const eventSummary = (trace: BlockTrace | undefined) =>
  trace?.events.map((event) =>
    event.type === "instruction"
      ? [event.type, event.first, event.last]
      : event.type === "course_end_turn"
        ? [event.type, event.scope]
        : [event.type, event.courses, event.count, event.stitch],
  );

/**
 * Production's unit for a course_count at `trace`'s block, computed on the
 * blocks up to and including it joined by line breaks (production only ever
 * sees one block, so this is the most context it could have).
 */
const productionUnit = (blocks: readonly string[], blockIndex: number, start: number): string => {
  const joined = blocks.slice(0, blockIndex + 1).join("\n");
  const offset = blocks.slice(0, blockIndex).reduce((total, block) => total + block.length + 1, 0);
  const lineStart = joined.lastIndexOf("\n", offset + start - 1) + 1;
  return inferCrochetCountUnitAtSourcePosition(joined, lineStart);
};

// ---------------------------------------------------------------------------
// R3 and R4
// ---------------------------------------------------------------------------

describe("PatternContext shadow: R3 (cross-block row context)", () => {
  const r3 = reproOf("cross-block-context");
  const blocks = r3.value.request.blocks.map(({ text }) => text);
  const [first, second] = foldPatternContext(blocks);

  it("block 1: instruction(12), then course_end_turn(every) establishes row", () => {
    expect(blocks[0]).toBe("12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.");
    expect(eventSummary(first)).toEqual([
      ["instruction", 12, 12],
      ["course_end_turn", "every"],
    ]);
    expect(first?.before).toEqual({ courseKind: "unknown" });
    expect(first?.after).toMatchObject({
      courseKind: "row",
      lastInstruction: { first: 12, last: 12, blockIndex: 0, line: 0 },
      evidence: { blockIndex: 0, scope: "every", span: { start: 4, end: 50 } },
    });
  });

  it("block 2: instruction(13) is continuous, and the course_count reads row", () => {
    expect(blocks[1]).toBe("13) 5 sıra 16x");
    expect(eventSummary(second)).toEqual([
      ["instruction", 13, 13],
      ["course_count", 5, 16, "single_crochet"],
    ]);
    expect(second?.reads.map(({ event, courseKind }) => [event.span.raw, courseKind])).toEqual([
      ["5 sıra 16x", "row"],
    ]);
    expect(second?.after.courseKind).toBe("row");
  });

  it("stays known-bad in production, with its recorded output", () => {
    expect(r3.value.status).toBe("known-bad");
    expect(r3.value.expected?.results.map(({ translated }) => translated)).toEqual([
      "12) At the end of each row, ch 1 and turn.",
      "13) 16sc for 5 rounds",
    ]);
  });
});

describe("PatternContext shadow: R4 (deferred by Policy B)", () => {
  const r4 = reproOf("row-round-unit-drift");
  const [trace] = foldPatternContext(r4.value.request.blocks.map(({ text }) => text));

  it("course_end_turn(single) changes nothing: the context stays unknown", () => {
    expect(eventSummary(trace)).toEqual([["course_end_turn", "single"]]);
    expect(trace?.after).toEqual({ courseKind: "unknown" });
    expect(trace?.after).toBe(trace?.before);
  });

  it("is fixed in production (Task 18B) and promoted to an approved curated case", () => {
    expect([r4.value.lane, r4.value.status]).toEqual(["curated", "approved"]);
    expect(r4.value.expected?.results[0]?.translated).toBe("When you reach the end, ch 1 and turn.");
  });
});

// ---------------------------------------------------------------------------
// Corpus characterization and parity
// ---------------------------------------------------------------------------

const corpusReads = cases.flatMap(({ caseId, value }) => {
  const blocks = value.request.blocks.map(({ text }) => text);
  return foldPatternContext(blocks).flatMap((trace) =>
    trace.reads.map(({ event, courseKind }) => ({
      caseId,
      raw: event.span.raw,
      courseKind,
      production: productionUnit(blocks, trace.blockIndex, event.span.start),
    })),
  );
});

describe("PatternContext shadow: corpus course_count reads", () => {
  it("characterizes every corpus course_count", () => {
    expect(corpusReads.map(({ caseId, raw, courseKind }) => [caseId, raw, courseKind])).toEqual([
      ["c-1bb09c4de3-page14-multi-style-block-2", "24 sıra 20x", "unknown"],
      ["h-293cba8ae6-s69e691d8-12-23-12-sira", "12 sıra 66x", "unknown"],
      ["h-2c6ae438a1-s8ba3bafb-2-11-10-sira", "10 sıra 64x", "unknown"],
      ["h-3882616ab2-sfb8dd806-bu-siradan-sonra-kol", "6 sıra 18x", "unknown"],
      ["h-adcec187ab-s9637a557-bal-kabagi-2-00", "15 sıra 8hdc", "unknown"],
      ["h-d3cc1710cc-s64028a30-bu-aciklama-cevrilsin-2", "10 sıra 64x", "unknown"],
      ["r-0b3aaf317b-cross-block-row-context", "5 sıra 16x", "row"],
    ]);
  });

  it("says row exactly where production's inference says row for the same text", () => {
    for (const { courseKind, production } of corpusReads) {
      expect(courseKind === "row").toBe(production === "row");
    }
  });

  it("never says round: without typed evidence it stays unknown where production defaults to round", () => {
    for (const { courseKind, production } of corpusReads) {
      expect(courseKind).not.toBe("round");
      if (courseKind === "unknown") expect(production).toBe("round");
    }
  });
});

describe("PatternContext shadow: production's pinned numbering rules", () => {
  it.each([
    [
      "collar: turning rows carry through an unnumbered heading into 3-7)",
      "1) 28x örüyoruz, 1 zincir çekip dönüyoruz. Bütün sıra sonlarında 1 zincir çekip dönüyoruz.\n" +
        "♦ Yakanın ilk parçasını öreceğiz,\n2) (1x, 1v)*5, 1sc = 16x\n3-7) 5 sıra 16x, 1 zincir çekip ipimizi kesiyoruz.",
      "row",
    ],
    [
      "numbering reset: a new 1) never inherits",
      "1) 28x örüyoruz, 1 zincir çekip dönüyoruz. Bütün sıra sonlarında 1 zincir çekip dönüyoruz.\n" +
        "♦ Yeni bölüm\n1) 5 sıra 16x, 1 zincir çekip ipimizi kesiyoruz.",
      "unknown",
    ],
  ] as const)("%s", (_label, block, expected) => {
    const [trace] = foldPatternContext([block]);
    const [read] = trace?.reads ?? [];
    expect(read?.courseKind).toBe(expected);
    expect(productionUnit([block], 0, read!.event.span.start)).toBe(expected === "row" ? "row" : "round");
  });
});

// ---------------------------------------------------------------------------
// Production isolation: PatternContext is a shadow until a later stage wires it.
// ---------------------------------------------------------------------------

const sourceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const contextDirectory = `${sep}translation${sep}context${sep}`;

const productionFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : productionFiles(path);
    }
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });

describe("PatternContext shadow: production isolation", () => {
  it("is not imported by any production module", () => {
    const importers = productionFiles(sourceRoot)
      .filter((path) => !path.includes(contextDirectory))
      .filter((path) => /context\/pattern_|pattern_context|pattern_events/.test(readFileSync(path, "utf8")))
      .map((path) => relative(sourceRoot, path));
    expect(importers).toEqual([]);
  });
});
