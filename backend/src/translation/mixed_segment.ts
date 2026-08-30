import { getTargetNotation } from "./glossary.js";
import { extractLeadingInstruction } from "./instruction_marker.js";
import {
  isPatternOnlyProtectedText,
  protectImmutablePattern,
  type ProtectedToken,
} from "./notation/immutable.js";
import type { TargetLanguage, TranslationBlock } from "./types.js";

export type SegmentClassification =
  | "pattern_only"
  | "natural_language_only"
  | "mixed";

type UnpositionedMixedSegmentToken =
  | { kind: "notation"; source: string; target: string }
  | { kind: "number"; text: string }
  | { kind: "instruction_marker"; text: string }
  | { kind: "structure"; text: string }
  | { kind: "whitespace"; text: string }
  | { kind: "natural_language"; id: string; text: string };

export type MixedSegmentToken = UnpositionedMixedSegmentToken & {
  start: number;
  end: number;
  sourceText: string;
};

export type LexedMixedSegment = {
  classification: SegmentClassification;
  tokens: MixedSegmentToken[];
  spans: TranslationBlock[];
  valid: boolean;
  errors: string[];
};

const placeholderPattern = /__XQ[A-Z]{4}QX__/gu;
const structuralCharacter = /[()[\]{},=*:;+\-/–—✦•]/u;

const immutableToken = (
  token: ProtectedToken,
  targetLanguage: TargetLanguage,
): UnpositionedMixedSegmentToken => {
  if (token.kind === "notation") {
    return {
      kind: "notation",
      source: token.source,
      target:
        getTargetNotation(token.entry, targetLanguage)?.abbreviation ??
        token.entry.tr.abbreviation,
    };
  }
  return token.kind === "number"
    ? { kind: "number", text: token.source }
    : { kind: "structure", text: token.source };
};

const lexUnprotected = (text: string): UnpositionedMixedSegmentToken[] => {
  const tokens: UnpositionedMixedSegmentToken[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const character = text[cursor] ?? "";
    if (/\s/u.test(character)) {
      let end = cursor + 1;
      while (end < text.length && /\s/u.test(text[end] ?? "")) end += 1;
      tokens.push({ kind: "whitespace", text: text.slice(cursor, end) });
      cursor = end;
      continue;
    }
    if (structuralCharacter.test(character)) {
      tokens.push({ kind: "structure", text: character });
      cursor += 1;
      continue;
    }
    let end = cursor + 1;
    while (
      end < text.length &&
      !/\s/u.test(text[end] ?? "") &&
      !structuralCharacter.test(text[end] ?? "")
    )
      end += 1;
    tokens.push({
      kind: "natural_language",
      id: "",
      text: text.slice(cursor, end),
    });
    cursor = end;
  }
  return tokens;
};

// Whitespace at an immutable boundary stays independent. Whitespace between
// adjacent prose words belongs to one coherent provider span.
const groupNaturalLanguage = (
  tokens: readonly UnpositionedMixedSegmentToken[],
): UnpositionedMixedSegmentToken[] => {
  const grouped: UnpositionedMixedSegmentToken[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    if (current?.kind !== "natural_language") {
      if (current) grouped.push(current);
      continue;
    }
    let text = current.text;
    let end = index;
    while (true) {
      const whitespace = tokens[end + 1];
      const nextNatural = tokens[end + 2];
      if (
        whitespace?.kind !== "whitespace" ||
        nextNatural?.kind !== "natural_language"
      )
        break;
      text += whitespace.text;
      text += nextNatural.text;
      end += 2;
    }
    grouped.push({ kind: "natural_language", id: "", text });
    index = end;
  }
  return grouped;
};

const classifyRepetitionOperators = (
  tokens: readonly UnpositionedMixedSegmentToken[],
): UnpositionedMixedSegmentToken[] =>
  tokens.map((token, index) => {
    if (token.kind !== "natural_language" || token.text.toLowerCase() !== "x")
      return token;
    const next = tokens
      .slice(index + 1)
      .find(({ kind }) => kind !== "whitespace");
    return next?.kind === "number"
      ? { kind: "structure", text: token.text }
      : token;
  });

const tokenSourceText = (token: UnpositionedMixedSegmentToken): string =>
  token.kind === "notation" ? token.source : token.text;

const positionTokens = (
  source: string,
  tokens: readonly UnpositionedMixedSegmentToken[],
): { tokens: MixedSegmentToken[]; errors: string[] } => {
  let cursor = 0;
  const errors: string[] = [];
  const positioned = tokens.map((token) => {
    const sourceText = tokenSourceText(token);
    const start = cursor;
    const end = start + sourceText.length;
    if (source.slice(start, end) !== sourceText)
      errors.push(`Mixed lexer source coverage differs at offset ${start}.`);
    cursor = end;
    return { ...token, start, end, sourceText };
  });
  if (cursor !== source.length)
    errors.push(
      `Mixed lexer covered ${cursor} of ${source.length} source characters.`,
    );
  for (let index = 0; index < positioned.length; index += 1) {
    const token = positioned[index];
    const previous = positioned[index - 1];
    if (
      !token ||
      token.start !== (previous?.end ?? 0) ||
      token.end < token.start
    )
      errors.push(`Mixed lexer has a gap or overlap at token ${index + 1}.`);
  }
  return { tokens: positioned, errors: [...new Set(errors)] };
};

export const reconstructMixedSource = (
  tokens: readonly MixedSegmentToken[],
): string => tokens.map(({ sourceText }) => sourceText).join("");

export const validateMixedProseSpans = (
  spans: readonly TranslationBlock[],
): string[] =>
  spans.flatMap((span, index) => {
    const immutable = protectImmutablePattern(span.text).tokens.length > 0;
    const instruction = extractLeadingInstruction(span.text) !== undefined;
    const patternStructure = /[()=*]|(?<=\d)-(?=\d)|\bx\s+\d+\b/iu.test(
      span.text,
    );
    return immutable || instruction || patternStructure
      ? [`Text span ${index + 1} contains immutable pattern content.`]
      : [];
  });

export const normalizeMixedProseTranslation = (translated: string): string =>
  translated
    // Numeric rendering has exactly one owner: deterministic mixed
    // reconstruction. A provider may echo a value despite never receiving it.
    .replace(/\d+(?:[.,]\d+)?/gu, "")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/^\s+|\s+$/gu, "");

export const classifySegment = (source: string): SegmentClassification => {
  const protectedSource = protectImmutablePattern(source);
  if (isPatternOnlyProtectedText(protectedSource)) return "pattern_only";
  return protectedSource.tokens.length === 0
    ? "natural_language_only"
    : "mixed";
};

export const lexMixedSegment = (
  source: string,
  targetLanguage: TargetLanguage,
  idPrefix: string,
): LexedMixedSegment => {
  const protectedSource = protectImmutablePattern(source);
  if (isPatternOnlyProtectedText(protectedSource))
    return {
      classification: "pattern_only",
      tokens: [],
      spans: [],
      valid: true,
      errors: [],
    };
  if (protectedSource.tokens.length === 0)
    return {
      classification: "natural_language_only",
      tokens: [],
      spans: [],
      valid: true,
      errors: [],
    };

  const byPlaceholder = new Map(
    protectedSource.tokens.map((token) => [token.placeholder, token]),
  );
  const tokens: UnpositionedMixedSegmentToken[] = [];
  let cursor = 0;
  for (const match of protectedSource.text.matchAll(placeholderPattern)) {
    const start = match.index;
    if (start === undefined) continue;
    tokens.push(...lexUnprotected(protectedSource.text.slice(cursor, start)));
    const protectedToken = byPlaceholder.get(match[0]);
    if (protectedToken)
      tokens.push(immutableToken(protectedToken, targetLanguage));
    cursor = start + match[0].length;
  }
  tokens.push(...lexUnprotected(protectedSource.text.slice(cursor)));

  let spanIndex = 0;
  const identified = groupNaturalLanguage(
    classifyRepetitionOperators(tokens),
  ).map((token) => {
    if (token.kind !== "natural_language") return token;
    const id = `${idPrefix}::text-span:${spanIndex}`;
    spanIndex += 1;
    return { ...token, id };
  });
  const positioned = positionTokens(source, identified);
  const spans = positioned.tokens.flatMap((token) =>
    token.kind === "natural_language"
      ? [{ id: token.id, text: token.text }]
      : [],
  );
  const errors = [
    ...positioned.errors,
    ...(reconstructMixedSource(positioned.tokens) === source
      ? []
      : ["Mixed lexer source round-trip failed."]),
    ...validateMixedProseSpans(spans),
  ];
  return {
    classification: "mixed",
    tokens: positioned.tokens,
    spans,
    valid: errors.length === 0,
    errors,
  };
};

export type MixedSegmentProjectionPiece = {
  kind: MixedSegmentToken["kind"];
  sourceStart: number;
  sourceEnd: number;
  targetStart: number;
  targetEnd: number;
};

export type ReconstructedMixedSegment = {
  text: string;
  pieces: MixedSegmentProjectionPiece[];
};

const renderMixedToken = (
  token: MixedSegmentToken,
  translations: ReadonlyMap<string, string>,
): string => {
  if (token.kind === "notation") return token.target;
  if (token.kind === "natural_language")
    return translations.get(token.id)?.trim() ?? "";
  return token.text;
};

export const reconstructMixedSegmentWithProjection = (
  tokens: readonly MixedSegmentToken[],
  translations: ReadonlyMap<string, string>,
): ReconstructedMixedSegment => {
  const pieces: MixedSegmentProjectionPiece[] = [];
  const rendered: string[] = [];
  let targetCursor = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const previous = tokens[index - 1];

    let targetText = renderMixedToken(token, translations);

    if (
      previous?.kind === "notation" &&
      token.kind === "natural_language" &&
      /\p{L}$/u.test(renderMixedToken(previous, translations)) &&
      /^\p{L}/u.test(targetText)
    ) {
      targetText = ` ${targetText}`;
    }

    pieces.push({
      kind: token.kind,
      sourceStart: token.start,
      sourceEnd: token.end,
      targetStart: targetCursor,
      targetEnd: targetCursor + targetText.length,
    });

    rendered.push(targetText);
    targetCursor += targetText.length;
  }

  return {
    text: rendered.join(""),
    pieces,
  };
};

export const reconstructMixedSegment = (
  tokens: readonly MixedSegmentToken[],
  translations: ReadonlyMap<string, string>,
): string => reconstructMixedSegmentWithProjection(tokens, translations).text;
