import { PROJECT_NOTATION } from "../glossary.js";
import type { SourceNotationOccurrence } from "./types.js";

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SOURCE_NOTATION_ALIASES = new Map<string, string>([
  ["cc", "CC"],
  ["Flo", "FLO"],
  ["flo", "FLO"],
  ["Blo", "BLO"],
  ["blo", "BLO"],
]);

const sourceNotationForms = [
  ...PROJECT_NOTATION.map((entry) => entry.tr.abbreviation),
  ...SOURCE_NOTATION_ALIASES.keys(),
];

const notationPattern = new RegExp(
  `(?<!\\p{L})(?:${sourceNotationForms
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|")})(?!\\p{L})`,
  "giu",
);

const isNonNotationX = (text: string, index: number): boolean => {
  const after = text.slice(index + 1);

  // An isolated “x” followed by a number is multiplication syntax.
  if (!/\d/u.test(text[index - 1] ?? "") && /^\s+\d/u.test(after)) {
    return true;
  }

  // These supplied natural-language contexts use number+x as length/spacing
  // shorthand rather than the project's single-crochet token.
  return /^(?:\s+(?:üzerinden|uzunluğunda|kalacak\s+şekilde|sayıyoruz)|\s*[’']\s*in\s+üzerinden)\b/iu.test(
    after,
  );
};

export const tokenizeSourceNotation = (
  text: string,
): SourceNotationOccurrence[] => {
  const byAbbreviation = new Map(
    PROJECT_NOTATION.map((entry) => [
      entry.tr.abbreviation.toLocaleLowerCase("tr-TR"),
      entry,
    ]),
  );

  for (const [alias, canonical] of SOURCE_NOTATION_ALIASES) {
    const entry = byAbbreviation.get(
      canonical.toLocaleLowerCase("tr-TR"),
    );
    if (entry) {
      byAbbreviation.set(
        alias.toLocaleLowerCase("tr-TR"),
        entry,
      );
    }
  }

  return [...text.matchAll(notationPattern)].flatMap((match) => {
    const abbreviation = match[0];
    const start = match.index;
    const entry = byAbbreviation.get(
      abbreviation.toLocaleLowerCase("tr-TR"),
    );
    if (!entry || start === undefined) return [];

    if (
      abbreviation.toLocaleLowerCase("tr-TR") === "x" &&
      isNonNotationX(text, start)
    ) {
      return [];
    }

    if (entry.tr.abbreviation === "M" && abbreviation !== "M") {
      return [];
    }

    return [{ entry, start, end: start + abbreviation.length }];
  });
};
