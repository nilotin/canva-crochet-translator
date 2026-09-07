import type { TargetLanguage } from "../types.js";

const targetPhrase = (
  targetLanguage: TargetLanguage,
  english: string,
  spanish: string,
) => (targetLanguage === "en" ? english : spanish);

const normalizeMaterialsTerminology = (
  source: string,
  targetLanguage: TargetLanguage,
  contentKind: "pattern" | "materials",
): string =>
  contentKind === "materials" && targetLanguage === "en"
    ? source.replace(
        /\b(\d+(?:[.,]\d+)?)\s*mm\s+göz\b/giu,
        "$1 mm safety eyes",
      )
    : source;

const normalizeEnglishCrochetStructures = (
  source: string,
  targetLanguage: TargetLanguage,
): string => {
  if (targetLanguage !== "en") return source;

  return source
    .replace(/\bkaş(?:lar)?\s*(?:[:;–—-])/giu, "Eyebrow:")
    .replace(/\bburun\s*(?:[:;–—-])/giu, "Nose:")
    .replace(/\bağız\s*(?:[:;–—-])/giu, "Mouth:")
    .replace(
      /(\d+)\s*x\s+uzunluğunda\s*,\s*aralarında\s+(\d+)\s*x\s+kalacak\s+şekilde\s*,\s*gözden\s+(\d+)\s+sıra\s+üzerinden\s+işliyoruz\b/giu,
      (_match, length: string, spacing: string, rounds: string) =>
        `Embroider the eyebrows ${length} stitches long, ${spacing} stitches apart, ${rounds} ${rounds === "1" ? "round" : "rounds"} above the eyes`,
    )
    .replace(
      /gözün\s+(bir|\d+)\s+sıra\s+(?:altında|altından)\s*,?\s*(\d+)\s*x\s+üzerinden\s+(?:dolama|sarma)\s+yöntemi\s+ile\s+işliyoruz\b/giu,
      (_match, rounds: string, stitches: string) => {
        const roundCount =
          rounds.toLocaleLowerCase("tr-TR") === "bir" ? "One" : rounds;
        const roundWord =
          roundCount === "1" || roundCount === "One" ? "round" : "rounds";

        return `${roundCount} ${roundWord} below the eyes, embroider over ${stitches} stitches using the wrap-around method`;
      },
    )
    .replace(
      /toz\s+pastel\s+ile\s+boyadım\b/giu,
      "I colored it with soft pastels",
    )
    .replace(
      /(?:[iİ]sterseniz|dilerseniz)\s+burnun\s+(\d+)\s+sıra\s+(?:altından|aşağısından)\s*,?\s*(\d+)\s*x\s+üzerinden\s+işleyebilirsiniz\b/giu,
      (_match, rounds: string, stitches: string) =>
        `If you prefer, you can embroider the mouth ${rounds} ${rounds === "1" ? "round" : "rounds"} below the nose over ${stitches} stitches`,
    )
    .replace(
      /kaş(?:lar)?\s*(?:[:;–—-])\s*(\d+)\s*x\s+uzunluğunda\s*,\s*aralarında\s+(\d+)\s*x\s+kalacak\s+şekilde\s*,\s*gözden\s+(\d+)\s+sıra\s+üzerinden\s+işliyoruz\b/giu,
      (_match, length: string, spacing: string, rounds: string) =>
        `Eyebrow: Embroider the eyebrows ${length} stitches long, ${spacing} stitches apart, ${rounds} ${rounds === "1" ? "round" : "rounds"} above the eyes`,
    )
    .replace(
      /burun\s*(?:[:;–—-])\s*gözün\s+(bir|\d+)\s+sıra\s+(?:altında|altından)\s*,?\s*(\d+)\s*x\s+üzerinden\s+(?:dolama|sarma)\s+yöntemi\s+ile\s+işliyoruz\b/giu,
      (_match, rounds: string, stitches: string) => {
        const roundCount = rounds.toLocaleLowerCase("tr-TR") === "bir"
          ? "One"
          : rounds;
        const roundWord = roundCount === "1" || roundCount === "One"
          ? "round"
          : "rounds";
        return `Nose: ${roundCount} ${roundWord} below the eyes, embroider over ${stitches} stitches using the wrap-around method`;
      },
    )
    .replace(
      /ağız\s*(?:[:;–—-])\s*toz\s+pastel\s+ile\s+boyadım\s*\.\s*\(\s*(?:[iİ]sterseniz|dilerseniz)\s+burnun\s+(\d+)\s+sıra\s+(?:altından|aşağısından)\s*,?\s*(\d+)\s*x\s+üzerinden\s+işleyebilirsiniz\s*[.]?\s*\)/giu,
      (_match, rounds: string, stitches: string) =>
        `Mouth: I colored it with soft pastels. (If you prefer, you can embroider the mouth ${rounds} ${rounds === "1" ? "round" : "rounds"} below the nose over ${stitches} stitches.)`,
    )
    .replace(
      /((?:\d+(?:-\d+)?\)\s*)?)(\d+)\s+sıra\s+(\d+)\s*x\s+örüyoruz\s*,\s*(\d+)\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz\b/giu,
      (
        _match,
        marker: string,
        rounds: string,
        stitches: string,
        chains: string,
      ) =>
        `${marker}${rounds} ${rounds === "1" ? "round" : "rounds"}, ${stitches} sc. Ch ${chains} and cut the yarn`,
    )
    .replace(/\b(\d+)\s+sıra\s+(\d+)\s*x\b/giu, "$1 rounds, $2x")
    .replace(
      /(\d+)\s+zincir\s+çekip\s+dönüyoruz\b/giu,
      (_match, count: string) => `Ch ${count} and turn`,
    )
    .replace(
      /(\d+)\s*x\s+BLO(?:['’]?dan)?\b/giu,
      (_match, stitches: string) => `${stitches}sc in BLO`,
    )
    .replace(
      /BLO(?:['’]?dan)?\s+(\d+)\s*x\b/giu,
      (_match, stitches: string) => `${stitches}sc in BLO`,
    )
    .replace(
      /aynı\s+sık\s+iğne(?:nin|ye)?\s+içine\s+(\d+)\s*tr\b/giu,
      (_match, count: string) => `${count}tr in the same stitch`,
    )
    .replace(
      /\bsihirli\s+halka\s+içine\s+(\d+)\s*x\b/giu,
      "$1x into the magic ring",
    )
    .replace(
      /\b(\d+)\s+zincir\s+(\d+)\s*x\s+atla\b/giu,
      "ch $1, skip $2 sts",
    )
    .replace(
      /\baynı\s+zincir\s+içine\s+(\d+)\s*x\b/giu,
      "$1sc in the same chain",
    )
    .replace(
      /\bzincir\s+içine\s+(\d+)\s*x\b/giu,
      "$1x into the chain space",
    )
    .replace(
      /\b(?:bu(?:ras[ıi])?\s+(?:bizim\s+)?başlangıç\s+noktamız(?:dır|\s+olacak)?|burası\s+başlangıç\s+noktamız(?:dır|\s+olacak)?)\s*[;,.]?\s*(?:işaretleyiciyi|işaretleyicimizi|markerı|markeri)\s+buraya\s+(?:takıyoruz|yerleştiriyoruz|koyuyoruz)\b/giu,
      "This will be the beginning of the round; place a stitch marker here",
    )
    .replace(
      /\bfotoğraf\s+temsilidir\b/giu,
      "The images are for reference only",
    )
    .replace(/\bgözleri\s+takacağız\b/giu, "we will insert the eyes")
    .replace(
      /\bgözleri\s+yerleştirebiliriz\b/giu,
      "we can insert the eyes",
    );
};

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
        ? `Using a ${size} mm crochet hook and ${description} ${brand} yarn, work as follows`
        : `Con un ganchillo de ${size} mm y hilo ${description} ${brand}, tejemos de la siguiente manera`;
    },
  );

  normalized = normalized.replace(
    /\b(\d+(?:[.,]\d+)?)\s*(?:mm\s+|(?:numara|no)\s+)?tığ\s+ile\s+örüyoruz\b/giu,
    (_match, size: string) =>
      targetLanguage === "en"
        ? `Using a ${size} mm crochet hook, work as follows`
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
  contentKind: "pattern" | "materials" = "pattern",
): string =>
  normalizeSimpleLoopInstruction(
    normalizeConditionalLoopInstruction(
      normalizeToolMaterialIntro(
        normalizeEnglishCrochetStructures(
          normalizeMaterialsTerminology(source, targetLanguage, contentKind),
          targetLanguage,
        ),
        targetLanguage,
      ),
      targetLanguage,
    ),
    targetLanguage,
  )
    .replace(
      /(\d+)\s+zincir\s+çekip\s+kafaya\s+dikmek\s+için\s+ipimizi\s+uzun\s+kesiyoruz\b/giu,
      (_match, count: string) =>
        targetPhrase(
          targetLanguage,
          `ch ${count}. Cut the yarn, leaving a long tail for sewing the ear to the head`,
          `${count} cad. Corta el hilo dejando una hebra larga para coser la oreja a la cabeza`,
        ),
    )
    .replace(
      /üst\s+kirpikten\s+(\d+)\s*x\s+sayıyoruz\s+ve\s+burayı\s+işaretliyoruz\b/giu,
      (_match, count: string) =>
        targetPhrase(
          targetLanguage,
          `Count ${count} stitches from the upper eyelash and mark that point`,
          `Cuenta ${count} puntos desde la pestaña superior y marca ese punto`,
        ),
    )
    .replace(
      /aşağı\s+doğru\s+(\d+)\s*x\s+sayıp\s+burayı\s+da\s+işaretliyoruz\b/giu,
      (_match, count: string) =>
        targetPhrase(
          targetLanguage,
          `Count ${count} stitches downward and mark that point as well`,
          `Cuenta ${count} puntos hacia abajo y marca también ese punto`,
        ),
    )
    .replace(
      /bu\s+(\d+)\s*x\s+üzerinden\s+kulakları\s+dikiyoruz\b/giu,
      (_match, count: string) =>
        targetPhrase(
          targetLanguage,
          `Sew the ears along these ${count} stitches`,
          `Cose las orejas a lo largo de estos ${count} puntos`,
        ),
    )
    .replace(
      /kirpikten\s+(\d+)\s*x\s+sayıyoruz\s*[,，]?\s*orayı\s+işaretliyoruz\b/giu,
      (_match, count: string) =>
        targetPhrase(
          targetLanguage,
          `Count ${count} stitches from the eyelash and mark that point`,
          `Cuenta ${count} puntos desde la pestaña y marca ese punto`,
        ),
    )
    .replace(
      /aşağıya\s+doğru\s+(\d+)\s*x\s+sayıyoruz\s*[,，]?\s*orayı\s+da\s+işaretliyoruz\b/giu,
      (_match, count: string) =>
        targetPhrase(
          targetLanguage,
          `Count ${count} stitches downward and mark that point as well`,
          `Cuenta ${count} puntos hacia abajo y marca también ese punto`,
        ),
    )
    .replace(
      /kulakları\s+bu\s+(\d+)\s*x\s+üzerinden\s+dikiyoruz\b/giu,
      (_match, count: string) =>
        targetPhrase(
          targetLanguage,
          `Sew the ears along these ${count} stitches`,
          `Cose las orejas a lo largo de estos ${count} puntos`,
        ),
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
        `${count} ${count === "1" ? "round" : "rounds"} above the eye`,
        `${count} filas por encima del ojo`,
      ),
    );
