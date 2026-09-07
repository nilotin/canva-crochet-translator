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
    ? `${marker}Work ${stitchCount}sc into a mr.`
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

const normalizeCrochetSequenceLine = (source: string): string | undefined => {
  const markerMatch = /^(\s*(?:\d+\)\s*)?)(.*?)(\s*)$/u.exec(source);
  if (!markerMatch) return undefined;

  let body = markerMatch[2] ?? "";
  let eyePlacement = "";
  const parenthetical = /\s*(\([^()]*\))\s*$/u.exec(body);
  if (parenthetical) {
    if (!/gözleri\s+takacağız/iu.test(parenthetical[1] ?? "")) {
      return undefined;
    }
    eyePlacement = " (we will insert the eyes into these chain spaces later)";
    body = body.slice(0, parenthetical.index).trimEnd();
  }

  const terminal = /[.]$/u.test(body) ? "." : "";
  if (terminal) body = body.slice(0, -1).trimEnd();
  let hasSpecialStructure = false;
  const sourceParts = body.split(/\s*,\s*/u);
  const translatedParts: string[] = [];
  for (let index = 0; index < sourceParts.length; index += 1) {
    const part = sourceParts[index] ?? "";
    let match = /^(\d+)\s+zincir\s+(\d+)x\s+atla$/iu.exec(part);
    if (match) {
      hasSpecialStructure = true;
      translatedParts.push(`ch ${match[1]}, skip ${match[2]} sts`);
      continue;
    }

    match = /^(\d+)\s+zincir$/iu.exec(part);
    const skipMatch = /^(\d+)x\s+atla$/iu.exec(
      sourceParts[index + 1] ?? "",
    );
    if (match && skipMatch) {
      hasSpecialStructure = true;
      translatedParts.push(`ch ${match[1]}, skip ${skipMatch[1]} sts`);
      index += 1;
      continue;
    }

    match = /^zincir\s+içine\s+(\d+)x$/iu.exec(part);
    if (match) {
      hasSpecialStructure = true;
      translatedParts.push(`${match[1]}sc into the chain space`);
      continue;
    }

    match = /^(\d+)x\s*=\s*(\d+)x$/iu.exec(part);
    if (match) {
      translatedParts.push(`${match[1]}sc = ${match[2]}sc`);
      continue;
    }

    match = /^(\d+)x$/iu.exec(part);
    if (match) {
      translatedParts.push(`${match[1]}sc`);
      continue;
    }

    return undefined;
  }

  if (!hasSpecialStructure) return undefined;

  return `${markerMatch[1]}${translatedParts.join(", ")}${eyePlacement}${terminal}${markerMatch[3]}`;
};

const STITCH_MARKER_INSTRUCTION =
  "This will be the beginning of the round; place a stitch marker here.";

const isStitchMarkerInstruction = (source: string): boolean =>
  /başlangıç\s+noktamız/iu.test(source) &&
  /işaretleyici\p{L}*/iu.test(source) &&
  /buraya/iu.test(source) &&
  /(?:takıyoruz|yerleştiriyoruz|sabitliyoruz)/iu.test(source);

const normalizeEnglishCrochetInstructionLine = (
  source: string,
  translated: string,
): string => {
  const sourceClauses = /^(.*?)(\s+[—–-]\s+)(.*)$/u.exec(source);
  if (sourceClauses && isStitchMarkerInstruction(sourceClauses[3] ?? "")) {
    const translatedClauses = /^(.*?)(\s+[—–-]\s+)(.*)$/u.exec(translated);
    const translatedPrefix = translatedClauses?.[1] ?? translated;
    const normalizedPrefix = normalizeEnglishCrochetInstructionLine(
      sourceClauses[1] ?? "",
      translatedPrefix,
    );

    if (translatedClauses || normalizedPrefix !== translatedPrefix) {
      return `${normalizedPrefix}${sourceClauses[2]}${STITCH_MARKER_INSTRUCTION}`;
    }
  }

  const roundCount =
    /^(\s*(?:\d+(?:-\d+)?\)\s*)?)(\d+)\s+sıra\s+(\d+)x([.]?\s*)$/iu.exec(
      source,
    );
  if (roundCount) {
    const rounds = Number(roundCount[2]) === 1 ? "round" : "rounds";
    return `${roundCount[1]}${roundCount[2]} ${rounds}, ${roundCount[3]} sc${roundCount[4]}`;
  }

  const magicRing =
    /^(\s*(?:\d+\)\s*)?)sihirli\s+halka\s+içine\s+(\d+)x([.]?\s*)$/iu.exec(
      source,
    );
  if (magicRing) {
    return `${magicRing[1]}${magicRing[2]}sc into the magic ring${magicRing[3]}`;
  }

  const sequence = normalizeCrochetSequenceLine(source);
  if (sequence !== undefined) return sequence;

  if (
    /^\s*\([^()]*zincir[^()]*boşluk[^()]*gözleri\s+takacağız[^()]*\)\s*$/iu.test(
      source,
    )
  ) {
    const leading = source.match(/^\s*/u)?.[0] ?? "";
    const trailing = source.match(/\s*$/u)?.[0] ?? "";
    return `${leading}(we will insert the eyes into these chain spaces later)${trailing}`;
  }

  if (isStitchMarkerInstruction(source)) {
    const marker = source.match(/^\s*(?:\d+\)\s*)?/u)?.[0] ?? "";
    return `${marker}${STITCH_MARKER_INSTRUCTION}`;
  }

  if (/gözleri[^.!?\n]{0,80}(?:takacağız|yerleştirebiliriz)/iu.test(source)) {
    return translated
      .replace(
        /\b(?:attach|place|position) the eyes\b/giu,
        "insert the eyes",
      )
      .replace(/\binsert the eyes in\b/giu, "insert the eyes into");
  }

  if (/(?<!\p{L})tığ(?!\p{L})[\s\S]*\bile\s+örüyoruz\b/iu.test(source)) {
    return translated.replace(
      /\bWith a (\d+(?:[.,]\d+)?\s+mm crochet hook)\b/u,
      "Using a $1",
    );
  }

  return translated;
};

const normalizeEnglishCrochetInstructions = (
  source: string,
  translated: string,
  targetLanguage: TargetLanguage,
): string => {
  if (targetLanguage !== "en") return translated;
  const sourceLines = source.split("\n");
  const crochetTerminology = /(?<!\p{L})sıra\p{L}*/iu.test(source)
    ? translated
        .replace(/\brows\b/giu, "rounds")
        .replace(/\brow\b/giu, "round")
    : translated;
  const translatedLines = crochetTerminology.split("\n");
  if (sourceLines.length !== translatedLines.length) return crochetTerminology;
  return sourceLines
    .map((sourceLine, index) =>
      normalizeEnglishCrochetInstructionLine(
        sourceLine,
        translatedLines[index] ?? "",
      ),
    )
    .join("\n");
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

const normalizeReverseSingleCrochetTerminology = (
  source: string,
  translated: string,
  targetLanguage: TargetLanguage,
): string => {
  if (targetLanguage !== "en") return translated;

  const sourceLower = source.toLocaleLowerCase("tr-TR");
  const isReverseSingleCrochetContext =
    sourceLower.includes("ters sık iğne");

  if (!isReverseSingleCrochetContext) return translated;

  return translated
    .replace(
      /\b(?:the\s+)?wrong side of (?:the )?single crochet stitches\b/giu,
      "the back of the single crochet stitches",
    )
    .replace(
      /\b(?:the\s+)?right side of (?:the )?single crochet stitches\b/giu,
      "the front of the single crochet stitches",
    )
    .replace(
      /\bthe wrong side\b/giu,
      "the back of the stitches",
    )
    .replace(
      /\bthe right side\b/giu,
      "the front of the stitches",
    )
    .replace(/^the back of the stitches\b/u, "The back of the stitches")
    .replace(
      /^the back of the single crochet stitches\b/u,
      "The back of the single crochet stitches",
    );
};

const normalizeMaterialsSafetyEyes = (
  source: string,
  translated: string,
  targetLanguage: TargetLanguage,
  contentKind: "pattern" | "materials",
): string => {
  if (contentKind !== "materials" || targetLanguage !== "en") {
    return translated;
  }

  const sourceLines = source.split("\n");
  const translatedLines = translated.split("\n");
  if (sourceLines.length !== translatedLines.length) return translated;

  return translatedLines
    .map((translatedLine, index) => {
      const sourceLine = sourceLines[index] ?? "";
      const match =
        /^(\s*(?:[✦•*-]\s*)?)(\d+(?:[.,]\d+)?)\s*mm\s+göz\s*$/iu.exec(
          sourceLine,
        );
      return match
        ? `${match[1]}${match[2]} mm safety eyes`
        : translatedLine;
    })
    .join("\n");
};

export const normalizeTranslationStyle = (
  source: string,
  translated: string,
  targetLanguage: TargetLanguage,
  contentKind: "pattern" | "materials" = "pattern",
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
  const crochetInstructions = normalizeEnglishCrochetInstructions(
    source,
    mixed,
    targetLanguage,
  );
  const floBlo = normalizeSimpleFloBlo(
    source,
    crochetInstructions,
    targetLanguage,
  );

  return normalizeMaterialsSafetyEyes(
    source,
    normalizeReverseSingleCrochetTerminology(
      source,
      floBlo,
      targetLanguage,
    ),
    targetLanguage,
    contentKind,
  );
};
