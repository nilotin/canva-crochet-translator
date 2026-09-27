/**
 * Optional per-block reading-order metadata.
 *
 * `validatedReadingOrder` is intentionally lenient: it returns block ids in
 * reading order when every block carries a unique, non-negative safe integer.
 * Gaps are allowed. Invalid or missing metadata returns undefined and must
 * never fail translation.
 *
 * `pageReadingOrder` is the stricter production gate for cross-block semantic
 * context. It additionally requires one complete dense page-local ranking
 * 0..n-1 and at least two blocks. Translation array order is never changed.
 */

/** The fields read: a request block's id and its optional `readingOrder`. */
export type ReadingOrderBlock = { readonly id: string; readonly readingOrder?: unknown };

export const validatedReadingOrder = (
  blocks: readonly ReadingOrderBlock[],
): readonly string[] | undefined => {
  if (blocks.length === 0) return undefined;
  const seen = new Set<number>();

  for (const { readingOrder } of blocks) {
    if (
      typeof readingOrder !== "number" ||
      !Number.isSafeInteger(readingOrder) ||
      readingOrder < 0
    ) {
      return undefined;
    }

    if (seen.has(readingOrder)) return undefined;
    seen.add(readingOrder);
  }

  return [...blocks]
    .sort((left, right) => (left.readingOrder as number) - (right.readingOrder as number))
    .map(({ id }) => id);
};

/**
 * Complete page-local order for trusted cross-block context.
 *
 * Unlike `validatedReadingOrder`, this requires exactly the dense rank set
 * {0, ..., n-1}. This rejects partial pages, gaps and ordinary concatenations
 * of separately-ranked pages (duplicate zeroes). Never throws.
 */
export const pageReadingOrder = (
  blocks: readonly ReadingOrderBlock[],
): readonly string[] | undefined => {
  if (blocks.length < 2) return undefined;

  try {
    const ordered = validatedReadingOrder(blocks);
    if (ordered === undefined || ordered.length !== blocks.length) return undefined;

    const ranks = blocks
      .map(({ readingOrder }) => readingOrder)
      .filter((value): value is number => typeof value === "number")
      .sort((left, right) => left - right);

    if (ranks.length !== blocks.length) return undefined;

    for (let index = 0; index < ranks.length; index += 1) {
      if (ranks[index] !== index) return undefined;
    }

    return ordered;
  } catch {
    return undefined;
  }
};
