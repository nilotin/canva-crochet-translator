/**
 * Typed lexer (Stage 1, Task 1: SHADOW ONLY).
 *
 * Splits a source string into a gap-free, overlap-free sequence of small,
 * purely LEXICAL tokens. It is not used by the translation pipeline yet: no
 * production module imports it, and today's owners
 * (`protectImmutablePattern`, `lexMixedSegment`, `extractLeadingInstruction`,
 * the notation tokenizer, round-reference and measurement extraction) are
 * unchanged. Tests compare it against them.
 *
 * What the lexer decides, and what it deliberately leaves to the later frame
 * parser:
 *
 *  - Lexical: character classes, maximal runs, and one dictionary lookup (a
 *    letter run that is exactly a glossary source abbreviation is an
 *    `abbreviation`). Nothing looks at neighbouring tokens.
 *  - NOT lexical, so NOT decided here: whether `x` is a stitch or a
 *    multiplication operator, whether `7.` is a list marker or an ordinal,
 *    whether `2-25` is a range, whether `6. sıranın BLO’sundan` is a round
 *    reference, whether `55cm` is a measurement, and whether `6x` is a compact
 *    stitch count. Those are relations between adjacent tokens, which stay
 *    visible because every token keeps exact offsets (compact `6x` is a
 *    `number` immediately followed by an `abbreviation`, `end === start`).
 *
 * Guarantees:
 *  - `raw` is always `source.slice(start, end)`. Nothing is normalized (no
 *    NFC, no case folding, no whitespace collapsing).
 *  - Concatenating `raw` of every token gives back the source exactly.
 *  - Offsets are UTF-16 code units, like `String.prototype.length`, the
 *    frontend and Canva ranges. A token never splits a surrogate pair; a lone
 *    surrogate becomes its own `other` token.
 *  - Deterministic: no clock, randomness, environment or locale-dependent API.
 *
 * Import rules: only the glossary data (`../glossary.js`). No translator,
 * normalizer, validator, provider or corpus code.
 */
import { PROJECT_NOTATION } from "../glossary.js";

export const LEX_TOKEN_KINDS = [
  /** A run of letters (with any combining marks after them). */
  "word",
  /** A whole letter run that is exactly a glossary source abbreviation. */
  "abbreviation",
  /** ASCII digits, with at most one `.` or `,` decimal part: `6`, `2.20`, `2,5`. */
  "number",
  /** A run of whitespace other than line breaks (space, tab, NBSP, ...). */
  "whitespace",
  /** One line break: `\r\n`, `\n`, `\r`, U+2028 or U+2029. */
  "line_break",
  /** `( ) [ ] { }` */
  "bracket",
  /** `= * + / × ÷ −` */
  "operator",
  /** `-` and the Unicode hyphens and dashes `‐ ‑ ‒ – —` */
  "dash",
  /** List and decoration markers such as `✦ • ▪ ◦`. */
  "marker",
  /** Any other Unicode punctuation: `. , ; : ! ? ’ ' U+02BC " …` and so on. */
  "punctuation",
  /** Anything else, one code point at a time (symbols, emoji, lone surrogates). */
  "other",
] as const;

export type LexTokenKind = (typeof LEX_TOKEN_KINDS)[number];

type TokenOf<Kind extends LexTokenKind> = {
  readonly kind: Kind;
  /** Inclusive start, UTF-16 code units. */
  readonly start: number;
  /** Exclusive end, UTF-16 code units. */
  readonly end: number;
  /** Exactly `source.slice(start, end)`. */
  readonly raw: string;
};

export type LexToken = { [Kind in LexTokenKind]: TokenOf<Kind> }[LexTokenKind];

// ---------------------------------------------------------------------------
// Character classes
// ---------------------------------------------------------------------------

const LETTER = /\p{L}/u;
const MARK = /\p{M}/u;
const PUNCTUATION = /\p{P}/u;
const ASCII_DIGIT = /[0-9]/;
const WHITESPACE = /\s/u;
const ASCII_LETTERS = /^[A-Za-z]+$/;
const LINE_BREAK_CHARACTERS = new Set(["\n", "\r", "\u2028", "\u2029"]);

/** Letter-modifier apostrophe. It is `\p{L}`, but lexically it is punctuation like `’` and `'`. */
const MODIFIER_APOSTROPHE = "\u02bc";

const BRACKETS = new Set(["(", ")", "[", "]", "{", "}"]);
const OPERATORS = new Set(["=", "*", "+", "/", "\u00d7", "\u00f7", "\u2212"]);
const DASHES = new Set(["-", "\u2010", "\u2011", "\u2012", "\u2013", "\u2014"]);
const MARKERS = new Set([
  "\u2726", // ✦
  "\u2022", // •
  "\u2023", // ‣
  "\u2043", // ⁃
  "\u25aa", // ▪
  "\u25ab", // ▫
  "\u25e6", // ◦
  "\u25cf", // ●
  "\u25cb", // ○
  "\u25a0", // ■
  "\u25a1", // □
  "\u25c6", // ◆
  "\u25c7", // ◇
  "\u2605", // ★
  "\u2606", // ☆
  "\u2727", // ✧
  "\u27a4", // ➤
  "\u25ba", // ►
]);

/**
 * Letter-only glossary source forms, compared case-insensitively on ASCII.
 * The notation tokenizer matches with the regex `i` flag, so it accepts any
 * casing too (its alias table only lists casings it already accepts). `M`
 * (3-stitch decrease) is the one case-sensitive form: `m` stays a word,
 * because it is also a length unit.
 */
const CASE_SENSITIVE_FORMS = new Set(
  PROJECT_NOTATION.map((entry) => entry.tr.abbreviation).filter(
    (form) => form === "M",
  ),
);
const CASE_INSENSITIVE_FORMS = new Set(
  PROJECT_NOTATION.map((entry) => entry.tr.abbreviation)
    .filter((form) => ASCII_LETTERS.test(form) && !CASE_SENSITIVE_FORMS.has(form))
    .map((form) => form.toLowerCase()),
);

/** `toLowerCase()` is locale-independent, and it only ever sees ASCII letters here. */
export const isGlossaryAbbreviation = (raw: string): boolean =>
  CASE_SENSITIVE_FORMS.has(raw) ||
  (ASCII_LETTERS.test(raw) && CASE_INSENSITIVE_FORMS.has(raw.toLowerCase()));

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

const isHighSurrogate = (code: number): boolean =>
  code >= 0xd800 && code <= 0xdbff;

const isLowSurrogate = (code: number): boolean =>
  code >= 0xdc00 && code <= 0xdfff;

/** The whole code point at `index`: two units for a valid surrogate pair, else one. */
const codePointAt = (source: string, index: number): string =>
  isHighSurrogate(source.charCodeAt(index)) &&
  isLowSurrogate(source.charCodeAt(index + 1))
    ? source.slice(index, index + 2)
    : source.slice(index, index + 1);

const isLetter = (character: string): boolean =>
  character !== MODIFIER_APOSTROPHE && LETTER.test(character);

const isLineBreak = (character: string): boolean =>
  LINE_BREAK_CHARACTERS.has(character);

const isSpace = (character: string): boolean =>
  character.length > 0 && WHITESPACE.test(character) && !isLineBreak(character);

const token = <Kind extends LexTokenKind>(
  kind: Kind,
  source: string,
  start: number,
  end: number,
): TokenOf<Kind> => ({ kind, start, end, raw: source.slice(start, end) });

/** Scans the maximal run at `start` whose code points satisfy `accept`. */
const runEnd = (
  source: string,
  start: number,
  accept: (character: string) => boolean,
): number => {
  let end = start;
  while (end < source.length) {
    const character = codePointAt(source, end);
    if (!accept(character)) break;
    end += character.length;
  }
  return end;
};

const scanNumber = (source: string, start: number): number => {
  let end = runEnd(source, start, (character) => ASCII_DIGIT.test(character));
  const separator = source[end];
  if (
    (separator === "." || separator === ",") &&
    ASCII_DIGIT.test(source[end + 1] ?? "")
  ) {
    end = runEnd(source, end + 1, (character) => ASCII_DIGIT.test(character));
  }
  return end;
};

const scanWord = (source: string, start: number): number =>
  runEnd(
    source,
    start,
    (character) => isLetter(character) || MARK.test(character),
  );

/**
 * Lexes `source` into typed tokens. Pure and total: every input string,
 * including the empty string and malformed UTF-16, is covered exactly.
 */
export const lexSource = (source: string): LexToken[] => {
  const tokens: LexToken[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const character = codePointAt(source, cursor);
    const start = cursor;

    if (character === "\r" && source[cursor + 1] === "\n") {
      cursor += 2;
      tokens.push(token("line_break", source, start, cursor));
    } else if (isLineBreak(character)) {
      cursor += 1;
      tokens.push(token("line_break", source, start, cursor));
    } else if (isSpace(character)) {
      cursor = runEnd(source, cursor, isSpace);
      tokens.push(token("whitespace", source, start, cursor));
    } else if (ASCII_DIGIT.test(character)) {
      cursor = scanNumber(source, cursor);
      tokens.push(token("number", source, start, cursor));
    } else if (isLetter(character)) {
      cursor = scanWord(source, cursor);
      const raw = source.slice(start, cursor);
      tokens.push(
        token(isGlossaryAbbreviation(raw) ? "abbreviation" : "word", source, start, cursor),
      );
    } else {
      cursor += character.length;
      const kind: LexTokenKind = BRACKETS.has(character)
        ? "bracket"
        : OPERATORS.has(character)
          ? "operator"
          : DASHES.has(character)
            ? "dash"
            : MARKERS.has(character)
              ? "marker"
              : character === MODIFIER_APOSTROPHE || PUNCTUATION.test(character)
                ? "punctuation"
                : "other";
      tokens.push(token(kind, source, start, cursor));
    }
  }
  return tokens;
};

/** Concatenates every token's raw text. Equals the lexed source. */
export const reconstructSource = (tokens: readonly LexToken[]): string =>
  tokens.map(({ raw }) => raw).join("");

/**
 * Structural problems of a token list against its source: gaps, overlaps,
 * out-of-range or empty tokens, raw text that is not the source slice, or a
 * split surrogate pair. Empty when the tokenization is exact.
 */
export const lexInvariantIssues = (
  source: string,
  tokens: readonly LexToken[],
): string[] => {
  const issues: string[] = [];
  let cursor = 0;
  for (const [index, entry] of tokens.entries()) {
    if (!(LEX_TOKEN_KINDS as readonly string[]).includes(entry.kind)) {
      issues.push(`Token ${index} has unknown kind ${JSON.stringify(entry.kind)}.`);
    }
    if (entry.start !== cursor) {
      issues.push(`Token ${index} starts at ${entry.start}, expected ${cursor} (gap or overlap).`);
    }
    if (entry.end <= entry.start || entry.end > source.length) {
      issues.push(`Token ${index} has invalid range ${entry.start}..${entry.end}.`);
    }
    if (source.slice(entry.start, entry.end) !== entry.raw) {
      issues.push(`Token ${index} raw text is not the source slice ${entry.start}..${entry.end}.`);
    }
    if (isSplitSurrogate(source, entry.start) || isSplitSurrogate(source, entry.end)) {
      issues.push(`Token ${index} boundary splits a surrogate pair.`);
    }
    cursor = entry.end;
  }
  if (cursor !== source.length) {
    issues.push(`Tokens cover ${cursor} of ${source.length} code units.`);
  }
  if (reconstructSource(tokens) !== source) {
    issues.push("Reconstruction from tokens differs from the source.");
  }
  return issues;
};

/** True when `offset` falls between the two halves of a valid surrogate pair. */
const isSplitSurrogate = (source: string, offset: number): boolean =>
  offset > 0 &&
  offset < source.length &&
  isHighSurrogate(source.charCodeAt(offset - 1)) &&
  isLowSurrogate(source.charCodeAt(offset));
