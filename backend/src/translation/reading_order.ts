/**
 * Request reading order (next stage, Task 10): a pure accessor for the
 * optional per-block `readingOrder` metadata. Nothing in translation uses it
 * yet; the array order remains the translation order, and the deterministic
 * template bypass keeps aligning by array index.
 *
 * `validatedReadingOrder` returns the block ids in reading order only when
 * every block carries a valid value: a non-negative safe integer, unique
 * within the request (gaps are allowed). Otherwise, including when any block
 * lacks one or the request is empty, it returns undefined, so a later caller
 * falls back to today's behavior. Never throws.
 */
/** The fields read: a request block's id and its optional `readingOrder`. */
export type ReadingOrderBlock = { readonly id: string; readonly readingOrder?: unknown };

export const validatedReadingOrder = (
  blocks: readonly ReadingOrderBlock[],
): readonly string[] | undefined => {
  if (blocks.length === 0) return undefined;
  const seen = new Set<number>();
  for (const { readingOrder } of blocks) {
    if (typeof readingOrder !== "number" || !Number.isSafeInteger(readingOrder) || readingOrder < 0) {
      return undefined;
    }
    if (seen.has(readingOrder)) return undefined;
    seen.add(readingOrder);
  }
  return [...blocks]
    .sort((left, right) => (left.readingOrder as number) - (right.readingOrder as number))
    .map(({ id }) => id);
};
