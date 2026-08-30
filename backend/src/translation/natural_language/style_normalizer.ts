import type { TargetLanguage } from "../types.js";

const MAGIC_RING_SOURCE = /^(\s*\d+\.\s*)?(\d+)x ile sh oluşturuyoruz\.\s*$/u;

const normalizeMagicRingOpening = (
  source: string,
  translated: string,
  targetLanguage: TargetLanguage,
): string => {
  const match = MAGIC_RING_SOURCE.exec(source);
  if (!match) return translated;

  const marker = match[1] ?? "";
  const stitchCount = match[2];
  return targetLanguage === "en"
    ? `${marker}Work ${stitchCount} sc into a mr.`
    : `${marker}Hacemos ${stitchCount} pb en un am.`;
};

const normalizeEnglishChains = (translated: string): string =>
  translated.replace(
    /(^|[.!?]\s+)(Ch\s+\d+)\s+ch(?=\s*(?:[.!?,;:]|$))/gu,
    "$1$2",
  );

const normalizeChainOnlyInstructions = (
  source: string,
  translated: string,
  targetLanguage: TargetLanguage,
): string => {
  if (!/^(?:\s*\d+\s+zn\s+çekiyoruz\.\s*)+$/iu.test(source)) return translated;
  const counts = [...source.matchAll(/(\d+)\s+zn\s+çekiyoruz\./giu)].map(
    (match) => match[1],
  );
  return targetLanguage === "en"
    ? counts.map((count) => `Ch ${count}.`).join(" ")
    : counts.map((count) => `Haz ${count} cad.`).join(" ");
};

const normalizeMixedPatternPhrases = (
  source: string,
  translated: string,
  targetLanguage: TargetLanguage,
): string => {
  let normalized = translated;
  if (/\d+\s+zincir\b/iu.test(source) && targetLanguage === "en")
    normalized = normalized.replace(/\b(\d+)\s+ch\b/giu, "ch $1");
  if (/\d+x\s+atla\b/iu.test(source)) {
    normalized =
      targetLanguage === "en"
        ? normalized.replace(/\b(\d+)sc\s+skip\b/giu, "skip $1sc")
        : normalized.replace(/\b(\d+)pb\s+saltar\b/giu, "saltar $1pb");
  }
  return normalized;
};

const normalizeSimpleFloBlo = (
  source: string,
  translated: string,
  targetLanguage: TargetLanguage,
): string => {
  const sourceMatch = /^\s*(FLO|BLO) örüyoruz\.\s*$/u.exec(source);
  const shortTarget =
    targetLanguage === "en"
      ? /^\s*(FLO|BLO)(?:\s+(?:(?:We\s+)?crochet|[Ww]ork))?\.\s*$/u.test(
          translated,
        )
      : /^\s*(Flo|Blo)(?:\s+tejemos)?\.\s*$/u.test(translated);
  if (sourceMatch && shortTarget) {
    return targetLanguage === "en"
      ? `Work in ${sourceMatch[1]}.`
      : `Tejemos en ${sourceMatch[1] === "FLO" ? "Flo" : "Blo"}.`;
  }

  if (targetLanguage === "en") {
    const match = /^\s*(FLO|BLO)\s+(?:(?:We\s+)?crochet|[Ww]ork)\.\s*$/u.exec(
      translated,
    );
    return match ? `Work in ${match[1]}.` : translated;
  }

  const match = /^\s*(Flo|Blo)\s+tejemos\.\s*$/u.exec(translated);
  return match ? `Tejemos en ${match[1]}.` : translated;
};

export const normalizeTranslationStyle = (
  source: string,
  translated: string,
  targetLanguage: TargetLanguage,
): string => {
  const magicRingOpening = normalizeMagicRingOpening(
    source,
    translated,
    targetLanguage,
  );
  const chainInstructions = normalizeChainOnlyInstructions(
    source,
    magicRingOpening,
    targetLanguage,
  );
  const chains =
    targetLanguage === "en"
      ? normalizeEnglishChains(chainInstructions)
      : chainInstructions;
  const mixed = normalizeMixedPatternPhrases(source, chains, targetLanguage);
  return normalizeSimpleFloBlo(source, mixed, targetLanguage);
};
