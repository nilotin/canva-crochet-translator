import { getTargetNotation } from "./glossary.js";
import { lexMixedSegment } from "./mixed_segment.js";
import { tokenizeSourceNotation } from "./notation/tokenizer.js";
import type {
  TargetFormattingRegion,
  TargetLanguage,
  TranslationBlock,
} from "./types.js";

type SourceFormattingRegion = NonNullable<
  TranslationBlock["formattingRegions"]
>[number];

type ProjectedPiece = {
  sourceStart: number;
  sourceEnd: number;
  targetStart: number;
  targetEnd: number;
};

const buildPatternOnlyPieces = (
  source: string,
  targetLanguage: TargetLanguage,
): ProjectedPiece[] => {
  const occurrences = tokenizeSourceNotation(source);
  const pieces: ProjectedPiece[] = [];

  let sourceCursor = 0;
  let targetCursor = 0;

  for (const occurrence of occurrences) {
    if (occurrence.start > sourceCursor) {
      const unchanged = source.slice(sourceCursor, occurrence.start);

      pieces.push({
        sourceStart: sourceCursor,
        sourceEnd: occurrence.start,
        targetStart: targetCursor,
        targetEnd: targetCursor + unchanged.length,
      });

      targetCursor += unchanged.length;
    }

    const sourceNotation = source.slice(occurrence.start, occurrence.end);
    const targetNotation =
      getTargetNotation(occurrence.entry, targetLanguage)?.abbreviation ??
      sourceNotation;

    pieces.push({
      sourceStart: occurrence.start,
      sourceEnd: occurrence.end,
      targetStart: targetCursor,
      targetEnd: targetCursor + targetNotation.length,
    });

    sourceCursor = occurrence.end;
    targetCursor += targetNotation.length;
  }

  if (sourceCursor < source.length) {
    const unchanged = source.slice(sourceCursor);

    pieces.push({
      sourceStart: sourceCursor,
      sourceEnd: source.length,
      targetStart: targetCursor,
      targetEnd: targetCursor + unchanged.length,
    });
  }

  return pieces;
};

const buildMixedDeterministicPieces = (
  source: string,
  targetLanguage: TargetLanguage,
): ProjectedPiece[] | undefined => {
  const lexed = lexMixedSegment(source, targetLanguage, "formatting");

  if (!lexed.valid || lexed.classification !== "mixed") return undefined;

  const pieces: ProjectedPiece[] = [];
  let targetCursor = 0;

  for (const token of lexed.tokens) {
    if (token.kind === "natural_language") return undefined;

    const targetText =
      token.kind === "notation" ? token.target : token.sourceText;

    pieces.push({
      sourceStart: token.start,
      sourceEnd: token.end,
      targetStart: targetCursor,
      targetEnd: targetCursor + targetText.length,
    });

    targetCursor += targetText.length;
  }

  return pieces;
};

const buildDeterministicPieces = (
  source: string,
  targetLanguage: TargetLanguage,
): ProjectedPiece[] | undefined => {
  const lexed = lexMixedSegment(source, targetLanguage, "formatting");

  if (!lexed.valid) return undefined;

  if (lexed.classification === "pattern_only") {
    return buildPatternOnlyPieces(source, targetLanguage);
  }

  return buildMixedDeterministicPieces(source, targetLanguage);
};

const projectRegion = (
  region: SourceFormattingRegion,
  pieces: readonly ProjectedPiece[],
): TargetFormattingRegion | undefined => {
  const overlapping = pieces.filter(
    (piece) => piece.sourceStart < region.end && piece.sourceEnd > region.start,
  );

  if (overlapping.length === 0) return undefined;

  const first = overlapping[0];
  const last = overlapping[overlapping.length - 1];

  if (!first || !last) return undefined;

  if (first.sourceStart !== region.start || last.sourceEnd !== region.end) {
    return undefined;
  }

  return {
    id: region.id,
    start: first.targetStart,
    end: last.targetEnd,
  };
};

export const projectFormattingRegionsFromPieces = (
  regions: readonly SourceFormattingRegion[] | undefined,
  pieces: readonly ProjectedPiece[],
): TargetFormattingRegion[] | undefined => {
  if (!regions?.length) return undefined;
  if (!pieces.length) return undefined;

  const projected = regions.map((region) => projectRegion(region, pieces));

  if (projected.some((region) => region === undefined)) return undefined;

  return projected as TargetFormattingRegion[];
};

export const projectDeterministicFormattingRegions = (
  block: TranslationBlock,
  targetLanguage: TargetLanguage,
): TargetFormattingRegion[] | undefined => {
  const regions = block.formattingRegions;
  if (!regions?.length) return undefined;

  const pieces = buildDeterministicPieces(block.text, targetLanguage);
  if (!pieces) return undefined;

  return projectFormattingRegionsFromPieces(regions, pieces);
};
