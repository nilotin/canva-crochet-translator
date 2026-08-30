import { tokenizeSourceNotation } from "./notation/tokenizer.js";

export const MAX_SEGMENT_CHARS = 500;
export const MAX_SEGMENT_NOTATION_TOKENS = 10;

export const isSegmentWithinLimits = (text: string) =>
  text.length <= MAX_SEGMENT_CHARS &&
  tokenizeSourceNotation(text).length <= MAX_SEGMENT_NOTATION_TOKENS;

export type TranslationSegment = {
  index: number;
  prefix: string;
  text: string;
  suffix: string;
};

const exceedsLimit = (text: string) => !isSegmentWithinLimits(text);

const boundaries = (source: string, kind: "hard" | "soft") => {
  const result = new Set<number>();
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    if (depth !== 0) continue;

    if (kind === "hard") {
      if (character === "\n") result.add(index);
      if (
        /\s/u.test(character ?? "") &&
        !/\s/u.test(source[index - 1] ?? "") &&
        /^\s+(?=(?:\d+\)|[-•▪◦])\s*)/u.test(source.slice(index))
      ) {
        result.add(index);
      }
      continue;
    }

    if (
      (character === "." || character === "!" || character === "?") &&
      !/\d/u.test(source[index - 1] ?? "") &&
      /^\s/u.test(source[index + 1] ?? "")
    ) {
      result.add(index + 1);
    }
    if (character === ";" || character === ",") result.add(index + 1);
  }
  return [...result].filter((index) => index > 0).sort((a, b) => a - b);
};

const splitAt = (source: string, splitPoints: readonly number[]) => {
  const parts: string[] = [];
  let cursor = 0;
  for (const boundary of splitPoints) {
    if (boundary <= cursor) continue;
    parts.push(source.slice(cursor, boundary));
    cursor = boundary;
  }
  parts.push(source.slice(cursor));
  return parts.filter((part) => part.length > 0);
};

const splitOversized = (source: string) => {
  if (!exceedsLimit(source)) return [source];
  const parts = splitAt(source, boundaries(source, "soft"));
  const groups: string[] = [];
  let current = "";
  for (const part of parts) {
    if (current && exceedsLimit(current + part)) {
      groups.push(current);
      current = part;
    } else {
      current += part;
    }
  }
  if (current) groups.push(current);
  return groups;
};

const withWhitespace = (raw: string, index: number): TranslationSegment => {
  const prefix = raw.match(/^\s*/u)?.[0] ?? "";
  const suffix = raw.match(/\s*$/u)?.[0] ?? "";
  return {
    index,
    prefix,
    text: raw.slice(prefix.length, raw.length - suffix.length),
    suffix,
  };
};

export const segmentTranslationBlock = (
  source: string,
): TranslationSegment[] => {
  if (!exceedsLimit(source)) {
    return [{ index: 0, prefix: "", text: source, suffix: "" }];
  }
  const hardParts = splitAt(source, boundaries(source, "hard"));
  return hardParts
    .flatMap(splitOversized)
    .map(withWhitespace)
    .filter((segment) => segment.text.length > 0)
    .map((segment, index) => ({ ...segment, index }));
};

export const reconstructSegments = (
  segments: readonly TranslationSegment[],
  translated: readonly string[],
) =>
  segments
    .map(
      (segment, index) =>
        `${segment.prefix}${translated[index]?.trim() ?? ""}${segment.suffix}`,
    )
    .join("");
