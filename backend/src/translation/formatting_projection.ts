import { lexMixedSegment } from "./mixed_segment.js";
import {
  protectImmutablePattern,
  renderProtectedToken,
} from "./notation/immutable.js";
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
): ProjectedPiece[] | undefined => {
  const protectedSource = protectImmutablePattern(source);
  const pieces: ProjectedPiece[] = [];

  let protectedCursor = 0;
  let sourceCursor = 0;
  let targetCursor = 0;

  for (const token of protectedSource.tokens) {
    const placeholderIndex = protectedSource.text.indexOf(
      token.placeholder,
      protectedCursor,
    );

    if (placeholderIndex < 0) return undefined;

    const unchanged = protectedSource.text.slice(
      protectedCursor,
      placeholderIndex,
    );

    if (unchanged.length > 0) {
      pieces.push({
        sourceStart: sourceCursor,
        sourceEnd: sourceCursor + unchanged.length,
        targetStart: targetCursor,
        targetEnd: targetCursor + unchanged.length,
      });

      sourceCursor += unchanged.length;
      targetCursor += unchanged.length;
    }

    const replacement = renderProtectedToken(token, targetLanguage);
    if (replacement === undefined) return undefined;

    pieces.push({
      sourceStart: sourceCursor,
      sourceEnd: sourceCursor + token.source.length,
      targetStart: targetCursor,
      targetEnd: targetCursor + replacement.length,
    });

    sourceCursor += token.source.length;
    targetCursor += replacement.length;
    protectedCursor = placeholderIndex + token.placeholder.length;
  }

  const trailing = protectedSource.text.slice(protectedCursor);

  if (trailing.length > 0) {
    pieces.push({
      sourceStart: sourceCursor,
      sourceEnd: sourceCursor + trailing.length,
      targetStart: targetCursor,
      targetEnd: targetCursor + trailing.length,
    });

    sourceCursor += trailing.length;
  }

  if (sourceCursor !== source.length) return undefined;

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

    const targetText = token.kind === "notation" ? token.target : token.text;

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
