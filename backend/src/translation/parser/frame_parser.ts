/**
 * Turkish frame parser (Stage 1, Task 2: SHADOW ONLY, first family only).
 *
 * Consumes typed-lexer tokens and produces the Frame / Opaque IR
 * (`./frame_ir.ts`). No production module imports this yet; translation still
 * runs entirely through the existing normalizer, protection and mixed-segment
 * code.
 *
 * Mechanics: a token cursor tries each frame family at each token. A family
 * matcher looks at a small, bounded window of tokens and either returns one
 * frame (one action) or nothing. Tokens no family claims are gathered into
 * maximal Opaque runs. There are no clause-level regexes and no calls into
 * the legacy normalizer or protection helpers.
 *
 * Implemented family: `stitch_count`, "N<stitch> örüyoruz" (work N stitches).
 *
 * Lexicon:
 *  - The family admits glossary CONCEPT IDS (`STITCH_COUNT_CONCEPTS`). The
 *    Turkish spellings are read from `PROJECT_NOTATION`, never listed here, so
 *    the parser cannot drift from the glossary. A spelling must match the
 *    glossary form exactly (case included).
 *  - The finite verb forms (`STITCH_COUNT_VERBS`) are parser lexicon: the
 *    glossary has no verbs.
 *
 * FIRST-SLICE ADMISSION RULES. The left and right boundary checks below are a
 * deliberately conservative admission policy for this first migrated slice,
 * NOT a claim about Turkish grammar. A stitch-count clause preceded by an
 * adjunct ("ilk kolda 13x örüyoruz") or followed directly by another clause
 * ("66x örüyoruz ipimizi kesmeden ...") is perfectly meaningful; it simply
 * stays Opaque until a later task widens admission together with the context
 * it needs.
 *
 * Import rules: `../lexer/typed_lexer.js`, `../glossary.js` and `./frame_ir.js`
 * only. No translator, normalizer, validator, provider or corpus code.
 */
import { PROJECT_NOTATION } from "../glossary.js";
import { lexSource, type LexToken } from "../lexer/typed_lexer.js";
import type {
  FrameParse,
  Opaque,
  ParseNode,
  SourceSpan,
  StitchCountFrame,
} from "./frame_ir.js";

// ---------------------------------------------------------------------------
// Lexicon
// ---------------------------------------------------------------------------

/** Glossary concepts that name a stitch TYPE worked N times. */
export const STITCH_COUNT_CONCEPTS: readonly string[] = [
  "single_crochet",
  "half_double_crochet",
  "double_crochet",
  "treble_crochet",
  "extended_single_crochet",
];

/** Finite "we work" forms. Exact spelling; no case folding. */
export const STITCH_COUNT_VERBS: ReadonlySet<string> = new Set(["örüyoruz"]);

/** Exact glossary Turkish spelling -> concept id, for the admitted concepts only. */
export const STITCH_COUNT_FORMS: ReadonlyMap<string, string> = new Map(
  PROJECT_NOTATION.filter((entry) => STITCH_COUNT_CONCEPTS.includes(entry.concept)).map(
    (entry): [string, string] => [entry.tr.abbreviation, entry.concept],
  ),
);

// ---------------------------------------------------------------------------
// First-slice admission rules (see the module comment)
// ---------------------------------------------------------------------------

const LEFT_PUNCTUATION: ReadonlySet<string> = new Set([".", "!", "?", ";", ":"]);
const RIGHT_PUNCTUATION: ReadonlySet<string> = new Set([".", ",", ";", ":", "!", "?"]);

/** The token before `index`, looking back over at most one whitespace token. */
const previousSignificant = (tokens: readonly LexToken[], index: number): LexToken | undefined => {
  const previous = tokens[index - 1];
  return previous?.kind === "whitespace" ? tokens[index - 2] : previous;
};

/** The token after `index`, looking ahead over at most one whitespace token. */
const nextSignificant = (tokens: readonly LexToken[], index: number): LexToken | undefined => {
  const next = tokens[index + 1];
  return next?.kind === "whitespace" ? tokens[index + 2] : next;
};

const admitsLeft = (token: LexToken | undefined): boolean =>
  token === undefined ||
  token.kind === "line_break" ||
  (token.kind === "punctuation" && LEFT_PUNCTUATION.has(token.raw)) ||
  (token.kind === "bracket" && token.raw === ")");

const admitsRight = (token: LexToken | undefined): boolean =>
  token === undefined ||
  token.kind === "line_break" ||
  (token.kind === "punctuation" && RIGHT_PUNCTUATION.has(token.raw)) ||
  (token.kind === "bracket" && token.raw === "(");

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

type Match = { frame: StitchCountFrame; next: number };

const spanOf = (source: string, start: number, end: number): SourceSpan => ({
  start,
  end,
  raw: source.slice(start, end),
});

const tokenSpan = (token: LexToken): SourceSpan => ({
  start: token.start,
  end: token.end,
  raw: token.raw,
});

const DIGITS_ONLY = /^[0-9]+$/;

/**
 * `stitch_count`: number, adjacent glossary stitch form, one whitespace run,
 * finite verb. Four tokens, plus one boundary token on each side.
 */
const matchStitchCount = (
  source: string,
  tokens: readonly LexToken[],
  index: number,
): Match | undefined => {
  const count = tokens[index];
  const stitch = tokens[index + 1];
  const space = tokens[index + 2];
  const verb = tokens[index + 3];
  if (
    count?.kind !== "number" ||
    !DIGITS_ONLY.test(count.raw) ||
    stitch?.kind !== "abbreviation" ||
    stitch.start !== count.end ||
    space?.kind !== "whitespace" ||
    verb?.kind !== "word" ||
    !STITCH_COUNT_VERBS.has(verb.raw)
  ) {
    return undefined;
  }
  const concept = STITCH_COUNT_FORMS.get(stitch.raw);
  const value = Number(count.raw);
  if (concept === undefined || !Number.isSafeInteger(value)) return undefined;
  if (!admitsLeft(previousSignificant(tokens, index))) return undefined;
  if (!admitsRight(nextSignificant(tokens, index + 3))) return undefined;

  return {
    frame: {
      kind: "frame",
      action: "stitch_count",
      span: spanOf(source, count.start, verb.end),
      slots: {
        count: { span: tokenSpan(count), value },
        stitch: { span: tokenSpan(stitch), concept },
        verb: { span: tokenSpan(verb) },
      },
    },
    next: index + 4,
  };
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parses `source` into Frame and Opaque nodes. Pure, deterministic and total:
 * every input is covered exactly, and anything unrecognized is Opaque.
 */
export const parseFrames = (source: string): FrameParse => {
  const tokens = lexSource(source);
  const nodes: ParseNode[] = [];
  let opaqueStart: number | undefined;

  const flushOpaque = (end: number): void => {
    if (opaqueStart !== undefined && end > opaqueStart) {
      const opaque: Opaque = { kind: "opaque", span: spanOf(source, opaqueStart, end) };
      nodes.push(opaque);
    }
    opaqueStart = undefined;
  };

  let index = 0;
  while (index < tokens.length) {
    const match = matchStitchCount(source, tokens, index);
    if (match !== undefined) {
      flushOpaque(match.frame.span.start);
      nodes.push(match.frame);
      index = match.next;
      continue;
    }
    opaqueStart ??= tokens[index]?.start;
    index += 1;
  }
  flushOpaque(source.length);

  return { source, nodes };
};
