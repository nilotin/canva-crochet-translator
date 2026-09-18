import { tokenizeSourceNotation } from "./tokenizer.js";

export type AmbiguousRepetitionNotation = {
  start: number;
  end: number;
};

const STITCH_NOTATION_CONCEPTS = new Set([
  "chain",
  "single_crochet",
  "increase",
  "decrease",
  "three_single_crochet_same_stitch",
  "half_double_crochet",
  "half_double_crochet_increase",
  "double_crochet",
  "double_crochet_increase",
  "double_crochet_decrease",
  "slip_stitch",
  "decrease_three_single_crochet",
  "treble_crochet",
  "treble_crochet_increase",
  "extended_single_crochet",
  "extended_single_crochet_increase",
  "three_extended_single_crochet_same_stitch",
]);

const previousNonWhitespaceIndex = (source: string, from: number) => {
  let index = from;
  while (index >= 0 && /\s/u.test(source[index] ?? "")) index -= 1;
  return index;
};

export const findAmbiguousRepetitionNotation = (
  source: string,
): AmbiguousRepetitionNotation[] => {
  const notation = tokenizeSourceNotation(source);

  return notation.flatMap((repetition) => {
    if (repetition.entry.concept !== "repetitions") return [];

    const closingParenthesis = previousNonWhitespaceIndex(
      source,
      repetition.start - 1,
    );
    if (source[closingParenthesis] !== ")") return [];

    const number = /^\d+(?:[.,]\d+)?/u.exec(source.slice(repetition.end));
    if (!number) return [];

    const numberEnd = repetition.end + number[0].length;
    const stitch = notation.find(
      (occurrence) =>
        occurrence.start === numberEnd &&
        STITCH_NOTATION_CONCEPTS.has(occurrence.entry.concept),
    );
    if (!stitch) return [];

    return [{ start: repetition.start, end: stitch.end }];
  });
};
