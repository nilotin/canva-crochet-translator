/**
 * `N.` ownership decision (Stage 1, Task 11; in production only through the
 * course-decision pre-pass since next-stage Task 8).
 *
 * The typed lexer deliberately emits `7.` as two lexical facts, a `number`
 * and a `punctuation` token, and leaves open whether it is a list marker or an
 * ordinal. This module is the one typed-path owner of that decision. For an
 * integer `number` token immediately followed by a `.` token it decides
 * exactly one of:
 *
 *  - `instruction_marker`   a leading instruction number ("6. ..."), the
 *                           concept production's `extractLeadingInstruction`
 *                           implements with a regex;
 *  - `row_round_label`      "N. sıra..." names a row or round, the concept
 *                           production's round-reference extraction implements;
 *  - `ordinal_or_ordinary`  everything else: mid-text ordinals, sentence
 *                           numbers, glued or ambiguous forms. This is the
 *                           conservative fallback and is not refined further.
 *
 * It decides ownership only: nothing here translates, renders or routes, no
 * production module imports it, and production still uses its own helpers.
 *
 * Rule precedence (first match wins; every check is a token-kind, exact
 * spelling or single-token character-class check, never a clause regex):
 *
 *  1. attached-left     the number is glued to a preceding letter, number or
 *                       `.` `,` `_`                      -> ordinal_or_ordinary
 *  2. row-word          `.` is followed by at most one space/tab run and a
 *                       row/round word                   -> row_round_label
 *  3. not-leading       any non-whitespace token precedes the number
 *                                                        -> ordinal_or_ordinary
 *  4. attached-right    `.` is followed by something other than whitespace,
 *                       a line break or the end          -> ordinal_or_ordinary
 *  5. ordinal-head      `.` is followed, on the same line, by a stitch or
 *                       chain noun the parser knows ("7. sık iğneye": the 7th
 *                       single crochet)                  -> ordinal_or_ordinary
 *  6. row-stem          `.` is followed, on the same line, by an unlisted
 *                       inflection of the row/round word ("6. sıraya"): row
 *                       wording, but outside the first-slice lexicon, so it
 *                       is ambiguous                     -> ordinal_or_ordinary
 *  7. leading-position  otherwise                        -> instruction_marker
 *
 * "Leading" is relative to the `source` the caller passes (a block or a
 * segment), exactly like `extractLeadingInstruction`: only whitespace and line
 * breaks may precede the number.
 *
 * FIRST-SLICE LEXICON. `ROW_ROUND_WORDS` is exactly the morphology production
 * round-reference extraction accepts today (bare, genitive, ablative and
 * locative, with an optional capital S); other inflections such as "sıraya"
 * are never a label, and at a leading position they block the marker
 * decision (rule 6), until a later task widens the lexicon. Ordinal
 * heads reuse the parser's stitch and chain spellings plus the two-word noun
 * "sık iğne"; an unlisted head at a leading position stays a marker, as in
 * production.
 *
 * Import rules: `../lexer/typed_lexer.js`, `./frame_ir.js` and
 * `./frame_parser.js` only. No translator, normalizer, instruction-marker,
 * round-reference, validator, provider or corpus code.
 */
import { lexSource, type LexToken } from "../lexer/typed_lexer.js";
import type { SourceSpan } from "./frame_ir.js";
import { CHAIN_UNIT_FORMS, STITCH_COUNT_FORMS } from "./frame_parser.js";

export type NumberDotKind = "instruction_marker" | "row_round_label" | "ordinal_or_ordinary";

/** Which precedence rule decided (see the module comment). */
export type NumberDotReason =
  | "attached-left"
  | "row-word"
  | "not-leading"
  | "attached-right"
  | "ordinal-head"
  | "row-stem"
  | "leading-position";

export type NumberDotDecision = {
  readonly kind: NumberDotKind;
  readonly reason: NumberDotReason;
  /** The number and its period, e.g. `7.`. */
  readonly span: SourceSpan;
  /** Index of the `number` token in the token list. */
  readonly index: number;
};

export class NumberDotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NumberDotError";
  }
}

// ---------------------------------------------------------------------------
// Lexicon (first slice, see the module comment)
// ---------------------------------------------------------------------------

/** Row/round words, exact spelling: production's current morphology, no more. */
export const ROW_ROUND_WORDS: ReadonlySet<string> = new Set([
  "sıra",
  "sıranın",
  "sıradan",
  "sırada",
  "Sıra",
  "Sıranın",
  "Sıradan",
  "Sırada",
]);

/** Stems of the row/round word, for rule 6 only (never a `row_round_label`). */
const ROW_ROUND_STEMS: readonly string[] = ["sıra", "Sıra"];

/** Single-word ordinal heads: the parser's stitch and chain spellings. */
export const ORDINAL_HEAD_FORMS: ReadonlySet<string> = new Set([
  ...STITCH_COUNT_FORMS.keys(),
  ...CHAIN_UNIT_FORMS.keys(),
]);

/** The two-word noun "sık iğne": its head word, and the stem of the second word. */
const SINGLE_CROCHET_HEAD = "sık";
const SINGLE_CROCHET_STEM = "iğne";

// ---------------------------------------------------------------------------
// Token checks
// ---------------------------------------------------------------------------

const DIGITS_ONLY = /^[0-9]+$/;
const SPACES_OR_TABS = /^[ \t]+$/;
const LEFT_GLUE_PUNCTUATION: ReadonlySet<string> = new Set([".", ",", "_"]);

const isBlank = (token: LexToken): boolean =>
  token.kind === "whitespace" || token.kind === "line_break";

/** True when `tokens[index]` is an integer number immediately followed by `.`. */
export const isNumberDot = (tokens: readonly LexToken[], index: number): boolean => {
  const number = tokens[index];
  const dot = tokens[index + 1];
  return (
    number?.kind === "number" &&
    DIGITS_ONLY.test(number.raw) &&
    dot?.kind === "punctuation" &&
    dot.raw === "." &&
    dot.start === number.end
  );
};

const attachedLeft = (previous: LexToken | undefined): boolean =>
  previous !== undefined &&
  (previous.kind === "word" ||
    previous.kind === "abbreviation" ||
    previous.kind === "number" ||
    (previous.kind === "punctuation" && LEFT_GLUE_PUNCTUATION.has(previous.raw)));

/** `.` then at most one space/tab run then a row/round word. */
const rowWordFollows = (tokens: readonly LexToken[], dotIndex: number): boolean => {
  const next = tokens[dotIndex + 1];
  const word =
    next?.kind === "whitespace" && SPACES_OR_TABS.test(next.raw) ? tokens[dotIndex + 2] : next;
  return word?.kind === "word" && ROW_ROUND_WORDS.has(word.raw);
};

/** `.` then one same-line whitespace run then a stitch or chain noun. */
const ordinalHeadFollows = (tokens: readonly LexToken[], dotIndex: number): boolean => {
  if (tokens[dotIndex + 1]?.kind !== "whitespace") return false;
  const head = tokens[dotIndex + 2];
  if (head === undefined || (head.kind !== "word" && head.kind !== "abbreviation")) return false;
  if (ORDINAL_HEAD_FORMS.has(head.raw)) return true;
  const stem = tokens[dotIndex + 4];
  return (
    head.kind === "word" &&
    head.raw === SINGLE_CROCHET_HEAD &&
    tokens[dotIndex + 3]?.kind === "whitespace" &&
    stem?.kind === "word" &&
    stem.raw.startsWith(SINGLE_CROCHET_STEM)
  );
};

/** `.` then one same-line whitespace run then an unlisted row/round inflection. */
const rowStemFollows = (tokens: readonly LexToken[], dotIndex: number): boolean => {
  const word = tokens[dotIndex + 2];
  return (
    tokens[dotIndex + 1]?.kind === "whitespace" &&
    word?.kind === "word" &&
    ROW_ROUND_STEMS.some((stem) => word.raw.startsWith(stem))
  );
};

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classifies the `N.` whose number token is `tokens[index]`. `tokens` must be
 * the typed tokens of `source`. Pure and deterministic. Throws
 * `NumberDotError` when `tokens[index]` is not an integer number immediately
 * followed by `.`, or when those tokens are not exact slices of `source`.
 */
export const classifyNumberDot = (
  tokens: readonly LexToken[],
  index: number,
  source: string,
): NumberDotDecision => {
  if (!isNumberDot(tokens, index)) {
    throw new NumberDotError(`Token ${index} is not an integer number followed by ".".`);
  }
  const number = tokens[index]!;
  const dot = tokens[index + 1]!;
  if (
    source.slice(number.start, number.end) !== number.raw ||
    source.slice(dot.start, dot.end) !== dot.raw
  ) {
    throw new NumberDotError(`Tokens ${index}..${index + 1} are not slices of the source.`);
  }
  const decide = (kind: NumberDotKind, reason: NumberDotReason): NumberDotDecision => ({
    kind,
    reason,
    span: { start: number.start, end: dot.end, raw: source.slice(number.start, dot.end) },
    index,
  });

  if (attachedLeft(tokens[index - 1])) return decide("ordinal_or_ordinary", "attached-left");
  if (rowWordFollows(tokens, index + 1)) return decide("row_round_label", "row-word");
  if (!tokens.slice(0, index).every(isBlank)) return decide("ordinal_or_ordinary", "not-leading");
  const after = tokens[index + 2];
  if (after !== undefined && !isBlank(after)) return decide("ordinal_or_ordinary", "attached-right");
  if (ordinalHeadFollows(tokens, index + 1)) return decide("ordinal_or_ordinary", "ordinal-head");
  if (rowStemFollows(tokens, index + 1)) return decide("ordinal_or_ordinary", "row-stem");
  return decide("instruction_marker", "leading-position");
};

/** Every `N.` in `source`, classified, in source order. */
export const classifyNumberDots = (source: string): NumberDotDecision[] => {
  const tokens = lexSource(source);
  return tokens.flatMap((_token, index) =>
    isNumberDot(tokens, index) ? [classifyNumberDot(tokens, index, source)] : [],
  );
};
