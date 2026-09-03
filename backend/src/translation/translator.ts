import { normalizeSourceNaturalLanguage } from "./natural_language/normalizer.js";
import { normalizeTranslationStyle } from "./natural_language/style_normalizer.js";
import {
  isPatternOnlyProtectedText,
  protectImmutablePattern,
  restoreImmutablePattern,
} from "./notation/immutable.js";
import {
  extractLeadingInstruction,
  restoreLeadingInstruction,
} from "./instruction_marker.js";
import {
  lexMixedSegment,
  normalizeMixedProseTranslation,
  reconstructMixedSegmentWithProjection,
  validateMixedProseSpans,
} from "./mixed_segment.js";
import { buildMixedSpanPrompt, buildTranslationPrompt } from "./prompt.js";
import { createTranslationProvider } from "./providers/index.js";
import type { TranslationProvider } from "./providers/provider.js";
import {
  isSegmentWithinLimits,
  reconstructSegments,
  segmentTranslationBlock,
} from "./segmentation.js";
import type {
  TargetLanguage,
  TranslationBlock,
  TranslationResult,
  ValidationCode,
  ValidationDiagnostic,
  WarningCode,
} from "./types.js";
import { validateReturnedBlockIds, validateTranslation } from "./validator.js";
import { buildFormattingTranslationUnits } from "./formatting_units.js";

import {
  projectDeterministicFormattingRegions,
  projectFormattingRegionsFromPieces,
} from "./formatting_projection.js";

type TranslationContentKind = "pattern" | "materials";

type TranslatorOptions = {
  provider?: TranslationProvider;
  contentKind?: TranslationContentKind;
};

const annotateSegment = <TCode extends string>(
  segmentIndex: number,
  diagnostics: readonly ValidationDiagnostic<TCode>[],
): ValidationDiagnostic<TCode>[] =>
  diagnostics.map((diagnostic) => ({
    ...diagnostic,
    message: `Segment ${segmentIndex + 1}: ${diagnostic.message}`,
  }));

const uniqueDiagnostics = <TCode extends string>(
  diagnostics: readonly ValidationDiagnostic<TCode>[],
) => {
  const seen = new Set<string>();
  return diagnostics.filter(({ code, message }) => {
    const key = `${code}:${message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const translateSegment = async (
  block: TranslationBlock,
  segmentIndex: number,
  targetLanguage: TargetLanguage,
  provider: TranslationProvider,
  contentKind: TranslationContentKind = "pattern",
) => {
  const instruction =
    contentKind === "pattern"
      ? extractLeadingInstruction(block.text)
      : undefined;
  const sourceBody = instruction?.body ?? block.text;
  const normalized = normalizeSourceNaturalLanguage(sourceBody, targetLanguage);
  const protectedSource = protectImmutablePattern(
    normalized,
    0,
    contentKind,
  );
  const protectedBlock = { ...block, text: protectedSource.text };
  const patternOnly = isPatternOnlyProtectedText(protectedSource);
  const mixed = lexMixedSegment(normalized, targetLanguage, block.id);
  let restored: string | undefined;
  let mixedProjectionPieces:
    | ReturnType<typeof reconstructMixedSegmentWithProjection>["pieces"]
    | undefined;
  let structuralErrors: ValidationDiagnostic<ValidationCode>[];

  if (contentKind === "pattern" && mixed.classification === "mixed") {
    if (!mixed.valid) {
      structuralErrors = mixed.errors.map((message) => ({
        code: "INTERNAL_MIXED_LEXER_ERROR" as const,
        message,
      }));
      restored = block.text;
    } else if (mixed.spans.length === 0) {
      // The segment contains at least one immutable/notation token (hence
      // "mixed") but zero natural-language spans -- e.g. "x - dc" or
      // "x: v" in an abbreviations legend. There is nothing for the
      // provider to translate; calling it with an empty blocks array is
      // both wasteful and prone to the model inventing a spurious
      // response item (observed as an unexpected placeholder block ID).
      // Reconstruct deterministically instead, exactly like a
      // pattern-only segment.
      const reconstructed = reconstructMixedSegmentWithProjection(
        mixed.tokens,
        new Map(),
      );

      restored = restoreLeadingInstruction(instruction, reconstructed.text);
      structuralErrors = [];

      if (instruction === undefined && normalized === block.text) {
        mixedProjectionPieces = reconstructed.pieces;
      }
    } else {
      const providerSpans = mixed.spans.map((span, index) => ({
        ...span,
        id: `span-${index}`,
      }));
      const internalIdByProviderId = new Map(
        providerSpans.map((span, index) => [
          span.id,
          mixed.spans[index]?.id ?? span.id,
        ]),
      );

      const prompt = buildMixedSpanPrompt(
        targetLanguage,
        mixed.spans.map(({ text }) => text).join("\n"),
        providerSpans,
      );
      const providerResult = await provider.translate({
        targetLanguage,
        blocks: providerSpans,
        systemPrompt: prompt.system,
        userPrompt: prompt.user,
      });
      const idDiagnostics = validateReturnedBlockIds(
        providerSpans,
        providerResult.translations,
      );
      const expectedProviderIds = new Set(
        providerSpans.map(({ id }) => id),
      );
      structuralErrors = [...idDiagnostics.entries()].flatMap(
        ([id, diagnostics]) => {
          const spanIndex = providerSpans.findIndex((span) => span.id === id);
          const label =
            spanIndex >= 0
              ? `Text span ${spanIndex + 1}`
              : "Unexpected text span";
          return diagnostics.map((diagnostic) => ({
            ...diagnostic,
            message: `${label}: ${diagnostic.message}`,
          }));
        },
      );
      const translations = new Map<string, string>();
      for (const translation of providerResult.translations) {
        const internalId = internalIdByProviderId.get(translation.id);
        if (
          expectedProviderIds.has(translation.id) &&
          internalId !== undefined &&
          !translations.has(internalId)
        )
          translations.set(
            internalId,
            normalizeMixedProseTranslation(translation.translated),
          );
      }
      structuralErrors.push(
        ...validateMixedProseSpans(
          [...translations].map(([id, text]) => ({ id, text })),
        ).map((message) => ({
          code: "INTERNAL_MIXED_LEXER_ERROR" as const,
          message: `Provider result ${message.toLowerCase()}`,
        })),
      );
      const reconstructed = reconstructMixedSegmentWithProjection(
        mixed.tokens,
        translations,
      );

      restored = restoreLeadingInstruction(instruction, reconstructed.text);

      if (instruction === undefined && normalized === block.text) {
        mixedProjectionPieces = reconstructed.pieces;
      }
    }
  } else {
    const prompt = buildTranslationPrompt(targetLanguage, [protectedBlock]);
    const providerResult = patternOnly
      ? { translations: [{ id: block.id, translated: protectedSource.text }] }
      : await provider.translate({
          targetLanguage,
          blocks: [protectedBlock],
          systemPrompt: prompt.system,
          userPrompt: prompt.user,
        });
    const idDiagnostics = validateReturnedBlockIds(
      [block],
      providerResult.translations,
    );
    const matches = providerResult.translations.filter(
      ({ id }) => id === block.id,
    );
    const modelTranslation = matches[0]?.translated;
    const restoration =
      modelTranslation === undefined
        ? undefined
        : restoreImmutablePattern(
            modelTranslation,
            protectedSource,
            targetLanguage,
          );
    restored = restoration
      ? restoreLeadingInstruction(instruction, restoration.text)
      : undefined;
    const unexpectedIdErrors = [...idDiagnostics.entries()]
      .filter(([id]) => id !== block.id)
      .flatMap(([, diagnostics]) => diagnostics);
    structuralErrors = [
      ...(idDiagnostics.get(block.id) ?? []),
      ...unexpectedIdErrors,
      ...(restoration?.errors ?? []),
    ];
  }
  const validation = validateTranslation(block.text, restored, targetLanguage, {
    notationCaseInsensitive: true,
    contentKind,
  });
  const errors = annotateSegment(segmentIndex, [
    ...structuralErrors,
    ...validation.errors,
  ]);
  const translated =
    structuralErrors.length === 0
      ? normalizeTranslationStyle(block.text, restored ?? "", targetLanguage)
      : (restored ?? "");
  return {
    translated,
    errors,
    warnings: annotateSegment(segmentIndex, validation.warnings),
    formattingPieces:
      mixedProjectionPieces && translated === restored
        ? mixedProjectionPieces
        : undefined,
  };
};

const translateFormattingUnits = async (
  block: TranslationBlock,
  targetLanguage: TargetLanguage,
  provider: TranslationProvider,
  contentKind: TranslationContentKind = "pattern",
): Promise<TranslationResult | undefined> => {
  const units = buildFormattingTranslationUnits(block);

  if (!units || units.length <= 1) return undefined;

  const translatedUnits: string[] = [];
  const unitErrors: ValidationDiagnostic<ValidationCode>[] = [];
  const unitWarnings: ValidationDiagnostic<WarningCode>[] = [];
  const targetFormattingRegions: NonNullable<
    TranslationResult["targetFormattingRegions"]
  > = [];

  let targetCursor = 0;

  for (const [unitIndex, unit] of units.entries()) {
    if (unit.text.trim().length === 0) {
      translatedUnits.push(unit.text);

      targetFormattingRegions.push({
        id: unit.id,
        start: targetCursor,
        end: targetCursor + unit.text.length,
      });

      targetCursor += unit.text.length;
      continue;
    }

    const leadingWhitespace = unit.text.match(/^\s*/u)?.[0] ?? "";
    const trailingWhitespace = unit.text.match(/\s*$/u)?.[0] ?? "";

    const coreText = unit.text.slice(
      leadingWhitespace.length,
      unit.text.length - trailingWhitespace.length,
    );

    // Canva frequently stores decorative bullets/separators such as "✦"
    // in their own formatting region. In materials mode these contain no
    // translatable language and must never consume a provider call.
    if (
      contentKind === "materials" &&
      !/[\p{L}\p{N}]/u.test(coreText)
    ) {
      const translatedUnit =
        leadingWhitespace + coreText + trailingWhitespace;

      translatedUnits.push(translatedUnit);

      targetFormattingRegions.push({
        id: unit.id,
        start: targetCursor,
        end: targetCursor + translatedUnit.length,
      });

      targetCursor += translatedUnit.length;
      continue;
    }

    const segments = segmentTranslationBlock(coreText);
    const translatedSegments: string[] = [];

    for (const segment of segments) {
      if (!isSegmentWithinLimits(segment.text)) {
        unitErrors.push({
          code: "UNSAFE_SEGMENTATION_BOUNDARY",
          message:
            `Formatting region ${unitIndex + 1}, segment ${segment.index + 1}: ` +
            "No safe structural boundary was available within the configured translation limits.",
        });
        translatedSegments.push("");
        continue;
      }

      const result = await translateSegment(
        {
          id: `${block.id}::format:${unitIndex}::segment:${segment.index}`,
          text: segment.text,
        },
        segment.index,
        targetLanguage,
        provider,
        contentKind,
      );

      translatedSegments.push(result.translated);
      unitErrors.push(...result.errors);
      unitWarnings.push(...result.warnings);
    }

    const translatedCore = reconstructSegments(segments, translatedSegments);

    const translatedUnit =
      leadingWhitespace + translatedCore + trailingWhitespace;

    translatedUnits.push(translatedUnit);

    targetFormattingRegions.push({
      id: unit.id,
      start: targetCursor,
      end: targetCursor + translatedUnit.length,
    });

    targetCursor += translatedUnit.length;
  }

  const translated = translatedUnits.join("");

  const fullValidation = validateTranslation(
    block.text,
    translated,
    targetLanguage,
    {
        notationCaseInsensitive: true,
        contentKind,
      },
  );

  const errors = uniqueDiagnostics([...unitErrors, ...fullValidation.errors]);

  const warnings = uniqueDiagnostics([
    ...unitWarnings,
    ...fullValidation.warnings,
  ]);

  return {
    id: block.id,
    source: block.text,
    translated,
    valid: errors.length === 0,
    errors,
    warnings,
    targetFormattingRegions,
  };
};

export const translateBlocks = async (
  blocks: readonly TranslationBlock[],
  targetLanguage: TargetLanguage,
  options: TranslatorOptions = {},
): Promise<TranslationResult[]> => {
  const provider = options.provider ?? createTranslationProvider();
  const contentKind = options.contentKind ?? "pattern";
  const results: TranslationResult[] = [];

  for (const block of blocks) {
    const formattedResult = await translateFormattingUnits(
      block,
      targetLanguage,
      provider,
      contentKind,
    );

    if (formattedResult) {
      results.push(formattedResult);
      continue;
    }

    const segments = segmentTranslationBlock(block.text);
    const translatedSegments: string[] = [];
    const segmentErrors: ValidationDiagnostic<ValidationCode>[] = [];
    const segmentWarnings: ValidationDiagnostic<WarningCode>[] = [];
    let singleSegmentFormattingPieces:
      | ReturnType<typeof reconstructMixedSegmentWithProjection>["pieces"]
      | undefined;

    for (const segment of segments) {
      if (!isSegmentWithinLimits(segment.text)) {
        segmentErrors.push({
          code: "UNSAFE_SEGMENTATION_BOUNDARY",
          message: `Segment ${segment.index + 1}: No safe structural boundary was available within the configured translation limits.`,
        });
        translatedSegments.push("");
        continue;
      }
      const result = await translateSegment(
        {
          id:
            segments.length === 1
              ? block.id
              : `${block.id}::segment:${segment.index}`,
          text: segment.text,
        },
        segment.index,
        targetLanguage,
        provider,
        contentKind,
      );
      translatedSegments.push(result.translated);
      segmentErrors.push(...result.errors);
      segmentWarnings.push(...result.warnings);

      if (segments.length === 1) {
        singleSegmentFormattingPieces = result.formattingPieces;
      }
    }

    const translated = reconstructSegments(segments, translatedSegments);
    const fullValidation = validateTranslation(
      block.text,
      translated,
      targetLanguage,
      {
        notationCaseInsensitive: true,
        contentKind,
      },
    );
    const errors = uniqueDiagnostics([
      ...segmentErrors,
      ...fullValidation.errors,
    ]);
    const warnings = uniqueDiagnostics([
      ...segmentWarnings,
      ...fullValidation.warnings,
    ]);
    results.push({
      id: block.id,
      source: block.text,
      translated,
      valid: errors.length === 0,
      errors,
      warnings,
      targetFormattingRegions: singleSegmentFormattingPieces
        ? projectFormattingRegionsFromPieces(
            block.formattingRegions,
            singleSegmentFormattingPieces,
          )
        : projectDeterministicFormattingRegions(block, targetLanguage),
    });
  }

  return results;
};
