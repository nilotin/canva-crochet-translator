/**
 * The deterministic-span carrier shared by every translation path (Task 23K-2).
 *
 * A normalizer family marks its rendering at render time (`TrackedText.mark`);
 * the translator hides each such span behind a canonical reserved placeholder
 * so the provider never owns it, then restores the exact rendered text. This
 * module only reads render-time offsets: it knows nothing about any family.
 * Every step fails closed (returns undefined) so the caller keeps its
 * uncarried behavior instead of emitting partially carried output.
 */
import type { DeterministicSpan } from "./natural_language/tracked_text.js";
import {
  containsReservedPlaceholder,
  isPatternOnlyProtectedText,
  type OpaqueRange,
  type ProtectedImmutableText,
  type ProtectedToken,
  protectImmutablePattern,
  reservedPlaceholder,
  reservedPlaceholdersIn,
} from "./notation/immutable.js";
import { isStructuralPunctuationOnly } from "./mixed_segment.js";

/**
 * Normalized text with each deterministic span replaced by the canonical
 * reserved placeholder of its index (`__XQAAAAQX__` for span 0, ...), the
 * exact rendered text behind each placeholder, and the source-data ranges that
 * lie outside every span, moved to their positions in `text`. Shared by every
 * path that carries deterministic spans, and family-agnostic: it only reads
 * render-time offsets. Undefined (carry nothing) when there is nothing to
 * carry or a range cannot be placed exactly.
 */
export type CarriedSpans = {
  readonly text: string;
  readonly rendered: ReadonlyMap<string, string>;
  readonly opaqueRanges: readonly OpaqueRange[];
};

export const carryDeterministicSpans = (
  normalized: string,
  spans: readonly DeterministicSpan[],
  sourceData: readonly OpaqueRange[],
): CarriedSpans | undefined => {
  if (spans.length === 0 || containsReservedPlaceholder(normalized)) return undefined;
  // Spans must still be ordered, disjoint and equal to the text they name.
  const exact = spans.every(
    (span, index) =>
      span.start >= (spans[index - 1]?.end ?? 0) &&
      span.end > span.start &&
      normalized.slice(span.start, span.end) === span.text,
  );
  if (!exact) return undefined;

  const rendered = new Map<string, string>();
  let text = "";
  let cursor = 0;
  spans.forEach((span, index) => {
    const placeholder = reservedPlaceholder(index);
    text += normalized.slice(cursor, span.start) + placeholder;
    rendered.set(placeholder, span.text);
    cursor = span.end;
  });
  text += normalized.slice(cursor);

  // Source data inside a carried span is already restored verbatim; source
  // data outside every span stays opaque at its shifted position. A range
  // that straddles a span boundary cannot be placed safely (fail closed).
  const opaqueRanges: OpaqueRange[] = [];
  for (const range of sourceData) {
    if (spans.some((span) => range.start >= span.start && range.end <= span.end)) continue;
    if (spans.some((span) => range.start < span.end && range.end > span.start)) return undefined;
    let shift = 0;
    spans.forEach((span, index) => {
      if (span.end <= range.start) shift += reservedPlaceholder(index).length - (span.end - span.start);
    });
    opaqueRanges.push({ start: range.start + shift, end: range.end + shift });
  }
  return { text, rendered, opaqueRanges };
};

/**
 * Whole-block protection of carried text: the immutable tokens of the
 * remaining text plus one structure token per deterministic span, whose
 * placeholder restores the exact rendered text. Every placeholder is checked
 * by the usual restoration integrity (missing, duplicated, mutated,
 * reordered). Undefined (protect the uncarried text, as before) when any
 * placeholder would collide, a reserved placeholder did not survive
 * protection exactly once, or a source-data range did not stay opaque.
 */
export const protectCarriedBlock = (
  carried: CarriedSpans,
  contentKind: "pattern" | "materials",
  /** The resolved course unit at an offset of `carried.text`; omitted: round. */
  courseUnitAt?: (offset: number) => "row" | "round",
): ProtectedImmutableText | undefined => {
  const reserved = [...carried.rendered.keys()];
  // Immutable placeholders start after the reserved ones, so they are disjoint.
  const immutable = protectImmutablePattern(carried.text, reserved.length, contentKind, carried.opaqueRanges, courseUnitAt);
  if (reserved.some((placeholder) => immutable.text.split(placeholder).length !== 2)) return undefined;
  const opaqueKept = carried.opaqueRanges.every(({ start, end }) =>
    immutable.tokens.some(({ kind, source }) => kind === "structure" && source === carried.text.slice(start, end)),
  );
  if (!opaqueKept) return undefined;

  const byPlaceholder = new Map<string, ProtectedToken>(
    immutable.tokens.map((token) => [token.placeholder, token]),
  );
  for (const [placeholder, text] of carried.rendered) {
    if (byPlaceholder.has(placeholder)) return undefined;
    byPlaceholder.set(placeholder, { kind: "structure", placeholder, source: text });
  }
  // Tokens in text order, each placeholder exactly once.
  const order = reservedPlaceholdersIn(immutable.text);
  if (order.length !== byPlaceholder.size || new Set(order).size !== order.length) return undefined;
  const tokens = order.map((placeholder) => byPlaceholder.get(placeholder));
  if (tokens.some((token) => token === undefined)) return undefined;
  return { text: immutable.text, tokens: tokens as ProtectedToken[] };
};

/**
 * True when a carried block leaves nothing for the provider: only immutable
 * and carried placeholders, or structural punctuation between them
 * (Task 23A: punctuation-only text is structure, never provider-owned).
 */
export const isCarriedPatternOnly = (carried: ProtectedImmutableText): boolean =>
  isPatternOnlyProtectedText(carried) ||
  isStructuralPunctuationOnly(
    carried.tokens.reduce((text, { placeholder }) => text.split(placeholder).join(" "), carried.text),
  );
