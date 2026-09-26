import { lexMixedSegment } from "./mixed_segment.js";
import {
  parseBareRoundCountSourceLine,
  parseBareRoundCountTargetLine,
} from "./natural_language/bare_round_count.js";
import { renderEnglishSleeveInstruction } from "./natural_language/sleeve_instructions.js";
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

const mergeAdjacentTargetFormattingRuns = (
  runs: readonly TargetFormattingRegion[],
): TargetFormattingRegion[] => {
  const merged: TargetFormattingRegion[] = [];

  for (const run of runs) {
    const previous = merged[merged.length - 1];

    if (
      previous &&
      previous.id === run.id &&
      previous.end === run.start
    ) {
      previous.end = run.end;
      continue;
    }

    merged.push({ ...run });
  }

  return merged;
};

const formattingRegionOwningSourceSpan = (
  regions: readonly SourceFormattingRegion[],
  start: number,
  end: number,
): SourceFormattingRegion | undefined => {
  const owners = regions.filter(
    (region) => region.start <= start && region.end >= end,
  );

  return owners.length === 1 ? owners[0] : undefined;
};

export const projectBareRoundCountAtomicFormattingRegions = (
  source: string,
  target: string,
  regions: readonly SourceFormattingRegion[],
): TargetFormattingRegion[] | undefined => {
  const parsedSource = parseBareRoundCountSourceLine(source);
  const parsedTarget = parseBareRoundCountTargetLine(target);

  if (!parsedSource || !parsedTarget) return undefined;

  if (
    parsedSource.range !== parsedTarget.range ||
    parsedSource.rounds !== parsedTarget.rounds ||
    parsedSource.stitches !== parsedTarget.stitches
  ) {
    return undefined;
  }

  const sourcePrefixEnd = parsedSource.prefix.length;
  const sourceStitchText = `${parsedSource.stitches}x`;
  const sourceStitchStart = source.lastIndexOf(
    sourceStitchText,
    source.length - parsedSource.suffix.length - sourceStitchText.length,
  );

  if (sourceStitchStart < sourcePrefixEnd) return undefined;

  const sourceStitchEnd = sourceStitchStart + sourceStitchText.length;

  if (
    source.slice(sourceStitchEnd) !== parsedSource.suffix
  ) {
    return undefined;
  }

  const targetPrefixEnd = parsedTarget.prefix.length;
  const targetStitchText = `${parsedTarget.stitches}sc`;
  const targetStitchStart = targetPrefixEnd;
  const targetStitchEnd = targetStitchStart + targetStitchText.length;
  const targetSuffixStart = target.length - parsedTarget.suffix.length;

  if (
    target.slice(targetStitchStart, targetStitchEnd) !== targetStitchText ||
    targetSuffixStart < targetStitchEnd
  ) {
    return undefined;
  }

  const semanticPieces = [
    {
      sourceStart: 0,
      sourceEnd: sourcePrefixEnd,
      targetStart: 0,
      targetEnd: targetPrefixEnd,
    },
    {
      sourceStart: sourceStitchStart,
      sourceEnd: sourceStitchEnd,
      targetStart: targetStitchStart,
      targetEnd: targetStitchEnd,
    },
    {
      sourceStart: sourcePrefixEnd,
      sourceEnd: sourceStitchStart,
      targetStart: targetStitchEnd,
      targetEnd: targetSuffixStart,
    },
    {
      sourceStart: sourceStitchEnd,
      sourceEnd: source.length,
      targetStart: targetSuffixStart,
      targetEnd: target.length,
    },
  ].filter(
    (piece) =>
      piece.sourceEnd > piece.sourceStart ||
      piece.targetEnd > piece.targetStart,
  );

  const runs: TargetFormattingRegion[] = [];

  for (const piece of semanticPieces) {
    if (
      piece.sourceEnd <= piece.sourceStart ||
      piece.targetEnd <= piece.targetStart
    ) {
      return undefined;
    }

    const owner = formattingRegionOwningSourceSpan(
      regions,
      piece.sourceStart,
      piece.sourceEnd,
    );

    if (!owner) return undefined;

    runs.push({
      id: owner.id,
      start: piece.targetStart,
      end: piece.targetEnd,
    });
  }

  const merged = mergeAdjacentTargetFormattingRuns(
    runs.sort((left, right) => left.start - right.start),
  );

  let cursor = 0;

  for (const run of merged) {
    if (run.start !== cursor || run.end <= run.start) return undefined;
    cursor = run.end;
  }

  return cursor === target.length ? merged : undefined;
};


type CompactSemanticPiece = {
  sourceStart: number;
  sourceEnd: number;
  targetStart: number;
  targetEnd: number;
};

const projectOwnedSemanticPieces = (
  pieces: readonly CompactSemanticPiece[],
  regions: readonly SourceFormattingRegion[],
  targetLength: number,
): TargetFormattingRegion[] | undefined => {
  if (!pieces.length) return undefined;

  const runs: TargetFormattingRegion[] = [];

  for (const piece of pieces) {
    if (
      piece.sourceEnd <= piece.sourceStart ||
      piece.targetEnd <= piece.targetStart
    ) {
      return undefined;
    }

    const owner = formattingRegionOwningSourceSpan(
      regions,
      piece.sourceStart,
      piece.sourceEnd,
    );

    if (!owner) return undefined;

    runs.push({
      id: owner.id,
      start: piece.targetStart,
      end: piece.targetEnd,
    });
  }

  const merged = mergeAdjacentTargetFormattingRuns(
    runs.sort((left, right) => left.start - right.start),
  );

  let cursor = 0;

  for (const run of merged) {
    if (run.start !== cursor || run.end <= run.start) {
      return undefined;
    }

    cursor = run.end;
  }

  return cursor === targetLength ? merged : undefined;
};

export const projectInstructionMarkerBodyFormattingRegions = (
  source: string,
  target: string,
  regions: readonly SourceFormattingRegion[],
): TargetFormattingRegion[] | undefined => {
  const sourcePrefixMatch =
    /^(\s*)(\d+(?:-\d+)?\)\s*)/u.exec(source);
  const targetPrefixMatch =
    /^(\s*)(\d+(?:-\d+)?\)\s*)/u.exec(target);

  if (!sourcePrefixMatch || !targetPrefixMatch) {
    return undefined;
  }

  const sourceMarker = sourcePrefixMatch[2] ?? "";
  const targetMarker = targetPrefixMatch[2] ?? "";

  if (sourceMarker.trim() !== targetMarker.trim()) {
    return undefined;
  }

  const sourcePrefixEnd = sourcePrefixMatch[0].length;
  const targetPrefixEnd = targetPrefixMatch[0].length;

  if (
    sourcePrefixEnd <= 0 ||
    targetPrefixEnd <= 0 ||
    sourcePrefixEnd >= source.length ||
    targetPrefixEnd >= target.length
  ) {
    return undefined;
  }

  return projectOwnedSemanticPieces(
    [
      {
        sourceStart: 0,
        sourceEnd: sourcePrefixEnd,
        targetStart: 0,
        targetEnd: targetPrefixEnd,
      },
      {
        sourceStart: sourcePrefixEnd,
        sourceEnd: source.length,
        targetStart: targetPrefixEnd,
        targetEnd: target.length,
      },
    ],
    regions,
    target.length,
  );
};

const normalizedCompactStructure = (
  value: string,
  sourceNotation: boolean,
): string => {
  let normalized = value
    .replace(/，/gu, ",")
    .replace(/\s+/gu, "")
    .toLowerCase();

  if (sourceNotation) {
    normalized = normalized
      .replace(/x/gu, "sc")
      .replace(/v/gu, "inc");
  }

  return normalized;
};

const projectCompactChainCutFormattingRegions = (
  source: string,
  target: string,
  regions: readonly SourceFormattingRegion[],
): TargetFormattingRegion[] | undefined => {
  const sourceMatch =
    /^(\s*)(?:(\d+)\)\s*)?(\d+)\s*x\s*[,，]\s*(\d+)\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz([.]?\s*)$/iu.exec(
      source,
    );

  const targetMatch =
    /^(\s*)(?:(\d+)\)\s*)?(\d+)sc[.]\s*Ch\s+(\d+)\s+and\s+cut\s+the\s+yarn([.]?\s*)$/u.exec(
      target,
    );

  if (!sourceMatch || !targetMatch) return undefined;

  const sourceRow = sourceMatch[2] ?? "";
  const targetRow = targetMatch[2] ?? "";
  const sourceStitches = sourceMatch[3] ?? "";
  const targetStitches = targetMatch[3] ?? "";
  const sourceChains = sourceMatch[4] ?? "";
  const targetChains = targetMatch[4] ?? "";

  if (
    sourceRow !== targetRow ||
    sourceStitches !== targetStitches ||
    sourceChains !== targetChains
  ) {
    return undefined;
  }

  const sourceFinishingMatch =
    /(\d+)\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz([.]?\s*)$/iu.exec(
      source,
    );

  const targetFinishingMatch =
    /Ch\s+(\d+)\s+and\s+cut\s+the\s+yarn([.]?\s*)$/u.exec(
      target,
    );

  if (!sourceFinishingMatch || !targetFinishingMatch) {
    return undefined;
  }

  const sourceFinishingStart = sourceFinishingMatch.index;
  const targetFinishingStart = targetFinishingMatch.index;

  const sourcePrefixMatch = /^(\s*)(?:(\d+)\)\s*)?/u.exec(source);
  const targetPrefixMatch = /^(\s*)(?:(\d+)\)\s*)?/u.exec(target);

  if (!sourcePrefixMatch || !targetPrefixMatch) {
    return undefined;
  }

  const sourcePrefixEnd = sourcePrefixMatch[0].length;
  const targetPrefixEnd = targetPrefixMatch[0].length;

  const pieces: CompactSemanticPiece[] = [];

  if (sourceRow) {
    if (!targetRow || sourcePrefixEnd <= 0 || targetPrefixEnd <= 0) {
      return undefined;
    }

    pieces.push({
      sourceStart: 0,
      sourceEnd: sourcePrefixEnd,
      targetStart: 0,
      targetEnd: targetPrefixEnd,
    });
  }

  pieces.push(
    {
      sourceStart: sourceRow ? sourcePrefixEnd : 0,
      sourceEnd: sourceFinishingStart,
      targetStart: targetRow ? targetPrefixEnd : 0,
      targetEnd: targetFinishingStart,
    },
    {
      sourceStart: sourceFinishingStart,
      sourceEnd: source.length,
      targetStart: targetFinishingStart,
      targetEnd: target.length,
    },
  );

  return projectOwnedSemanticPieces(pieces, regions, target.length);
};

const projectCompactChainTurnFormattingRegions = (
  source: string,
  target: string,
  regions: readonly SourceFormattingRegion[],
): TargetFormattingRegion[] | undefined => {
  const sourceTurnMatch =
    /(\d+)\s+zincir\s*[,，]\s*dön\s*[,，]?\s*$/iu.exec(source);

  const targetTurnMatch =
    /Ch\s+(\d+)\s+and\s+turn\s*[,，]?\s*$/u.exec(target);

  if (!sourceTurnMatch || !targetTurnMatch) return undefined;

  if ((sourceTurnMatch[1] ?? "") !== (targetTurnMatch[1] ?? "")) {
    return undefined;
  }

  const sourceTurnStart = sourceTurnMatch.index;
  const targetTurnStart = targetTurnMatch.index;

  const sourceIntroMatch =
    /^(\s*)(?:(\d+)\)\s*)?Bu\s+sırayı\s+(FLO|BLO)\s*[’'ʼ]?\s*(?:dan|den)\s+örüyoruz[.]\s*/iu.exec(
      source,
    );

  const targetIntroMatch =
    /^(\s*)(?:(\d+)\)\s*)?Work\s+this\s+round\s+in\s+(FLO|BLO)[.]\s*/u.exec(
      target,
    );

  if (sourceIntroMatch || targetIntroMatch) {
    if (!sourceIntroMatch || !targetIntroMatch) return undefined;

    const sourceRow = sourceIntroMatch[2] ?? "";
    const targetRow = targetIntroMatch[2] ?? "";
    const sourceLoop = (sourceIntroMatch[3] ?? "").toUpperCase();
    const targetLoop = (targetIntroMatch[3] ?? "").toUpperCase();

    if (
      sourceRow !== targetRow ||
      sourceLoop !== targetLoop
    ) {
      return undefined;
    }

    const sourceStitchStart = sourceIntroMatch[0].length;
    const targetStitchStart = targetIntroMatch[0].length;

    if (
      sourceTurnStart <= sourceStitchStart ||
      targetTurnStart <= targetStitchStart
    ) {
      return undefined;
    }

    const sourceStitchStructure = normalizedCompactStructure(
      source.slice(sourceStitchStart, sourceTurnStart),
      true,
    );

    const targetStitchStructure = normalizedCompactStructure(
      target.slice(targetStitchStart, targetTurnStart),
      false,
    );

    if (sourceStitchStructure !== targetStitchStructure) {
      return undefined;
    }

    const sourcePrefixMatch = /^(\s*)(?:(\d+)\)\s*)?/u.exec(source);
    const targetPrefixMatch = /^(\s*)(?:(\d+)\)\s*)?/u.exec(target);

    if (!sourcePrefixMatch || !targetPrefixMatch) {
      return undefined;
    }

    const sourcePrefixEnd = sourcePrefixMatch[0].length;
    const targetPrefixEnd = targetPrefixMatch[0].length;

    const pieces: CompactSemanticPiece[] = [];

    if (sourceRow) {
      if (!targetRow || sourcePrefixEnd <= 0 || targetPrefixEnd <= 0) {
        return undefined;
      }

      pieces.push({
        sourceStart: 0,
        sourceEnd: sourcePrefixEnd,
        targetStart: 0,
        targetEnd: targetPrefixEnd,
      });
    }

    pieces.push(
      {
        sourceStart: sourceRow ? sourcePrefixEnd : 0,
        sourceEnd: sourceStitchStart,
        targetStart: targetRow ? targetPrefixEnd : 0,
        targetEnd: targetStitchStart,
      },
      {
        sourceStart: sourceStitchStart,
        sourceEnd: sourceTurnStart,
        targetStart: targetStitchStart,
        targetEnd: targetTurnStart,
      },
      {
        sourceStart: sourceTurnStart,
        sourceEnd: source.length,
        targetStart: targetTurnStart,
        targetEnd: target.length,
      },
    );

    return projectOwnedSemanticPieces(pieces, regions, target.length);
  }

  const sourcePrefixMatch =
    /^(\s*)(?:(\d+)\)\s*)?/u.exec(source);
  const targetPrefixMatch =
    /^(\s*)(?:(\d+)\)\s*)?/u.exec(target);

  if (!sourcePrefixMatch || !targetPrefixMatch) {
    return undefined;
  }

  const sourceRow = sourcePrefixMatch[2] ?? "";
  const targetRow = targetPrefixMatch[2] ?? "";

  if (sourceRow !== targetRow) {
    return undefined;
  }

  const sourceStitchStart = sourcePrefixMatch[0].length;
  const targetStitchStart = targetPrefixMatch[0].length;

  if (
    sourceTurnStart <= sourceStitchStart ||
    targetTurnStart <= targetStitchStart
  ) {
    return undefined;
  }

  const sourceStitchStructure = normalizedCompactStructure(
    source.slice(sourceStitchStart, sourceTurnStart),
    true,
  );

  const targetStitchStructure = normalizedCompactStructure(
    target.slice(targetStitchStart, targetTurnStart),
    false,
  );

  if (sourceStitchStructure !== targetStitchStructure) {
    return undefined;
  }

  const pieces: CompactSemanticPiece[] = [];

  if (sourceRow) {
    if (!targetRow || sourceStitchStart <= 0 || targetStitchStart <= 0) {
      return undefined;
    }

    pieces.push({
      sourceStart: 0,
      sourceEnd: sourceStitchStart,
      targetStart: 0,
      targetEnd: targetStitchStart,
    });
  }

  pieces.push(
    {
      sourceStart: sourceRow ? sourceStitchStart : 0,
      sourceEnd: sourceTurnStart,
      targetStart: targetRow ? targetStitchStart : 0,
      targetEnd: targetTurnStart,
    },
    {
      sourceStart: sourceTurnStart,
      sourceEnd: source.length,
      targetStart: targetTurnStart,
      targetEnd: target.length,
    },
  );

  return projectOwnedSemanticPieces(pieces, regions, target.length);
};

export const projectCompactCrochetRowFormattingRegions = (
  source: string,
  target: string,
  regions: readonly SourceFormattingRegion[],
): TargetFormattingRegion[] | undefined =>
  projectCompactChainCutFormattingRegions(source, target, regions) ??
  projectCompactChainTurnFormattingRegions(source, target, regions);


type TextSpan = {
  start: number;
  end: number;
};

const completeSentenceSpans = (text: string): TextSpan[] => {
  const spans: TextSpan[] = [];
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    const isNumericOrdinalDot =
      char === "." &&
      /\d/u.test(text[index - 1] ?? "") &&
      /\s/u.test(text[index + 1] ?? "") &&
      /\p{L}/u.test(
        text.slice(index + 1).trimStart()[0] ?? "",
      );

    if (
      !isNumericOrdinalDot &&
      (char === "." || char === "!" || char === "?") &&
      (index === text.length - 1 || /\s/u.test(text[index + 1] ?? ""))
    ) {
      let end = index + 1;

      while (end < text.length && /\s/u.test(text[end] ?? "")) {
        end += 1;
      }

      spans.push({ start, end });
      start = end;
    }
  }

  if (start < text.length) {
    spans.push({ start, end: text.length });
  }

  return spans.filter(({ start: spanStart, end }) => end > spanStart);
};

export const projectSleeveAtomicFormattingRegions = (
  source: string,
  target: string,
  regions: readonly SourceFormattingRegion[],
): TargetFormattingRegion[] | undefined => {
  const rendered = renderEnglishSleeveInstruction(source);

  if (!rendered || rendered.target !== target) {
    return undefined;
  }

  const sourcePrefixMatch =
    /^(\s*)((?:(?:\d+)\)|[♦✦])\s*)?/u.exec(source);
  const targetPrefixMatch =
    /^(\s*)((?:(?:\d+)\)|[♦✦])\s*)?/u.exec(target);

  if (!sourcePrefixMatch || !targetPrefixMatch) {
    return undefined;
  }

  const sourceMarker = (sourcePrefixMatch[2] ?? "").trim();
  const targetMarker = (targetPrefixMatch[2] ?? "").trim();

  if (sourceMarker !== targetMarker) {
    return undefined;
  }

  const sourcePrefixEnd = sourcePrefixMatch[0].length;
  const targetPrefixEnd = targetPrefixMatch[0].length;

  const sourceBodyClauses = completeSentenceSpans(
    source.slice(sourcePrefixEnd),
  ).map(({ start, end }) => ({
    start: start + sourcePrefixEnd,
    end: end + sourcePrefixEnd,
  }));

  const targetBodyClauses = completeSentenceSpans(
    target.slice(targetPrefixEnd),
  ).map(({ start, end }) => ({
    start: start + targetPrefixEnd,
    end: end + targetPrefixEnd,
  }));

  const expectedClauseCount = rendered.family === "setup" ? 3 : 4;

  if (
    sourceBodyClauses.length !== expectedClauseCount ||
    targetBodyClauses.length !== expectedClauseCount
  ) {
    return undefined;
  }

  const pieces: CompactSemanticPiece[] = [];

  if (sourcePrefixEnd > 0 || targetPrefixEnd > 0) {
    if (sourcePrefixEnd <= 0 || targetPrefixEnd <= 0) {
      return undefined;
    }

    pieces.push({
      sourceStart: 0,
      sourceEnd: sourcePrefixEnd,
      targetStart: 0,
      targetEnd: targetPrefixEnd,
    });
  }

  for (let index = 0; index < expectedClauseCount; index += 1) {
    const sourceClause = sourceBodyClauses[index];
    const targetClause = targetBodyClauses[index];

    if (!sourceClause || !targetClause) {
      return undefined;
    }

    pieces.push({
      sourceStart: sourceClause.start,
      sourceEnd: sourceClause.end,
      targetStart: targetClause.start,
      targetEnd: targetClause.end,
    });
  }

  return projectOwnedSemanticPieces(pieces, regions, target.length);
};
