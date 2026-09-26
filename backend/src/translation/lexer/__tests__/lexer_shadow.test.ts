/**
 * Shadow comparison of the typed lexer against today's lexical owners
 * (Stage 1, Task 1). Nothing here changes or replaces those owners.
 *
 * What is compared, and why only this:
 *  - BOUNDARIES. Every span `protectImmutablePattern` protects (both profiles)
 *    starts and ends on a typed-lexer token boundary, and the typed lexer
 *    refines `lexMixedSegment`'s partition (every old token boundary is a new
 *    token boundary). So the new tokens can represent every existing
 *    immutable fragment and every existing prose span without cutting one.
 *  - CLASSIFICATION, only where it is lexical. Old notation tokens that the
 *    lexer does not call `abbreviation`, and the reverse, must fall into the
 *    documented categories below. Those are context decisions the old code
 *    makes and the lexer deliberately leaves to the frame parser.
 *
 * These comparisons are a MIGRATION GUARD, not an architectural requirement:
 * they prove the shadow lexer can carry today's fragments while the old owners
 * still run production. When a later task replaces `lexMixedSegment` or the
 * protection step, the matching comparison here is retired with it.
 *
 * Corpus coverage asserts lexical invariants only (exact reconstruction, no
 * gaps or overlaps, valid offsets, determinism). Token sequences are NOT
 * frozen per case: this is not a new golden layer.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCorpus } from "../../__tests__/corpus/load_corpus.js";
import { extractLeadingInstruction } from "../../instruction_marker.js";
import { lexMixedSegment } from "../../mixed_segment.js";
import {
  isPatternOnlyProtectedText,
  protectImmutablePattern,
} from "../../notation/immutable.js";
import { tokenizeSourceNotation } from "../../notation/tokenizer.js";
import { lexInvariantIssues, lexSource, type LexToken } from "../typed_lexer.js";

type Span = { kind: string; start: number; end: number };

/**
 * Source offsets of every token `protectImmutablePattern` protected. The text
 * between placeholders is copied verbatim, and each token's `source` is the
 * exact protected slice, so offsets follow by walking both strings.
 */
const protectedSpans = (source: string, profile: "pattern" | "materials"): Span[] => {
  const protectedText = protectImmutablePattern(source, 0, profile);
  const spans: Span[] = [];
  let sourceCursor = 0;
  let textCursor = 0;
  for (const token of protectedText.tokens) {
    const at = protectedText.text.indexOf(token.placeholder, textCursor);
    sourceCursor += at - textCursor;
    textCursor = at + token.placeholder.length;
    const end = sourceCursor + token.source.length;
    expect(source.slice(sourceCursor, end)).toBe(token.source);
    spans.push({ kind: token.kind, start: sourceCursor, end });
    sourceCursor = end;
  }
  return spans;
};

const boundariesOf = (tokens: readonly LexToken[]): Set<number> =>
  new Set(tokens.flatMap(({ start, end }) => [start, end]));

const misaligned = (tokens: readonly LexToken[], spans: readonly Span[]): Span[] => {
  const boundaries = boundariesOf(tokens);
  return spans.filter(({ start, end }) => !boundaries.has(start) || !boundaries.has(end));
};

const overlaps = (span: Span, others: readonly Span[]): boolean =>
  others.some(({ start, end }) => span.start < end && span.end > start);

/** Lexical abbreviations the old notation layer does not protect, and why. */
const abbreviationDisagreements = (source: string, tokens: readonly LexToken[]) => {
  const pattern = protectedSpans(source, "pattern");
  const notation = pattern.filter(({ kind }) => kind === "notation");
  const rounds = pattern.filter(({ kind }) => kind === "round_reference");
  const sameSpan = (left: Span, right: Span) => left.start === right.start && left.end === right.end;

  const abbreviations = tokens.filter(({ kind }) => kind === "abbreviation");
  const unexplainedAbbreviations = abbreviations.filter((token) => {
    if (notation.some((span) => sameSpan(span, token))) return false;
    // FLO/BLO inside "6. sıranın BLO’sundan": one round-reference token owns it.
    if (overlaps(token, rounds)) return false;
    // "x" is a stitch, a multiplier ("(6x, v) x 6") or length shorthand
    // ("4x uzunluğunda") depending on context. The tokenizer decides; the
    // lexer does not.
    if (token.raw.toLowerCase() === "x") return false;
    return true;
  });

  const unexplainedNotation = notation.filter((span) => {
    if (abbreviations.some((token) => sameSpan(span, token))) return false;
    // "*" is a glossary entry (repetition count) but lexically an operator.
    return !tokens.some(
      (token) => token.kind === "operator" && token.raw === "*" && sameSpan(span, token),
    );
  });

  return { unexplainedAbbreviations, unexplainedNotation };
};

// ---------------------------------------------------------------------------
// Corpus shadow coverage
// ---------------------------------------------------------------------------

const corpusBlocks = loadCorpus().cases.flatMap(({ caseId, value }) =>
  value.request.blocks.map((block) => ({ caseId, blockId: block.id, text: block.text })),
);

describe("typed lexer shadow: corpus source blocks", () => {
  it("covers every corpus case, pending and known-bad included", () => {
    const cases = new Set(corpusBlocks.map(({ caseId }) => caseId));
    expect(cases.size).toBe(loadCorpus().cases.length);
    expect(corpusBlocks.length).toBeGreaterThan(0);
  });

  it.each(corpusBlocks.map((block) => [`${block.caseId} ${block.blockId}`, block.text] as const))(
    "%s: exact, gap-free and deterministic",
    (_label, text) => {
      const tokens = lexSource(text);
      expect(lexInvariantIssues(text, tokens)).toEqual([]);
      expect(lexSource(text)).toEqual(tokens);
    },
  );

  it.each(corpusBlocks.map((block) => [`${block.caseId} ${block.blockId}`, block.text] as const))(
    "%s: every protectImmutablePattern span (both profiles) lies on token boundaries",
    (_label, text) => {
      const tokens = lexSource(text);
      expect(misaligned(tokens, protectedSpans(text, "pattern"))).toEqual([]);
      expect(misaligned(tokens, protectedSpans(text, "materials"))).toEqual([]);
    },
  );

  it.each(corpusBlocks.map((block) => [`${block.caseId} ${block.blockId}`, block.text] as const))(
    "%s: refines the lexMixedSegment partition",
    (_label, text) => {
      const mixed = lexMixedSegment(text, "en", "shadow");
      expect(misaligned(lexSource(text), mixed.tokens)).toEqual([]);
    },
  );

  it.each(corpusBlocks.map((block) => [`${block.caseId} ${block.blockId}`, block.text] as const))(
    "%s: abbreviation/notation differences are only the documented context decisions",
    (_label, text) => {
      expect(abbreviationDisagreements(text, lexSource(text))).toEqual({
        unexplainedAbbreviations: [],
        unexplainedNotation: [],
      });
    },
  );
});

// ---------------------------------------------------------------------------
// Documented mismatches between today's owners. Each test pins CURRENT old
// behavior next to the lexer's neutral tokens. None of them is resolved here.
// ---------------------------------------------------------------------------

const mixedPairs = (source: string) =>
  lexMixedSegment(source, "en", "shadow").tokens.map(({ kind, sourceText }) => [kind, sourceText]);

const protectedPairs = (source: string, profile: "pattern" | "materials") =>
  protectImmutablePattern(source, 0, profile).tokens.map(({ kind, source: text }) => [kind, text]);

describe("typed lexer shadow: documented mismatches in current lexing", () => {
  it("M1: comma and dash are structure in lexMixedSegment but prose to protectImmutablePattern without notation", () => {
    const source = "6 zincir, atla - dön";
    expect(protectedPairs(source, "pattern")).toEqual([["number", "6"]]);
    expect(mixedPairs(source)).toContainEqual(["structure", ","]);
    expect(mixedPairs(source)).toContainEqual(["structure", "-"]);
    expect(lexSource(source).filter(({ kind }) => kind === "punctuation" || kind === "dash").map(({ raw }) => raw)).toEqual([",", "-"]);
  });

  it("M2: the x multiplier is decided in three places, and x before prose goes to the provider", () => {
    const repetition = "(6x, v) x 6";
    // Tokenizer: only the stitch x at offset 2 is notation, not the multiplier.
    expect(tokenizeSourceNotation(repetition).map(({ start }) => start)).toEqual([2, 5]);
    // Pattern-only check: strips an x that precedes a protected token.
    expect(isPatternOnlyProtectedText(protectImmutablePattern(repetition))).toBe(true);
    // Mixed lexer: re-labels a prose x before a number as structure.
    expect(mixedPairs("6x sayıp, x 2 atla")).toContainEqual(["structure", "x"]);
    // "4x uzunluğunda": the tokenizer rejects x, so lexMixedSegment sends it as prose.
    expect(mixedPairs("4x uzunluğunda")).toEqual([
      ["number", "4"],
      ["natural_language", "x uzunluğunda"],
    ]);
    // The lexer reports the same lexical form every time.
    expect(lexSource(repetition).filter(({ raw }) => raw === "x").map(({ kind }) => kind)).toEqual([
      "abbreviation",
      "abbreviation",
    ]);
  });

  it("M3: a product code is treble notation in the pattern profile and one structure token in materials", () => {
    const source = "2 adet Catania TR263";
    expect(protectedPairs(source, "pattern")).toEqual([
      ["number", "2"],
      ["notation", "TR"],
      ["number", "263"],
    ]);
    expect(protectedPairs(source, "materials")).toEqual([
      ["number", "2"],
      ["structure", "TR263"],
    ]);
    expect(lexSource(source).slice(-2).map(({ kind, raw }) => [kind, raw])).toEqual([
      ["abbreviation", "TR"],
      ["number", "263"],
    ]);
  });

  it("M4: a leading ordinal is claimed as an instruction marker outside the mixed lexer (R1)", () => {
    const source = "7. sık iğneye ipimizi sabitliyoruz.";
    expect(extractLeadingInstruction(source)?.marker).toBe("7.");
    // lexMixedSegment declares an instruction_marker kind but never emits it.
    expect(mixedPairs(source).map(([kind]) => kind)).not.toContain("instruction_marker");
    expect(lexSource(source).slice(0, 2).map(({ kind, raw }) => [kind, raw])).toEqual([
      ["number", "7"],
      ["punctuation", "."],
    ]);
  });

  it("M5: lexMixedSegment groups prose across a line break and keeps a stray period (R2)", () => {
    const source =
      "Görselde görüldüğü gibi birinci parçanın bittiği yerden 6x sayıp atlıyoruz.\n7. sık iğneye ipimizi sabitliyoruz.\nBütün sıra sonlarında 1 zincir çekip dönüyoruz.";
    expect(mixedPairs(source)).toContainEqual([
      "natural_language",
      ". sık iğneye ipimizi sabitliyoruz.\nBütün sıra sonlarında",
    ]);
    expect(lexSource(source).filter(({ kind }) => kind === "line_break")).toHaveLength(2);
  });

  it("M6: * is glossary notation to the tokenizer and an operator to the lexer", () => {
    const source = "(7x, 1e)*6";
    expect(protectedPairs(source, "pattern")).toContainEqual(["notation", "*"]);
    expect(lexSource(source).find(({ raw }) => raw === "*")?.kind).toBe("operator");
  });
});

// ---------------------------------------------------------------------------
// Production isolation: the lexer is a shadow until a later task wires it.
// ---------------------------------------------------------------------------

const sourceRoot = fileURLToPath(new URL("../../../", import.meta.url));

const productionFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : productionFiles(path);
    }
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });

describe("typed lexer shadow: production isolation", () => {
  it("is not imported by any production module", () => {
    const importers = productionFiles(sourceRoot)
      .filter((path) => !path.endsWith(`${sep}lexer${sep}typed_lexer.ts`))
      .filter((path) => /typed_lexer/.test(readFileSync(path, "utf8")))
      .map((path) => relative(sourceRoot, path));
    expect(importers).toEqual([]);
  });
});
