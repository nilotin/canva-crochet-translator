export const HIGH_RISK_INSTRUCTION_CONCEPTS = [
  "üst",
  "alt",
  "iç",
  "dış",
  "ön",
  "arka",
  "giriş",
  "çıkış",
  "girmek",
  "çıkmak",
  "göz",
  "sıra",
  "karşı",
] as const;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const findHighRiskInstructionConcepts = (source: string): string[] => {
  const normalized = source.toLocaleLowerCase("tr-TR");
  return HIGH_RISK_INSTRUCTION_CONCEPTS.filter((concept) => {
    if (
      concept === "ön" &&
      /(?<!\p{L})önlü[kğ]\p{L}*(?!\p{L})/iu.test(normalized)
    ) {
      const withoutApron = normalized.replace(
        /(?<!\p{L})önlü[kğ]\p{L}*(?!\p{L})/giu,
        "",
      );

      return new RegExp(
        `(?<!\\p{L})${escapeRegExp(concept)}\\p{L}*(?!\\p{L})`,
        "iu",
      ).test(withoutApron);
    }

    if (
      concept === "üst" &&
      /zincir\s+üst\p{L}*/iu.test(normalized)
    ) {
      const withoutChainSurface = normalized.replace(
        /zincir\s+üst\p{L}*/giu,
        "",
      );

      return new RegExp(
        `(?<!\\p{L})${escapeRegExp(concept)}\\p{L}*(?!\\p{L})`,
        "iu",
      ).test(withoutChainSurface);
    }

    return new RegExp(
      `(?<!\\p{L})${escapeRegExp(concept)}\\p{L}*(?!\\p{L})`,
      "iu",
    ).test(normalized);
  });
};
