import { tokenizeSourceNotation } from "./tokenizer.js";
import type { ProtectedNotationText } from "./types.js";

const placeholderFor = (index: number): string => {
  let remaining = index;
  let encoded = "";
  for (let position = 0; position < 4; position += 1) {
    encoded = String.fromCharCode(65 + (remaining % 26)) + encoded;
    remaining = Math.floor(remaining / 26);
  }
  if (remaining > 0) throw new Error("Too many notation tokens in one block.");
  return `__XQ${encoded}QX__`;
};

export const protectNotation = (
  source: string,
  startIndex = 0,
): ProtectedNotationText => {
  const occurrences = tokenizeSourceNotation(source);
  const tokens = occurrences.map((occurrence, index) => ({
    placeholder: placeholderFor(startIndex + index),
    entry: occurrence.entry,
  }));

  let cursor = 0;
  let text = "";
  occurrences.forEach((occurrence, index) => {
    text += source.slice(cursor, occurrence.start);
    text += tokens[index]?.placeholder ?? "";
    cursor = occurrence.end;
  });
  text += source.slice(cursor);

  return { text, tokens };
};
