import { extractRoundReferences, renderRoundReference, validateRoundReferences, type RoundReference } from "../natural_language/round_references.js";
import { extractMeasurements, renderMeasurement, validateMeasurementIntegrity } from "../measurements.js";
import { getTargetNotation } from "../glossary.js";
import type { TargetLanguage } from "../types.js";
import { tokenizeSourceNotation } from "./tokenizer.js";
import type {
  NotationRestoration,
  PlaceholderIntegrityDiagnostic,
} from "./types.js";

export type ProtectedToken =
  | {
      kind: "notation";
      placeholder: string;
      entry: ReturnType<typeof tokenizeSourceNotation>[number]["entry"];
      source: string;
    }
  | ({ kind: "round_reference"; placeholder: string } & RoundReference)
  | { kind: "measurement"; placeholder: string; source: string; value: string; unit: string }
  | { kind: "number"; placeholder: string; source: string }
  | { kind: "structure"; placeholder: string; source: string };

export type ProtectedImmutableText = {
  text: string;
  tokens: ProtectedToken[];
};

type Occurrence = {
  start: number;
  end: number;
  token:
    | {
        kind: "notation";
        entry: ReturnType<typeof tokenizeSourceNotation>[number]["entry"];
        source: string;
      }
    | ({ kind: "round_reference" } & RoundReference)
    | { kind: "measurement"; source: string; value: string; unit: string }
    | { kind: "number"; source: string }
    | { kind: "structure"; source: string };
};

const exactPlaceholderPattern = /__XQ[A-Z]{4}QX__/gu;
const placeholderCandidatePattern = /__XQ[^\s]*?QX__/gu;

export const containsReservedPlaceholder = (text: string): boolean =>
  /__XQ[^\s]*?QX__/u.test(text);

/** Every exact reserved placeholder in `text`, in order of appearance. */
export const reservedPlaceholdersIn = (text: string): string[] =>
  [...text.matchAll(exactPlaceholderPattern)].map((match) => match[0]);

/**
 * The canonical reserved placeholder for a 0-based token index:
 * `__XQ` + four base-26 letters + `QX__`. Shared by every layer that hides
 * text from the provider, so there is exactly one placeholder grammar.
 */
export const reservedPlaceholder = (index: number): string => {
  let remaining = index;
  let encoded = "";
  for (let position = 0; position < 4; position += 1) {
    encoded = String.fromCharCode(65 + (remaining % 26)) + encoded;
    remaining = Math.floor(remaining / 26);
  }
  if (remaining > 0) throw new Error("Too many immutable tokens in one block.");
  return `__XQ${encoded}QX__`;
};

const diagnostic = (
  code: PlaceholderIntegrityDiagnostic["code"],
  message: string,
): PlaceholderIntegrityDiagnostic => ({ code, message });

export const protectImmutablePattern = (
  source: string,
  startIndex = 0,
  profile: "pattern" | "materials" = "pattern",
): ProtectedImmutableText => {
  const measurements = extractMeasurements(source);
  const rounds = profile === "pattern" ? extractRoundReferences(source) : [];
  const notation =
    profile === "pattern" ? tokenizeSourceNotation(source) : [];
  const occurrences: Occurrence[] = notation.map(({ entry, start, end }) => ({
    start,
    end,
    token: {
      kind: "notation",
      entry,
      source: source.slice(start, end),
    },
  }));

  occurrences.push(...rounds.map((reference) => ({
    start: reference.start, end: reference.end,
    token: { kind: "round_reference" as const, ...reference },
  })));
  occurrences.push(...measurements.map(({ start, end, source, value, unit }) => ({
    start, end, token: { kind: "measurement" as const, source, value, unit },
  })));

  for (const match of source.matchAll(/\d+(?:[.,]\d+)?/gu)) {
    if (match.index === undefined) continue;
    occurrences.push({
      start: match.index,
      end: match.index + match[0].length,
      token: { kind: "number", source: match[0] },
    });
  }

  if (profile === "materials") {
    for (const match of source.matchAll(/\b[A-Za-z]{1,6}\d{2,}\b/gu)) {
      if (match.index === undefined) continue;
      occurrences.push({
        start: match.index,
        end: match.index + match[0].length,
        token: { kind: "structure", source: match[0] },
      });
    }
  }

  if (profile === "pattern") {
    const structuralPattern =
      notation.length > 0
        ? /[()=*,]|(?<=\d)-(?=\d)/gu
        : /[()=*]|(?<=\d)-(?=\d)/gu;

    for (const match of source.matchAll(structuralPattern)) {
      if (match.index === undefined) continue;
      occurrences.push({
        start: match.index,
        end: match.index + match[0].length,
        token: { kind: "structure", source: match[0] },
      });
    }
  }

  occurrences.sort(
    (left, right) => left.start - right.start || right.end - left.end,
  );
  const nonOverlapping: Occurrence[] = [];
  for (const occurrence of occurrences) {
    if (occurrence.token.kind !== "round_reference" && rounds.some(
      ({ start, end }) => occurrence.start < end && occurrence.end > start,
    )) continue;
    // Measurements take priority over independently recognized numbers/structure.
    if (occurrence.token.kind !== "measurement" && measurements.some(
      ({ start, end }) => occurrence.start < end && occurrence.end > start,
    )) continue;
    if (occurrence.start >= (nonOverlapping.at(-1)?.end ?? 0)) nonOverlapping.push(occurrence);
  }
  const tokens = nonOverlapping.map((occurrence, index) => ({
    ...occurrence.token,
    placeholder: reservedPlaceholder(startIndex + index),
  })) as ProtectedToken[];

  let cursor = 0;
  let text = "";
  nonOverlapping.forEach((occurrence, index) => {
    text += source.slice(cursor, occurrence.start);
    text += tokens[index]?.placeholder ?? "";
    cursor = occurrence.end;
  });
  text += source.slice(cursor);

  return { text, tokens };
};

export const isPatternOnlyProtectedText = (
  protectedSource: ProtectedImmutableText,
): boolean => {
  const withoutRepetitionOperators = protectedSource.text.replace(
    /\bx(?=\s*__XQ[A-Z]{4}QX__)/giu,
    "",
  );
  const withoutTokens = protectedSource.tokens.reduce(
    (text, token) => text.replace(token.placeholder, ""),
    withoutRepetitionOperators,
  );
  return withoutTokens.trim().length === 0;
};

export const renderProtectedToken = (
  token: ProtectedToken,
  targetLanguage: TargetLanguage,
): string | undefined =>
  token.kind === "notation"
    ? getTargetNotation(token.entry, targetLanguage)?.abbreviation
    : token.kind === "measurement"
      ? renderMeasurement(token)
      : token.kind === "round_reference"
        ? renderRoundReference(token, targetLanguage)
        : token.source;

/**
 * Integrity of reserved placeholders in provider output against the expected
 * placeholders, in order. Reports MISSING, DUPLICATE, UNEXPECTED and MUTATED
 * placeholders; REORDERED only when none of those occurred. Empty when the
 * output carries exactly the expected placeholders in the expected order.
 */
export const placeholderIntegrityErrors = (
  translated: string,
  expected: readonly string[],
): PlaceholderIntegrityDiagnostic[] => {
  const errors: PlaceholderIntegrityDiagnostic[] = [];
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
          `Protected immutable token ${placeholder} is missing.`,
        ),
      );
    } else if (count > 1) {
      errors.push(
        diagnostic(
          "DUPLICATE_PROTECTED_NOTATION",
          `Protected immutable token ${placeholder} was returned ${count} times.`,
        ),
      );
    }
  }
  for (const placeholder of exact) {
    if (!expectedSet.has(placeholder)) {
      errors.push(
        diagnostic(
          "UNEXPECTED_PROTECTED_NOTATION",
          `Unexpected protected immutable token ${placeholder} was returned.`,
        ),
      );
    }
  }
  for (const candidate of candidates) {
    if (!exact.includes(candidate)) {
      errors.push(
        diagnostic(
          "MUTATED_PROTECTED_NOTATION",
          `Protected immutable token was mutated: ${candidate}.`,
        ),
      );
    }
  }

  if (
    errors.length === 0 &&
    (exact.length !== expected.length ||
      exact.some((value, index) => value !== expected[index]))
  ) {
    errors.push(
      diagnostic(
        "REORDERED_PROTECTED_NOTATION",
        "Protected immutable tokens were reordered.",
      ),
    );
  }
  return errors;
};

export const restoreImmutablePattern = (
  translated: string,
  protectedSource: ProtectedImmutableText,
  targetLanguage: TargetLanguage,
): NotationRestoration => {
  const errors: PlaceholderIntegrityDiagnostic[] = placeholderIntegrityErrors(
    translated,
    protectedSource.tokens.map(({ placeholder }) => placeholder),
  );
  if (errors.length > 0) return { text: translated, valid: false, errors };

  let restored = translated;
  for (const token of protectedSource.tokens) {
    const replacement = renderProtectedToken(token, targetLanguage);
    if (replacement !== undefined)
      restored = restored.replace(token.placeholder, replacement);
  }
  errors.push(...validateMeasurementIntegrity(
    protectedSource.tokens.filter((token) => token.kind === "measurement"),
    restored,
  ));
  const roundSource = protectedSource.tokens.filter(({ kind }) => kind === "round_reference").map(({ source }) => source).join(" ");
  errors.push(...validateRoundReferences(roundSource, restored, targetLanguage));
  return { text: restored, valid: errors.length === 0, errors };
};
