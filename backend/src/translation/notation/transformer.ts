import { getTargetNotation } from "../glossary.js";
import type { TargetLanguage } from "../types.js";
import type {
  NotationRestoration,
  PlaceholderIntegrityDiagnostic,
  ProtectedNotationText,
} from "./types.js";

const exactPlaceholderPattern = /__XQ[A-Z]{4}QX__/gu;
const placeholderCandidatePattern = /__XQ[^\s]*?QX__/gu;

const diagnostic = (
  code: PlaceholderIntegrityDiagnostic["code"],
  message: string,
): PlaceholderIntegrityDiagnostic => ({ code, message });

const structuralPlaceholderOrderMatters = (
  protectedSource: ProtectedNotationText,
): boolean => {
  let surroundingText = protectedSource.text;
  for (const { placeholder } of protectedSource.tokens) {
    surroundingText = surroundingText.replace(placeholder, "");
  }
  surroundingText = surroundingText.replace(/\bx(?=\s+\d)/giu, "");
  return !/\p{L}/u.test(surroundingText);
};

export const restoreNotation = (
  translated: string,
  protectedSource: ProtectedNotationText,
  targetLanguage: TargetLanguage,
): NotationRestoration => {
  const errors: PlaceholderIntegrityDiagnostic[] = [];
  const expected = protectedSource.tokens.map(({ placeholder }) => placeholder);
  const expectedSet = new Set(expected);
  const exact = [...translated.matchAll(exactPlaceholderPattern)].map(
    (match) => match[0],
  );
  const candidates = [...translated.matchAll(placeholderCandidatePattern)].map(
    (match) => match[0],
  );

  for (const placeholder of expected) {
    const count = exact.filter((value) => value === placeholder).length;
    if (count === 0) {
      errors.push(
        diagnostic(
          "MISSING_PROTECTED_NOTATION",
          `Protected notation token ${placeholder} is missing.`,
        ),
      );
    } else if (count > 1) {
      errors.push(
        diagnostic(
          "DUPLICATE_PROTECTED_NOTATION",
          `Protected notation token ${placeholder} was returned ${count} times.`,
        ),
      );
    }
  }

  for (const placeholder of exact) {
    if (!expectedSet.has(placeholder)) {
      errors.push(
        diagnostic(
          "UNEXPECTED_PROTECTED_NOTATION",
          `Unexpected protected notation token ${placeholder} was returned.`,
        ),
      );
    }
  }

  for (const candidate of candidates) {
    if (!exact.includes(candidate)) {
      errors.push(
        diagnostic(
          "MUTATED_PROTECTED_NOTATION",
          `Protected notation token was mutated: ${candidate}.`,
        ),
      );
    }
  }

  if (
    errors.length === 0 &&
    structuralPlaceholderOrderMatters(protectedSource) &&
    (exact.length !== expected.length ||
      exact.some((value, index) => value !== expected[index]))
  ) {
    errors.push(
      diagnostic(
        "REORDERED_PROTECTED_NOTATION",
        "Protected notation tokens were reordered.",
      ),
    );
  }

  if (errors.length > 0) return { text: translated, valid: false, errors };

  let restored = translated;
  for (const token of protectedSource.tokens) {
    const target = getTargetNotation(token.entry, targetLanguage);
    if (!target) continue;
    restored = restored.replace(token.placeholder, target.abbreviation);
  }

  return { text: restored, valid: true, errors };
};
