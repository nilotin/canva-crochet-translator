import type { TranslationBlock } from "./types.js";

export type FormattingTranslationUnit = {
  id: string;
  text: string;
  start: number;
  end: number;
  atomic?: true;
  collapsesFormatting?: true;
  absorbedRegionIds?: string[];
};

export type ProtectedFormattingSpan = {
  start: number;
  end: number;
};

// Only a letter-to-letter boundary can split a genuine natural-language
// word (or a multi-letter notation abbreviation) into two independently
// translated fragments, which would corrupt the translation. A boundary
// touching a digit is always safe to split on: numbers and crochet
// notation are protected/reconstructed deterministically per formatting
// unit, so the concatenated result is identical whether or not a number
// is split across units (e.g. "12x" as "1"+"2x" still reconstructs to
// "12sc"). Digits were previously included here, which made the common
// pattern of styling just a leading number or notation token (a very
// ordinary Canva formatting choice) fall through to the fully
// deterministic fallback, where a genuinely translated multi-style block
// has no way to be projected and is blocked outright.
const wordCharacter = /\p{L}/u;

const boundarySplitsWord = (source: string, index: number): boolean => {
  if (index <= 0 || index >= source.length) return false;

  return (
    wordCharacter.test(source[index - 1] ?? "") &&
    wordCharacter.test(source[index] ?? "")
  );
};

export const buildFormattingTranslationUnits = (
  block: TranslationBlock,
  protectedSpans: readonly ProtectedFormattingSpan[] = [],
): FormattingTranslationUnit[] | undefined => {
  const regions = block.formattingRegions;
  if (!regions?.length) return undefined;

  const sorted = [...regions].sort((a, b) => a.start - b.start);

  if (sorted[0]?.start !== 0) return undefined;
  if (sorted.at(-1)?.end !== block.text.length) return undefined;

  const atomicSpans = [...protectedSpans]
    .filter(
      ({ start, end }) =>
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start >= 0 &&
        end > start &&
        end <= block.text.length,
    )
    .sort((left, right) => left.start - right.start)
    .reduce<ProtectedFormattingSpan[]>((merged, span) => {
      const previous = merged.at(-1);
      if (previous && span.start < previous.end) {
        previous.end = Math.max(previous.end, span.end);
      } else {
        merged.push({ ...span });
      }
      return merged;
    }, []);

  const boundaryInsideAtomicSpan = (boundary: number) =>
    atomicSpans.some(
      ({ start, end }) => boundary > start && boundary < end,
    );

  for (let index = 0; index < sorted.length; index += 1) {
    const region = sorted[index];
    const previous = sorted[index - 1];

    if (!region) return undefined;
    if (region.end < region.start) return undefined;

    if (previous && previous.end !== region.start) {
      return undefined;
    }

    if (
      index > 0 &&
      boundarySplitsWord(block.text, region.start) &&
      !boundaryInsideAtomicSpan(region.start)
    ) {
      return undefined;
    }
  }

  if (atomicSpans.length === 0) {
    return sorted.map((region) => ({
      id: region.id,
      text: block.text.slice(region.start, region.end),
      start: region.start,
      end: region.end,
    }));
  }

  const units: FormattingTranslationUnit[] = [];
  let cursor = 0;

  const regionAt = (offset: number) =>
    sorted.find(
      ({ start, end }) => offset >= start && offset < end,
    );

  const appendOrdinaryUnits = (end: number) => {
    while (cursor < end) {
      const region = regionAt(cursor);
      if (!region) return false;
      const unitEnd = Math.min(region.end, end);
      units.push({
        id: region.id,
        text: block.text.slice(cursor, unitEnd),
        start: cursor,
        end: unitEnd,
      });
      cursor = unitEnd;
    }
    return true;
  };

  for (const span of atomicSpans) {
    if (!appendOrdinaryUnits(span.start)) return undefined;

    const overlapping = sorted.filter(
      ({ start, end }) => start < span.end && end > span.start,
    );
    const owner = overlapping[0];
    if (!owner) return undefined;

    const absorbedRegionIds = overlapping
      .slice(1)
      .filter(
        ({ start, end }) => start >= span.start && end <= span.end,
      )
      .map(({ id }) => id);

    units.push({
      id: owner.id,
      text: block.text.slice(span.start, span.end),
      start: span.start,
      end: span.end,
      atomic: true,
      ...(overlapping.length > 1 ? { collapsesFormatting: true } : {}),
      ...(absorbedRegionIds.length > 0 ? { absorbedRegionIds } : {}),
    });
    cursor = span.end;
  }

  if (!appendOrdinaryUnits(block.text.length)) return undefined;
  return units;
};
