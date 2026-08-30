import type { TargetLanguage } from "../types.js";

const targetPhrase = (
  targetLanguage: TargetLanguage,
  english: string,
  spanish: string,
) => (targetLanguage === "en" ? english : spanish);

export const normalizeSourceNaturalLanguage = (
  source: string,
  targetLanguage: TargetLanguage,
): string =>
  source
    .replace(
      /(\d+)\s*x\s+sayıyoruz\b/giu,
      (_match, count: string) =>
        targetPhrase(
          targetLanguage,
          `count ${count} stitches`,
          `contamos ${count} puntos`,
        ),
    )
    .replace(
      /(\d+)\s*x(?:\s*[’']\s*in)?\s+üzerinden\b/giu,
      (_match, count: string) =>
        targetPhrase(
          targetLanguage,
          `over ${count} stitches`,
          `sobre ${count} puntos`,
        ),
    )
    .replace(
      /\biki\s+zincir\b/giu,
      targetPhrase(targetLanguage, "two chains", "dos cadenas"),
    )
    .replace(/\bflodan\b/giu, "FLO’dan")
    .replace(/\bblodan\b/giu, "BLO’dan")
    .replace(
      /aralarında\s+(\d+)\s*x\s+kalacak\s+şekilde/giu,
      (_match, count: string) =>
        targetPhrase(
          targetLanguage,
          `${count} stitches apart`,
          `separados por ${count} puntos`,
        ),
    )
    .replace(/(\d+)\s*x\s+uzunluğunda/giu, (_match, count: string) =>
      targetPhrase(
        targetLanguage,
        `${count} stitches long`,
        `${count} puntos de largo`,
      ),
    )
    .replace(/gözden\s+(\d+)\s+sıra\s+üzerinden/giu, (_match, count: string) =>
      targetPhrase(
        targetLanguage,
        `${count} rows above the eye`,
        `${count} filas por encima del ojo`,
      ),
    );
