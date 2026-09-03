import {
  getTargetNotation,
  NATURAL_LANGUAGE_GLOSSARY,
  type CrochetNotationEntry,
} from "./glossary.js";
import { tokenizeSourceNotation } from "./notation/tokenizer.js";
import { validateTargetLanguageFluency } from "./natural_language/fluency.js";
import { validateSemanticAnchors } from "./natural_language/semantic_anchors.js";
import { findHighRiskInstructionConcepts } from "./review_risk.js";
import { getLeadingInstructionMarker } from "./instruction_marker.js";
import type {
  BlockValidation,
  TargetLanguage,
  TranslationBlock,
  ValidationCode,
  ValidationDiagnostic,
  WarningCode,
} from "./types.js";

type ReturnedTranslation = { id: string; translated: string };

const collectMatches = (text: string, pattern: RegExp): string[] =>
  [...text.matchAll(pattern)].map((match) => match[0]);

const normalizedMatches = (text: string, pattern: RegExp): string[] =>
  collectMatches(text, pattern).map((value) =>
    value.toLocaleLowerCase("tr-TR").replaceAll(/\s+/g, ""),
  );

const sameSequence = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const countToken = (
  text: string,
  token: string,
  caseInsensitive: boolean,
): number => {
  const pattern = new RegExp(
    `(?<![\\p{L}-])${escapeRegExp(token)}(?![\\p{L}-])`,
    caseInsensitive ? "giu" : "gu",
  );
  return collectMatches(text, pattern).length;
};

const containsSourceGlossaryTerm = (text: string, term: string): boolean => {
  // Turkish “ip” (yarn) may appear as “ipi”, but must not match inside verbs
  // such as “çekip”. Other configured terms intentionally match inflections.
  if (term === "ip") return /(?<!\p{L})ipi?(?!\p{L})/iu.test(text);
  return text.includes(term);
};

const error = (
  code: ValidationCode,
  message: string,
): ValidationDiagnostic<ValidationCode> => ({ code, message });

const warning = (
  code: WarningCode,
  message: string,
): ValidationDiagnostic<WarningCode> => ({ code, message });

export const validateTranslation = (
  source: string,
  translated: string | undefined,
  targetLanguage: TargetLanguage,
  options: {
    notationCaseInsensitive?: boolean;
    contentKind?: "pattern" | "materials";
  } = {},
): BlockValidation => {
  const errors: ValidationDiagnostic<ValidationCode>[] = [];
  const warnings: ValidationDiagnostic<WarningCode>[] = [];

  if (translated === undefined) {
    errors.push(
      error(
        "MISSING_TRANSLATION",
        "No translation was returned for this block.",
      ),
    );
    return { valid: false, errors, warnings };
  }

  if (translated.trim().length === 0) {
    errors.push(
      error("EMPTY_TRANSLATION", "The returned translation is empty."),
    );
    return { valid: false, errors, warnings };
  }

  const sourceNumbers = normalizedMatches(source, /\d+(?:[.,]\d+)?/gu);
  const translatedNumbers = normalizedMatches(translated, /\d+(?:[.,]\d+)?/gu);
  if (!sameSequence(sourceNumbers, translatedNumbers)) {
    errors.push(
      error(
        "NUMBER_MISMATCH",
        `Numeric values changed: expected [${sourceNumbers.join(", ")}], received [${translatedNumbers.join(", ")}].`,
      ),
    );
  }

  if (options.contentKind === "materials") {
    const sourceLength = source.trim().length;
    const translatedLength = translated.trim().length;

    if (sourceLength >= 20 && translatedLength < sourceLength * 0.35) {
      warnings.push(
        warning(
          "SUSPICIOUSLY_SHORT_TRANSLATION",
          "The translation is unusually short compared with the source.",
        ),
      );
    }

    if (sourceLength > 0 && translatedLength > sourceLength * 3) {
      warnings.push(
        warning(
          "UNUSUALLY_LARGE_EXPANSION",
          "The translation is unusually long compared with the source.",
        ),
      );
    }

    warnings.push(...validateTargetLanguageFluency(translated, targetLanguage));

    return { valid: errors.length === 0, errors, warnings };
  }

  const repetitionPattern = /\bx\s+\d+\b/giu;
  const sourceRepetitions = normalizedMatches(source, repetitionPattern);
  const translatedRepetitions = normalizedMatches(
    translated,
    repetitionPattern,
  );
  if (!sameSequence(sourceRepetitions, translatedRepetitions)) {
    errors.push(
      error(
        "REPETITION_COUNT_MISMATCH",
        `Repetition notation changed: expected [${sourceRepetitions.join(", ")}], received [${translatedRepetitions.join(", ")}].`,
      ),
    );
  }

  const notationOccurrences = tokenizeSourceNotation(source);
  const occurrencesByConcept = new Map<
    string,
    { entry: CrochetNotationEntry }[]
  >();
  for (const occurrence of notationOccurrences) {
    const existing = occurrencesByConcept.get(occurrence.entry.concept) ?? [];
    existing.push(occurrence);
    occurrencesByConcept.set(occurrence.entry.concept, existing);
  }

  for (const occurrences of occurrencesByConcept.values()) {
    const entry = occurrences[0]?.entry;
    if (!entry) continue;

    const target = getTargetNotation(entry, targetLanguage);
    if (!target) {
      errors.push(
        error(
          "MISSING_TARGET_NOTATION_MAPPING",
          `No ${targetLanguage} notation mapping is configured for Turkish “${entry.tr.abbreviation}” (${entry.concept}).`,
        ),
      );
      continue;
    }

    const actualCount = countToken(
      translated,
      target.abbreviation,
      options.notationCaseInsensitive === true,
    );
    if (actualCount !== occurrences.length) {
      errors.push(
        error(
          "LOST_PATTERN_NOTATION",
          `Notation conversion mismatch for “${entry.tr.abbreviation}”: expected ${occurrences.length} occurrence(s) of “${target.abbreviation}”, received ${actualCount}.`,
        ),
      );
    }
  }

  const sourceLeadingMarker = getLeadingInstructionMarker(source);
  const translatedLeadingMarker = getLeadingInstructionMarker(translated);
  if (sourceLeadingMarker && sourceLeadingMarker !== translatedLeadingMarker) {
    errors.push(
      error(
        "LOST_PATTERN_NOTATION",
        `Leading instruction marker changed: expected “${sourceLeadingMarker}”.`,
      ),
    );
  }

  const sourceParentheses = collectMatches(source, /[()]/gu);
  const translatedParentheses = collectMatches(translated, /[()]/gu);
  if (!sameSequence(sourceParentheses, translatedParentheses)) {
    errors.push(
      error(
        "PARENTHESES_MISMATCH",
        "Parentheses were added, removed, or reordered.",
      ),
    );
  }

  const sourceLength = source.trim().length;
  const translatedLength = translated.trim().length;
  if (sourceLength >= 20 && translatedLength < sourceLength * 0.35) {
    warnings.push(
      warning(
        "SUSPICIOUSLY_SHORT_TRANSLATION",
        "The translation is unusually short compared with the source.",
      ),
    );
  }
  if (sourceLength > 0 && translatedLength > sourceLength * 3) {
    warnings.push(
      warning(
        "UNUSUALLY_LARGE_EXPANSION",
        "The translation is unusually long compared with the source.",
      ),
    );
  }

  const sourceLower = source.toLocaleLowerCase("tr-TR");
  const translatedLower = translated.toLocaleLowerCase(
    targetLanguage === "es" ? "es" : "en",
  );
  for (const entry of NATURAL_LANGUAGE_GLOSSARY) {
    if (
      containsSourceGlossaryTerm(sourceLower, entry.turkish) &&
      !entry[targetLanguage].some((term) =>
        translatedLower.includes(term.toLocaleLowerCase()),
      )
    ) {
      warnings.push(
        warning(
          "POSSIBLE_GLOSSARY_MISMATCH",
          `Expected terminology related to “${entry.turkish}” was not found.`,
        ),
      );
    }
  }

  const semanticAnchors = validateSemanticAnchors(
    source,
    translated,
    targetLanguage,
  );
  errors.push(...semanticAnchors.errors);
  warnings.push(...semanticAnchors.warnings);
  warnings.push(...validateTargetLanguageFluency(translated, targetLanguage));

  const highRiskConcepts = findHighRiskInstructionConcepts(source);
  if (highRiskConcepts.length >= 2) {
    warnings.push(
      warning(
        "MANUAL_REVIEW_RECOMMENDED",
        `Manual review recommended because the source combines spatial or directional concepts: ${highRiskConcepts.join(", ")}.`,
      ),
    );
  }

  return { valid: errors.length === 0, errors, warnings };
};

export const validateReturnedBlockIds = (
  sourceBlocks: readonly TranslationBlock[],
  returned: readonly ReturnedTranslation[],
): Map<string, ValidationDiagnostic<ValidationCode>[]> => {
  const diagnostics = new Map<string, ValidationDiagnostic<ValidationCode>[]>();
  const expectedIds = new Set(sourceBlocks.map((block) => block.id));
  const returnedCounts = new Map<string, number>();

  for (const item of returned) {
    returnedCounts.set(item.id, (returnedCounts.get(item.id) ?? 0) + 1);
    if (!expectedIds.has(item.id)) {
      diagnostics.set(item.id, [
        error(
          "UNEXPECTED_RETURNED_BLOCK_ID",
          `Unexpected returned block ID: ${item.id}.`,
        ),
      ]);
    }
  }

  for (const block of sourceBlocks) {
    const count = returnedCounts.get(block.id) ?? 0;
    const blockDiagnostics: ValidationDiagnostic<ValidationCode>[] = [];
    if (count === 0) {
      blockDiagnostics.push(
        error(
          "MISSING_RETURNED_BLOCK_ID",
          `No result was returned for block ID: ${block.id}.`,
        ),
      );
    } else if (count > 1) {
      blockDiagnostics.push(
        error(
          "DUPLICATE_RETURNED_BLOCK_ID",
          `Block ID ${block.id} was returned ${count} times.`,
        ),
      );
    }
    if (blockDiagnostics.length > 0)
      diagnostics.set(block.id, blockDiagnostics);
  }

  return diagnostics;
};
