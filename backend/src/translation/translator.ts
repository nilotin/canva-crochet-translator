import { extractRoundReferences, renderRoundReference } from "./natural_language/round_references.js";
import { extractSourceMeasurementSpans } from "./measurements.js";
import { extractSourceAtomicNaturalLanguageSpans } from "./natural_language/atomic_spans.js";
import { normalizeSourceNaturalLanguageDetailed } from "./natural_language/normalizer.js";
import { normalizeTranslationStyle } from "./natural_language/style_normalizer.js";
import {
  containsReservedPlaceholder,
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

// Some source constructions are already deterministically resolved by
// `extractSourceAtomicNaturalLanguageSpans` (the same registry that keeps
// these clauses from being bisected by formatting-region segmentation). If
// one such span covers the *entire* segment, the segment needs no further
// translation at all -- routing it through `lexMixedSegment`/provider
// translation anyway would fragment already-resolved target-language text
// into context-free prose spans and hand them back to the provider for a
// pointless (and potentially corrupting) re-translation. Partial coverage
// must not trigger this: unrelated prose sharing a segment with an atomic
// span still needs the provider.
const isFullyCoveredByAtomicSpan = (
  text: string,
  spans: readonly { start: number; end: number }[],
): boolean => {
  const leading = text.length - text.trimStart().length;
  const trimmedEnd = text.trimEnd().length;
  if (trimmedEnd <= leading) return false;
  return spans.some(({ start, end }) => start <= leading && end >= trimmedEnd);
};

// Two placeholder probes used only to test whether `normalizeTranslationStyle`
// derives its output for a given (source, targetLanguage, contentKind)
// entirely from `source` -- i.e. deterministically -- or whether it lets
// its `translated` argument leak through unmodified or partially modified.
// These must never collide with real content, hence the NUL-delimited,
// unmistakably synthetic markers.
const DETERMINISTIC_RESOLUTION_PROBE_A =
  "\u0000__DETERMINISTIC_RESOLUTION_PROBE_A__\u0000";
const DETERMINISTIC_RESOLUTION_PROBE_B =
  "\u0000__DETERMINISTIC_RESOLUTION_PROBE_B__\u0000";

// "Atomic structural coverage" (a span the atomic-span registry says must
// not be bisected by formatting-region segmentation) and "deterministic
// target-language resolution" (the span's target-language text is already
// fully and correctly produced, with nothing left for a provider to
// translate) are different properties. A source construction can be
// structurally atomic in every target language, while a deterministic
// renderer for it may only exist for some target languages -- e.g. the
// nested Round/FLO/BLO attachment family and the bare round-count family
// are both structurally atomic regardless of target language, but
// `normalizeTranslationStyle` currently only carries a deterministic
// renderer for them when translating into English; for other target
// languages it is a passthrough, so the source text would otherwise never
// get translated at all.
//
// Detect the distinction generically -- with no per-language or
// per-fixture special-casing -- by probing whether
// `normalizeTranslationStyle`'s output for this exact
// (source, targetLanguage, contentKind) combination is independent of
// whatever "translated" text it is given. A genuine deterministic renderer
// derives its output entirely from `source` and never lets an arbitrary
// placeholder "translated" value leak into the result; a passthrough (or a
// renderer that only partially covers the source, leaving a "remainder"
// stitched in from `translated`) will let at least one of the two distinct
// probes leak through, so the two probe runs will disagree.
const isDeterministicallyResolvedForTargetLanguage = (
  source: string,
  targetLanguage: TargetLanguage,
  contentKind: TranslationContentKind,
): boolean => {
  const resolvedA = normalizeTranslationStyle(
    source,
    DETERMINISTIC_RESOLUTION_PROBE_A,
    targetLanguage,
    contentKind,
  );
  const resolvedB = normalizeTranslationStyle(
    source,
    DETERMINISTIC_RESOLUTION_PROBE_B,
    targetLanguage,
    contentKind,
  );
  return (
    resolvedA === resolvedB &&
    !resolvedA.includes(DETERMINISTIC_RESOLUTION_PROBE_A) &&
    !resolvedA.includes(DETERMINISTIC_RESOLUTION_PROBE_B)
  );
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
  const normalization = normalizeSourceNaturalLanguageDetailed(
    sourceBody,
    targetLanguage,
    contentKind,
  );
  // Checked against the raw source (before normalization may have already
  // rewritten a recognized clause into target-language text) so the atomic
  // span registry -- which only understands source-language morphology --
  // still recognizes it.
  // Atomic structural coverage alone must never imply it is safe to skip the
  // provider -- only the conjunction with confirmed deterministic
  // target-language resolution (checked below) does.
  const hasAtomicStructuralCoverage =
    contentKind === "pattern" &&
    isFullyCoveredByAtomicSpan(
      sourceBody,
      extractSourceAtomicNaturalLanguageSpans(sourceBody),
    );
  const isFullyAtomicSource =
    hasAtomicStructuralCoverage &&
    isDeterministicallyResolvedForTargetLanguage(
      sourceBody,
      targetLanguage,
      contentKind,
    );
  const skipsProviderTranslation =
    normalization.fullyResolved || isFullyAtomicSource;
  const normalized = normalization.text;
  const protectedSource = protectImmutablePattern(
    normalized,
    0,
    contentKind,
  );
  const protectedBlock = { ...block, text: protectedSource.text };
  const mixed = lexMixedSegment(normalized, targetLanguage, block.id);
  const patternOnly = skipsProviderTranslation ||
    isPatternOnlyProtectedText(protectedSource) || (
    protectedSource.tokens.some(({ kind }) => kind === "round_reference") &&
    mixed.classification === "mixed" && mixed.valid && mixed.spans.length === 0
  );
  let restored: string | undefined;
  let mixedProjectionPieces:
    | ReturnType<typeof reconstructMixedSegmentWithProjection>["pieces"]
    | undefined;
  let structuralErrors: ValidationDiagnostic<ValidationCode>[];

  // Keep a measurement in its sentence context so its atomic placeholder can
  // move with target-language prose instead of freezing it between prose spans.
  const hasMeasurement = protectedSource.tokens.some(({ kind }) => kind === "measurement");
  const roundTokens = protectedSource.tokens.filter(
    (token) => token.kind === "round_reference",
  );
  const hasNonRoundImmutable = protectedSource.tokens.some(
    (token) => token.kind !== "round_reference",
  );

  if (
    contentKind === "pattern" &&
    !skipsProviderTranslation &&
    mixed.classification === "mixed" &&
    !hasMeasurement &&
    (roundTokens.length === 0 || hasNonRoundImmutable)
  ) {
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
    const materialQuantityGrammar =
      contentKind === "materials"
        ? protectedSource.tokens
            .map((token, index) => ({ token, index }))
            .filter(({ token }) =>
              token.kind === "number" &&
              new RegExp(
                `${token.placeholder}\\s*(?:adet|tane|yumak|çile|paket|çift)\\b`,
                "iu",
              ).test(protectedSource.text),
            )
            .map(({ token, index }) => ({
              blockId: block.id,
              protectedTokenIndex: index + 1,
              agreement:
                Number(token.source.replace(",", ".")) === 1
                  ? ("singular" as const)
                  : ("plural" as const),
            }))
        : [];
    const prompt = buildTranslationPrompt(targetLanguage, [protectedBlock], roundTokens.map((token) => ({
      placeholder: token.placeholder, meaning: renderRoundReference(token, targetLanguage),
    })), contentKind, materialQuantityGrammar);
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
    restored =
      restoration?.valid === true
        ? restoreLeadingInstruction(instruction, restoration.text)
        : undefined;
    const unexpectedIdErrors = [...idDiagnostics.entries()]
      .filter(([id]) => id !== block.id)
      .flatMap(([, diagnostics]) => diagnostics);

    const reservedPlaceholderLeak =
      protectedSource.tokens.length === 0 &&
      modelTranslation !== undefined &&
      containsReservedPlaceholder(modelTranslation)
        ? [
            {
              code: "RESERVED_PLACEHOLDER_LEAK" as const,
              message:
                "Internal translation placeholder syntax was found in the output.",
            },
          ]
        : [];

    structuralErrors = [
      ...(idDiagnostics.get(block.id) ?? []),
      ...unexpectedIdErrors,
      ...(reservedPlaceholderLeak.length > 0
        ? reservedPlaceholderLeak
        : (restoration?.errors ?? [])),
    ];
  }
  const normalizedRestored =
    structuralErrors.length === 0 && restored !== undefined
      ? normalizeTranslationStyle(
          block.text,
          restored,
          targetLanguage,
          contentKind,
        )
      : restored;
  const validation =
    structuralErrors.length === 0
      ? validateTranslation(
          block.text,
          normalizedRestored,
          targetLanguage,
          {
            notationCaseInsensitive: true,
            contentKind,
          },
        )
      : {
          valid: false,
          errors: [],
          warnings: [],
        };
  const errors = annotateSegment(segmentIndex, [
    ...structuralErrors,
    ...validation.errors,
  ]);
  const translatedCandidate = normalizedRestored ?? "";
  const translated = containsReservedPlaceholder(translatedCandidate)
    ? ""
    : translatedCandidate;
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

const PERSISTENT_FRAGMENT_ERROR_CODES = new Set<ValidationCode>([
  "DUPLICATE_RETURNED_BLOCK_ID",
  "MISSING_RETURNED_BLOCK_ID",
  "UNEXPECTED_RETURNED_BLOCK_ID",
  "MISSING_PROTECTED_NOTATION",
  "DUPLICATE_PROTECTED_NOTATION",
  "UNEXPECTED_PROTECTED_NOTATION",
  "MUTATED_PROTECTED_NOTATION",
  "REORDERED_PROTECTED_NOTATION",
  "RESERVED_PLACEHOLDER_LEAK",
  "INTERNAL_MIXED_LEXER_ERROR",
  "UNSAFE_SEGMENTATION_BOUNDARY",
]);

const persistentFragmentErrors = (
  diagnostics: readonly ValidationDiagnostic<ValidationCode>[],
): ValidationDiagnostic<ValidationCode>[] =>
  diagnostics.filter(({ code }) =>
    PERSISTENT_FRAGMENT_ERROR_CODES.has(code),
  );

const translateFormattingUnits = async (
  block: TranslationBlock,
  targetLanguage: TargetLanguage,
  provider: TranslationProvider,
  contentKind: TranslationContentKind = "pattern",
): Promise<TranslationResult | undefined> => {
  // Measurements and round references retain the existing whole-block
  // fallback when bisected. Natural-language atomic spans can instead become
  // indivisible, left-owned formatting units without losing their semantics.
  const wholeBlockFallbackSpans = [
    ...extractSourceMeasurementSpans(block.text),
    ...(contentKind === "pattern"
      ? extractRoundReferences(block.text)
      : []),
  ];
  if (block.formattingRegions?.some(({ start, end }) => wholeBlockFallbackSpans.some(
    (span) => (start > span.start && start < span.end) ||
      (end > span.start && end < span.end),
  ))) return undefined;
  const atomicSpans =
    contentKind === "pattern"
      ? extractSourceAtomicNaturalLanguageSpans(block.text)
      : [];
  const units = buildFormattingTranslationUnits(block, atomicSpans);

  if (!units || (block.formattingRegions?.length ?? 0) <= 1) return undefined;

  const translatedUnits: string[] = [];
  const unitErrors: ValidationDiagnostic<ValidationCode>[] = [];
  const unitWarnings: ValidationDiagnostic<WarningCode>[] = [];
  const projectedById = new Map<
    string,
    NonNullable<TranslationResult["targetFormattingRegions"]>[number]
  >();
  let usesAtomicCollapse = false;

  let targetCursor = 0;

  const recordProjectedUnit = (
    unit: (typeof units)[number],
    start: number,
    end: number,
  ) => {
    const existing = projectedById.get(unit.id);
    if (existing) {
      if (existing.end !== start) return false;
      existing.end = end;
    } else {
      projectedById.set(unit.id, { id: unit.id, start, end });
    }

    for (const id of unit.absorbedRegionIds ?? []) {
      if (projectedById.has(id)) return false;
      projectedById.set(id, { id, start: end, end });
    }

    if (unit.collapsesFormatting) usesAtomicCollapse = true;
    return true;
  };

  let formattingProjectionValid = true;

  for (const [unitIndex, unit] of units.entries()) {
    if (unit.text.trim().length === 0) {
      translatedUnits.push(unit.text);

      formattingProjectionValid =
        recordProjectedUnit(
          unit,
          targetCursor,
          targetCursor + unit.text.length,
        ) && formattingProjectionValid;

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

      formattingProjectionValid =
        recordProjectedUnit(
          unit,
          targetCursor,
          targetCursor + translatedUnit.length,
        ) && formattingProjectionValid;

      targetCursor += translatedUnit.length;
      continue;
    }

    const segments = unit.atomic
      ? [{ index: 0, prefix: "", text: coreText, suffix: "" }]
      : segmentTranslationBlock(coreText);
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

    formattingProjectionValid =
      recordProjectedUnit(
        unit,
        targetCursor,
        targetCursor + translatedUnit.length,
      ) && formattingProjectionValid;

    targetCursor += translatedUnit.length;
  }

  const translated = translatedUnits.join("");
  const orderedSourceRegions = [...(block.formattingRegions ?? [])].sort(
    (left, right) => left.start - right.start,
  );
  const targetFormattingRegions = formattingProjectionValid
    ? orderedSourceRegions.map(({ id }) => projectedById.get(id))
    : [];
  const hasCompleteProjection =
    targetFormattingRegions.length === orderedSourceRegions.length &&
    targetFormattingRegions.every(
      (region): region is NonNullable<typeof region> => region !== undefined,
    );

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
    ...persistentFragmentErrors(unitErrors),
    ...fullValidation.errors,
  ]);

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
    ...(hasCompleteProjection ? { targetFormattingRegions } : {}),
    ...(hasCompleteProjection && usesAtomicCollapse
      ? { formattingProjection: "atomic_collapse" as const }
      : {}),
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
      ...persistentFragmentErrors(segmentErrors),
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
