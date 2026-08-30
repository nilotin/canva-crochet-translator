import type { TranslationBlock } from "./types.js";

export type FormattingTranslationUnit = {
  id: string;
  text: string;
  start: number;
  end: number;
};

const wordCharacter = /[\p{L}\p{N}]/u;

const boundarySplitsWord = (source: string, index: number): boolean => {
  if (index <= 0 || index >= source.length) return false;

  return (
    wordCharacter.test(source[index - 1] ?? "") &&
    wordCharacter.test(source[index] ?? "")
  );
};

export const buildFormattingTranslationUnits = (
  block: TranslationBlock,
): FormattingTranslationUnit[] | undefined => {
  const regions = block.formattingRegions;
  if (!regions?.length) return undefined;

  const sorted = [...regions].sort((a, b) => a.start - b.start);

  if (sorted[0]?.start !== 0) return undefined;
  if (sorted.at(-1)?.end !== block.text.length) return undefined;

  for (let index = 0; index < sorted.length; index += 1) {
    const region = sorted[index];
    const previous = sorted[index - 1];

    if (!region) return undefined;
    if (region.end < region.start) return undefined;

    if (previous && previous.end !== region.start) {
      return undefined;
    }

    if (index > 0 && boundarySplitsWord(block.text, region.start)) {
      return undefined;
    }
  }

  return sorted.map((region) => ({
    id: region.id,
    text: block.text.slice(region.start, region.end),
    start: region.start,
    end: region.end,
  }));
};
