import type { TargetLanguage } from "../types.js";

const targetPhrase = (
  targetLanguage: TargetLanguage,
  english: string,
  spanish: string,
) => (targetLanguage === "en" ? english : spanish);

const normalizeToolMaterialIntro = (
  source: string,
  targetLanguage: TargetLanguage,
): string => {
  let normalized = source;

  normalized = normalized.replace(
    /\b(\d+(?:[.,]\d+)?)\s*(?:numara|no)\s+tığ\s*,\s*([^,()]+?)\s+ip\s*\(\s*([^)]+?)\s*\)\s+ile\s+örüyoruz\b/giu,
    (
      _match,
      size: string,
      yarnDescription: string,
      yarnBrand: string,
    ) => {
      const description = yarnDescription.trim();
      const brand = yarnBrand.trim();

      return targetLanguage === "en"
        ? `With a ${size} mm crochet hook and ${description} ${brand} yarn, work as follows`
        : `Con un ganchillo de ${size} mm y hilo ${description} ${brand}, tejemos de la siguiente manera`;
    },
  );

  normalized = normalized.replace(
    /\b(\d+(?:[.,]\d+)?)\s*(?:mm\s+|(?:numara|no)\s+)?tığ\s+ile\s+örüyoruz\b/giu,
    (_match, size: string) =>
      targetLanguage === "en"
        ? `With a ${size} mm crochet hook, work as follows`
        : `Con un ganchillo de ${size} mm, tejemos de la siguiente manera`,
  );

  normalized = normalized.replace(
    /\b(\d+(?:[.,]\d+)?)\s*(?:mm\s+|(?:numara|no)\s+)?tığ\s+kullanıyoruz\b/giu,
    (_match, size: string) =>
      targetLanguage === "en"
        ? `Use a ${size} mm crochet hook`
        : `Usa un ganchillo de ${size} mm`,
  );

  return normalized;
};

const normalizeConditionalTechnique = (
  source: string,
  targetLanguage: TargetLanguage,
): string | undefined => {
  const normalized = source
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/gu, " ")
    .trim();

  if (
    /^çapraz\s+ya\s+da\s+düz\s+sık\s+iğne(?:\s+tekniği)?\s+ile\s+örenler$/u.test(
      normalized,
    )
  ) {
    return targetPhrase(
      targetLanguage,
      "using crossed or regular single crochet",
      "usando punto bajo cruzado o punto bajo normal",
    );
  }

  if (
    /^çapraz\s+sık\s+iğne(?:\s+tekniği)?\s+ile\s+örenler$/u.test(normalized)
  ) {
    return targetPhrase(
      targetLanguage,
      "using crossed single crochet",
      "usando punto bajo cruzado",
    );
  }

  if (
    /^düz\s+sık\s+iğne(?:\s+tekniği)?\s+ile\s+örenler$/u.test(normalized)
  ) {
    return targetPhrase(
      targetLanguage,
      "using regular single crochet",
      "usando punto bajo normal",
    );
  }

  return undefined;
};

const normalizeConditionalLoopInstruction = (
  source: string,
  targetLanguage: TargetLanguage,
): string =>
  source.replace(
    /\bbu\s+sırayı\s+(FLO|BLO)\s*[’'ʼ]?\s*dan\s+örüyoruz\s*\(\s*([^(),]+?)\s*,?\s*(FLO|BLO)\s*[’'ʼ]?\s*dan\s+örecekler\s*\)(\s*[,.;:]?\s*)?/giu,
    (
      match,
      defaultLoopRaw: string,
      techniqueRaw: string,
      alternativeLoopRaw: string,
      trailingSeparator: string | undefined,
    ) => {
      const technique = normalizeConditionalTechnique(
        techniqueRaw,
        targetLanguage,
      );

      if (!technique) return match;

      const defaultLoop = defaultLoopRaw.toUpperCase();
      const alternativeLoop = alternativeLoopRaw.toUpperCase();

      if (defaultLoop === alternativeLoop) return match;

      const translated =
        targetLanguage === "en"
          ? `Work in ${defaultLoop}. If ${technique}, work in ${alternativeLoop} instead.`
          : `Trabaja en ${defaultLoop}. Si ${technique}, trabaja en ${alternativeLoop} en su lugar.`;

      const continuesAfterInstruction =
        trailingSeparator !== undefined &&
        /[,;:]/u.test(trailingSeparator);

      return `${translated}${continuesAfterInstruction ? " " : ""}`;
    },
  );

const normalizeSimpleLoopInstruction = (
  source: string,
  targetLanguage: TargetLanguage,
): string =>
  source.replace(
    /\bbu\s+sırayı\s+(FLO|BLO)\s*[’'ʼ]?\s*dan\s+örüyoruz\b/giu,
    (_match, loopRaw: string) =>
      targetLanguage === "en"
        ? `Work in ${loopRaw.toUpperCase()}`
        : `Trabaja en ${loopRaw.toUpperCase()}`,
  );

export const normalizeSourceNaturalLanguage = (
  source: string,
  targetLanguage: TargetLanguage,
): string =>
  normalizeSimpleLoopInstruction(
    normalizeConditionalLoopInstruction(
      normalizeToolMaterialIntro(source, targetLanguage),
      targetLanguage,
    ),
    targetLanguage,
  )
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
