/**
 * `N)` / `A-B)` marker ownership (Stage 2, Task 3: SHADOW ONLY).
 *
 * The typed lexer emits `12)` as a `number` and a `bracket`, and `2-25)` as
 * `number`, `dash`, `number`, `bracket`. This module is the typed-path owner of
 * one question: is this a line-leading structural instruction marker, or an
 * ordinary numeric use of `)`? It decides:
 *
 *  - `instruction_marker`  a single (`12)`) or range (`2-25)`) marker at the
 *                          start of a line, exposing `first` and `last`;
 *  - `ordinary`            anything else: parenthesized numbers in prose,
 *                          mid-line uses, glued forms, unsafe numbers.
 *
 * It classifies only. Continuity (does 13 follow 12?), resets, range ordering
 * and row/round meaning belong to a later PatternContext. Nothing here
 * translates or routes; no production module imports it, and production still
 * uses `extractLeadingInstruction` (single markers at a segment start) and
 * the unit inference's numbered-line rule (which also accepts ranges).
 *
 * Occurrence: an integer `number` token immediately followed by a `)` bracket
 * token. `index` is that number token (for a range, the second number).
 *
 * Rule precedence (first match wins; every check is a token-kind, exact raw
 * text or single-token digit check, never a clause regex):
 *
 *  1. unsafe-number   the number before `)` is not a safe integer
 *                                                        -> ordinary
 *  2. (range)         `digits` `-` `digits` `)`, with nothing between them,
 *                     widens the marker; an unsafe first number is also
 *                     unsafe-number                      -> ordinary
 *  3. not-leading     anything other than horizontal whitespace precedes the
 *                     marker on its line                 -> ordinary
 *  4. attached-right  `)` is followed by something other than whitespace, a
 *                     line break or the end              -> ordinary
 *  5. leading-line    otherwise                          -> instruction_marker
 *
 * "Leading" is per line of the given source: at its start or after a line
 * break, with only spaces/tabs before the marker. It does not use
 * segmentation.
 *
 * Numbers: digits only, `Number.isSafeInteger`. `0)` and `01)` are accepted,
 * as production accepts them; the span keeps the raw text. Range ordering is
 * not checked.
 *
 * Import rules: `../lexer/typed_lexer.js` and `./frame_ir.js` only. No
 * translator, normalizer, instruction-marker, segmentation, validator,
 * provider or corpus code.
 */
import { lexSource, type LexToken } from "../lexer/typed_lexer.js";
import type { SourceSpan } from "./frame_ir.js";

export type NumberParenReason = "leading-line" | "not-leading" | "attached-right" | "unsafe-number";

export type NumberParenDecision =
  | {
      readonly kind: "instruction_marker";
      readonly reason: "leading-line";
      readonly first: number;
      readonly last: number;
      /** The whole marker, e.g. `12)` or `2-25)`. */
      readonly span: SourceSpan;
      /** Index of the number token immediately before `)`. */
      readonly index: number;
    }
  | {
      readonly kind: "ordinary";
      readonly reason: Exclude<NumberParenReason, "leading-line">;
      readonly span: SourceSpan;
      readonly index: number;
    };

export class NumberParenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NumberParenError";
  }
}

const DIGITS_ONLY = /^[0-9]+$/;
const RANGE_DASH = "-";
const CLOSE_PAREN = ")";

/** The value of a digits-only number token, or undefined when it is not a safe integer. */
const safeValue = (token: LexToken): number | undefined => {
  const value = Number(token.raw);
  return Number.isSafeInteger(value) ? value : undefined;
};

const isDigits = (token: LexToken | undefined): token is LexToken =>
  token?.kind === "number" && DIGITS_ONLY.test(token.raw);

/** True when `tokens[index]` is an integer number immediately followed by `)`. */
export const isNumberParen = (tokens: readonly LexToken[], index: number): boolean => {
  const number = tokens[index];
  const paren = tokens[index + 1];
  return (
    isDigits(number) &&
    paren?.kind === "bracket" &&
    paren.raw === CLOSE_PAREN &&
    paren.start === number.end
  );
};

/** Only horizontal whitespace between the start of the line and `tokens[start]`. */
const startsLine = (tokens: readonly LexToken[], start: number): boolean => {
  let cursor = start - 1;
  while (cursor >= 0 && tokens[cursor]?.kind === "whitespace") cursor -= 1;
  return cursor < 0 || tokens[cursor]?.kind === "line_break";
};

/**
 * Classifies the `)` marker whose closing number token is `tokens[index]`.
 * `tokens` must be the typed tokens of `source`. Pure and deterministic.
 * Throws `NumberParenError` when `tokens[index]` is not an integer number
 * immediately followed by `)`, or when the tokens used are not exact slices of
 * `source`.
 */
export const classifyNumberParen = (
  tokens: readonly LexToken[],
  index: number,
  source: string,
): NumberParenDecision => {
  if (!isNumberParen(tokens, index)) {
    throw new NumberParenError(`Token ${index} is not an integer number followed by ")".`);
  }
  const last = tokens[index]!;
  const paren = tokens[index + 1]!;
  const dash = tokens[index - 1];
  const first = tokens[index - 2];
  const isRange = dash?.kind === "dash" && dash.raw === RANGE_DASH && isDigits(first);
  for (const token of isRange ? [first!, dash, last, paren] : [last, paren]) {
    if (source.slice(token.start, token.end) !== token.raw) {
      throw new NumberParenError(`Token at ${token.start}..${token.end} is not a slice of the source.`);
    }
  }

  const spanFrom = (start: number): SourceSpan => ({
    start,
    end: paren.end,
    raw: source.slice(start, paren.end),
  });
  const ordinary = (
    reason: Exclude<NumberParenReason, "leading-line">,
    start: number,
  ): NumberParenDecision => ({ kind: "ordinary", reason, span: spanFrom(start), index });

  const lastValue = safeValue(last);
  if (lastValue === undefined) return ordinary("unsafe-number", last.start);

  const startToken = isRange ? first! : last;
  const firstValue = isRange ? safeValue(first!) : lastValue;
  if (firstValue === undefined) return ordinary("unsafe-number", startToken.start);

  if (!startsLine(tokens, isRange ? index - 2 : index)) return ordinary("not-leading", startToken.start);
  const after = tokens[index + 2];
  if (after !== undefined && after.kind !== "whitespace" && after.kind !== "line_break") {
    return ordinary("attached-right", startToken.start);
  }
  return {
    kind: "instruction_marker",
    reason: "leading-line",
    first: firstValue,
    last: lastValue,
    span: spanFrom(startToken.start),
    index,
  };
};

/** Every `)` marker occurrence in `source`, classified, in source order. */
export const classifyNumberParens = (source: string): NumberParenDecision[] => {
  const tokens = lexSource(source);
  return tokens.flatMap((_token, index) =>
    isNumberParen(tokens, index) ? [classifyNumberParen(tokens, index, source)] : [],
  );
};
