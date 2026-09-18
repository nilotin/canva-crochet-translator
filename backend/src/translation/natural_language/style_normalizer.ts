import type { TargetLanguage } from "../types.js";
import {
  normalizeRoundCountYarnCutSourceSpans,
  parseBareRoundCountSourceLine,
  renderEnglishBareRoundCountLine,
  scanRoundCountYarnCutSourceSpans,
} from "./bare_round_count.js";

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
      const stitchWord = Number(match[2]) === 1 ? "st" : "sts";
      translatedParts.push(`ch ${match[1]}, skip ${match[2]} ${stitchWord}`);
      continue;
    }

    match = /^(\d+)\s+zincir$/iu.exec(part);
    const skipMatch = /^(\d+)x\s+atla$/iu.exec(
      sourceParts[index + 1] ?? "",
    );
    if (match && skipMatch) {
      hasSpecialStructure = true;
      const stitchWord = Number(skipMatch[1]) === 1 ? "st" : "sts";
      translatedParts.push(`ch ${match[1]}, skip ${skipMatch[1]} ${stitchWord}`);
      index += 1;
      continue;
    }

    match = /^zincir\s+(?:içine|üzeri)\s+(\d+)x$/iu.exec(part);
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

const TURKISH_YARN_COLORS: Record<string, string> = {
  siyah: "black",
  beyaz: "white",
  kırmızı: "red",
  mavi: "blue",
  yeşil: "green",
  sarı: "yellow",
  mor: "purple",
  turuncu: "orange",
  pembe: "pink",
  kahverengi: "brown",
  gri: "gray",
  ekru: "ecru",
};

const isStitchMarkerInstruction = (source: string): boolean =>
  /başlangıç\s+noktamız/iu.test(source) &&
  /işaretleyici\p{L}*/iu.test(source) &&
  /buraya/iu.test(source) &&
  /(?:takıyoruz|yerleştiriyoruz|sabitliyoruz)/iu.test(source);

const normalizeEnglishCrochetInstructionLine = (
  source: string,
  translated: string,
): string => {
  const roundCountYarnCutSpans = scanRoundCountYarnCutSourceSpans(source);
  const roundCountYarnCutSpan = roundCountYarnCutSpans[0];
  if (
    roundCountYarnCutSpans.length === 1 &&
    roundCountYarnCutSpan &&
    source.slice(0, roundCountYarnCutSpan.start).trim() === "" &&
    source.slice(roundCountYarnCutSpan.end).trim() === ""
  ) {
    return normalizeRoundCountYarnCutSourceSpans(source, "sc");
  }

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

  const nestedRoundLoopAttachment =
    /^(\s*(?:[✦◆]\s*)?(?:\d+\)\s*)?)(?:(görselde\s+görüldüğü\s+gibi)\s+)?(\d+)\.\s*sıra(?:da|nın)\s+(FLO|BLO)\s*[’'ʼ]?\s*(?:dan|den)\s+ördüğümüz\s+sık\s+iğne(?:lerin|lerinin)\s*[,，]?\s*(FLO|BLO)\s*[’'ʼ]?\s*(?:sundan|sından|dan|den)\s*[,，]?\s*(?:(siyah|beyaz|kırmızı|mavi|yeşil|sarı|mor|turuncu|pembe|kahverengi|gri|ekru)\s+)?ipimizi\s+sabitliyoruz[.]?/iu.exec(
      source,
    );

  if (nestedRoundLoopAttachment) {
    const prefix = nestedRoundLoopAttachment[1] ?? "";
    const imageReference = nestedRoundLoopAttachment[2];
    const round = nestedRoundLoopAttachment[3] ?? "";
    const workedLoop = nestedRoundLoopAttachment[4]?.toUpperCase() ?? "";
    const attachmentLoop =
      nestedRoundLoopAttachment[5]?.toUpperCase() ?? "";
    const colorSource =
      nestedRoundLoopAttachment[6]?.toLocaleLowerCase("tr-TR") ?? "";
    const yarnColor = colorSource
      ? TURKISH_YARN_COLORS[colorSource] ?? ""
      : "";

    const sourceRemainder = source
      .slice(nestedRoundLoopAttachment[0].length)
      .trimStart();

    const nextInstructionMarker =
      /^(\d+(?:-\d+)?\))\s*/u.exec(sourceRemainder)?.[1];

    let translatedRemainder: string;

    if (nextInstructionMarker) {
      const escapedMarker = nextInstructionMarker.replace(
        /[.*+?^${}()|[\]\\]/gu,
        "\\$&",
      );
      const translatedMarker = new RegExp(
        `(?:^|\\s)(${escapedMarker})(?=\\s)`,
        "u",
      ).exec(translated);

      translatedRemainder = translatedMarker
        ? translated.slice(
            (translatedMarker.index ?? 0) +
              translatedMarker[0].length -
              (translatedMarker[1]?.length ?? 0),
          )
        : translated.replace(/^.*?[.](?:\s+|$)/u, "");
    } else {
      translatedRemainder = translated.replace(
        /^.*?[.](?:\s+|$)/u,
        "",
      );
    }

    const yarnPhrase = yarnColor ? `the ${yarnColor} yarn` : "the yarn";
    const normalizedOpening =
      `${prefix}Attach ${yarnPhrase} to the ${attachmentLoop} of the single crochet stitches worked in the ${workedLoop} of Round ${round}${imageReference ? " as shown in the image" : ""}.`;

    return translatedRemainder
      ? `${normalizedOpening} ${translatedRemainder}`
      : normalizedOpening;
  }

  const finishingHairStrand =
    /^(\s*(?:[✦◆]\s*)?)(\d+)\s+zincir\s+çekip\s+geriye\s+dönüyoruz\s*[,，]\s*(?:zincir\s+üzerine\s+)?ikinci\s+zincirden\s+itibaren\s+(\d+)\s*x\s*[,，]\s*(\d+)\s*x\s+atla\s*[,，]?\s*sıradaki\s+sık\s+iğneye\s+cc(?:\.\.\.|…)?\s*bu\s+şekilde\s+sıra\s+sonuna\s+kadar\s+devam\s+ediyoruz[.]\s*sıra\s+sonuna\s+geldiğimizde\s+(\d+)\s+zincir\s+çekip\s+dikiş\s+için\s+ipimizi\s+uzun\s+kesiyoruz[.]?\s*$/iu.exec(
      source,
    );

  if (finishingHairStrand) {
    const [, prefix, chains, stitches, skipped, finalChains] =
      finishingHairStrand;

    return `${prefix}Ch ${chains} and turn. Starting from the second chain, ${stitches}sc, skip ${skipped}sc, SL.ST into the next stitch. Continue in this way to the end of the round. At the end of the round, ch ${finalChains} and cut the yarn, leaving a long tail for sewing.`;
  }

  const repeatedHairStrand =
    /^(\s*(?:\d+\)\s*)?)\(\s*(\d+)\s+zincir\s+çekip\s+geriye\s+dönüyoruz\s*[,，]\s*(?:zincir\s+üzerine\s+)?ikinci\s+zincirden\s+itibaren\s+(\d+)\s*x\s*[,，]\s*(\d+)\s*x\s+atla\s*[,，]?\s*sıradaki\s+sık\s+iğneye\s+cc\s*\)\s*\*\s*(\d+)([.]?\s*)$/iu.exec(
      source,
    );

  if (repeatedHairStrand) {
    const [, prefix, chains, stitches, skipped, repeats, suffix] =
      repeatedHairStrand;

    return `${prefix}(Ch ${chains} and turn. Starting from the second chain, ${stitches}sc, skip ${skipped}sc, SL.ST into the next stitch)*${repeats}${suffix}`;
  }

  const repeatedLongHairThenBangs =
    /^(\s*(?:\d+\)\s*)?)\(\s*(\d+)\s+zincir\s+çekip\s+geriye\s+dönüyoruz\s*[,，]\s*(?:zincir\s+üzerine\s+)?ikinci\s+zincirden\s+itibaren\s+(\d+)\s*x\s*[,，]\s*(\d+)\s*x\s+atla\s+sıradaki\s+sık\s+iğneye\s+cc\s*\)\s*\*\s*(\d+)\s*[,，]\s*(\d+)\s+tane\s+uzun\s+saç\s+teli\s+ördükten\s+sonra\s+kahkülleri\s+öreceğiz[.]?\s*$/iu.exec(
      source,
    );

  if (repeatedLongHairThenBangs) {
    const [
      ,
      prefix,
      chains,
      stitches,
      skipped,
      repeats,
      longHairCount,
    ] = repeatedLongHairThenBangs;

    return `${prefix}(Ch ${chains} and turn. Starting from the second chain, ${stitches}sc, skip ${skipped}sc, SL.ST into the next stitch)*${repeats}. After making ${longHairCount} long hair strands, work the bangs.`;
  }

  const chainTurnFoundation =
    /^(\s*(?:\d+\)\s*)?)(\d+)\s+zincir\s+dön\s*[,，]\s*ikinci\s+zincirden\s+itibaren\s+(\d+)\s*x\s*[,，]\s*aynı\s+ilmek\s+içine\s+(\d+)\s*x\s*[,，]\s*\(\s*zincirin\s+diğer\s+tarafından\s+devam\s+ediyoruz\s*\)\s*[,，]\s*(\d+)\s*x\s*[,，]\s*(\d+)\s*v\s*=\s*(\d+)\s*x\s+(?:başlangıç\s+noktamız\s+burası\s+olacak|burası\s+başlangıç\s+noktamız\s+olacak)[.]\s*(?:[iİ]şaretleyiciyi|[iİ]şaretleyicimizi|markeri|markerı)\s+buraya\s+(?:takıyoruz|yerleştiriyoruz|koyuyoruz)[.]?\s*$/iu.exec(
      source,
    );

  if (chainTurnFoundation) {
    const [
      ,
      markerPrefix,
      chains,
      firstSc,
      sameStitchSc,
      nextSc,
      increases,
      total,
    ] = chainTurnFoundation;

    return `${markerPrefix}Ch ${chains} and turn. Starting from the second chain, ${firstSc}sc, ${sameStitchSc}sc in the same stitch (continue along the other side of the chain), ${nextSc}sc, ${increases}inc = ${total}sc. ${STITCH_MARKER_INSTRUCTION}`;
  }

  const chainTurnFoundationWithSideStitches =
    /^(\s*(?:\d+\)\s*)?)(\d+)\s+zincir\s+çekip\s+(?:geriye\s+)?dönüyoruz[.]\s*(?:zincir\s+üzerine\s+)?ikinci\s+zincirden\s+itibaren\s+(\d+)\s*v\s*[,，]\s*(\d+)\s*x\s*[,，]\s*aynı\s+zincir\s+içine\s+(\d+)\s*x\s*[,，]\s*\(\s*zincirin\s+diğer\s+tarafından\s+devam\s+ediyoruz\s*\)\s*[,，]\s*(\d+)\s*x\s*[,，]\s*(\d+)\s*v\s*=\s*(\d+)\s*x\s+(?:başlangıç\s+noktamız\s+burası\s+olacak|burası\s+başlangıç\s+noktamız\s+olacak)[.]\s*(?:[iİ]şaretleyiciyi|[iİ]şaretleyicimizi|markeri|markerı)\s+buraya\s+(?:takıyoruz|yerleştiriyoruz|koyuyoruz)[.]?\s*$/iu.exec(
      source,
    );

  if (chainTurnFoundationWithSideStitches) {
    const [
      ,
      markerPrefix,
      chains,
      firstIncrease,
      firstSideSc,
      sameChainSc,
      secondSideSc,
      finalIncrease,
      total,
    ] = chainTurnFoundationWithSideStitches;

    return `${markerPrefix}Ch ${chains} and turn. Starting from the second chain, ${firstIncrease}inc, ${firstSideSc}sc, ${sameChainSc}sc in the same chain (continue along the other side of the chain), ${secondSideSc}sc, ${finalIncrease}inc = ${total}sc. ${STITCH_MARKER_INSTRUCTION}`;
  }

  const sameStitchTreble =
    /^(\s*(?:\d+\)\s*)?)aynı\s+ilmek\s+içine\s+(\d+)\s*tr\s*[,，]\s*(\d+)\s*x([.]?\s*)$/iu.exec(
      source,
    );

  if (sameStitchTreble) {
    return `${sameStitchTreble[1]}${sameStitchTreble[2]}tr in the same stitch, ${sameStitchTreble[3]}sc${sameStitchTreble[4]}`;
  }

  const multiStitchDecrease =
    /^(\s*(?:\d+\)\s*)?)M\s*\(\s*aynı\s+anda\s+(bir|iki|üç|dört|beş|\d+)\s+ilmeği\s+birlikte\s+kesmek\s*\)\s*[,，]\s*(\d+)\s*x([.]?\s*)$/iu.exec(
      source,
    );

  if (multiStitchDecrease) {
    const wordCounts: Record<string, string> = {
      bir: "1",
      iki: "2",
      üç: "3",
      dört: "4",
      beş: "5",
    };

    const decreaseCount =
      wordCounts[
        (multiStitchDecrease[2] ?? "").toLocaleLowerCase("tr-TR")
      ] ?? multiStitchDecrease[2];

    return `${multiStitchDecrease[1]}M (decrease ${decreaseCount} stitches together), ${multiStitchDecrease[3]}sc${multiStitchDecrease[4]}`;
  }

  const stitchCountChainCut =
    /^(\s*(?:\d+\)\s*)?)(\d+)\s*x\s*[,，]\s*(\d+)\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz([.]?\s*)$/iu.exec(
      source,
    );

  if (stitchCountChainCut) {
    return `${stitchCountChainCut[1]}${stitchCountChainCut[2]}sc. Ch ${stitchCountChainCut[3]} and cut the yarn${stitchCountChainCut[4]}`;
  }

  const yarnHeadingWithCut =
    /^(\s*✦\s*)?ekru\s+renk\s+ip\s+ile\s*[;:]?\s*\(\s*turuncu\s+ipimizi\s+kesiyoruz\s*[.]?\s*\)\s*$/iu.exec(
      source,
    );

  if (yarnHeadingWithCut) {
    const bullet = yarnHeadingWithCut[1] ? "✦ " : "";
    return `${bullet}With ecru yarn: (Cut the orange yarn.)`;
  }

  const writtenChainCut =
    /^(\s*(?:\d+(?:-\d+)?\)\s*)?)(\d+)\s+sıra\s+(\d+)\s*x\s+bir\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz([.]?\s*)$/iu.exec(
      source,
    );

  if (writtenChainCut) {
    const roundWord =
      Number(writtenChainCut[2]) === 1 ? "round" : "rounds";

    return `${writtenChainCut[1]}${writtenChainCut[2]} ${roundWord}, ${writtenChainCut[3]}sc. Ch 1 and cut the yarn${writtenChainCut[4]}`;
  }

  const continueWithArmJoining =
    /^(\s*(?:\d+(?:-\d+)?\)\s*)?)(\d+)\s+sıra\s+(\d+)\s*x\s*[,，]\s*[iİ]pimizi\s+kesmeden\s+kol\s+birleştirme\s+ile\s+devam\s+ediyoruz([.]?\s*)$/iu.exec(
      source,
    );

  if (continueWithArmJoining) {
    const roundWord =
      Number(continueWithArmJoining[2]) === 1 ? "round" : "rounds";

    return `${continueWithArmJoining[1]}${continueWithArmJoining[2]} ${roundWord}, ${continueWithArmJoining[3]}sc. Without cutting the yarn, continue by joining the arms${continueWithArmJoining[4]}`;
  }

  const armJoiningHeading =
    /^\s*⊱\s*kol\s+b[iİIı]rleşt[iİIı]rme\s*⊰\s*$/iu.test(source);

  if (armJoiningHeading) {
    return "⊱ARM JOINING⊰";
  }

  const legJoinInstruction =
    /^(\s*✦\s*)?[iİ]kinci\s+bacaktan\s+(\d+)\s+zincir\s+ile\s+bacakların\s+arka\s+tarafı\s+bize\s+dönük\s+olacak\s+şekilde\s+ilk\s+bacak\s+ile\s+birleştiriyoruz([.]?\s*)$/iu.exec(
      source,
    );

  if (legJoinInstruction) {
    const bullet = legJoinInstruction[1] ? "✦ " : "";
    return `${bullet}From the second leg, ch ${legJoinInstruction[2]} and join to the first leg with the backs of the legs facing you${legJoinInstruction[3]}`;
  }

  const joinedLegRound =
    /^(\s*(?:\d+\)\s*)?)(\d+)\s*x\s*\(\s*ilk\s+bacak\s*\)\s*[,，]\s*(\d+)\s*x\s*\(\s*zincir\s+üstü\s*\)\s*[,，]\s*(\d+)\s*x\s*\(\s*ikinci\s+bacak\s*\)\s*[,，]\s*(\d+)\s*x\s*\(\s*zincir\s+üstü\s*\)\s+ilmek\s+belirleyiciyi\s+buraya\s+takıyoruz[.]\s*başlangıç\s+noktamız\s+burası\s+olacak\s*=\s*(\d+)\s*x\s*$/iu.exec(
      source,
    );

  if (joinedLegRound) {
    return `${joinedLegRound[1]}${joinedLegRound[2]}sc (first leg), ${joinedLegRound[3]}sc (along the chain), ${joinedLegRound[4]}sc (second leg), ${joinedLegRound[5]}sc (along the chain) = ${joinedLegRound[6]}sc. ${STITCH_MARKER_INSTRUCTION}`;
  }

  const legAlignmentGuidance =
    /^(\s*✦\s*)?bende\s+her\s+iki\s+bacağın\s+bitiş\s+noktası\s+bacağın\s+iç\s+kısmının\s+ortasına\s+denk\s+geldi[.]\s*sizde\s+denk\s+gelmiyorsa\s+(\d+)-(\d+)\s+sık\s+iğne\s+eksik\s+ya\s+da\s+fazla\s+örerek\s+orta\s+noktaya\s+gelin([.]?\s*)$/iu.exec(
      source,
    );

  if (legAlignmentGuidance) {
    const bullet = legAlignmentGuidance[1] ? "✦ " : "";
    return `${bullet}For me, the finishing point of both legs aligned with the center of the inner side of each leg. If yours does not align, work ${legAlignmentGuidance[2]}-${legAlignmentGuidance[3]} fewer or additional single crochet stitches to reach the center${legAlignmentGuidance[4]}`;
  }

  const secondLegSameRounds =
    /^(\s*✦\s*)?[iİ]kinci\s+bacakta\s+(?:da\s+)?ilk\s+(\d+)\s+sırayı\s+aynı\s+şekilde\s+örüyoruz([.]?\s*)$/iu.exec(
      source,
    );

  if (secondLegSameRounds) {
    const bullet = secondLegSameRounds[1] ? "✦ " : "";
    const rounds = secondLegSameRounds[2] ?? "";
    const roundWord = Number(rounds) === 1 ? "round" : "rounds";

    return `${bullet}On the second leg, work the first ${rounds} ${roundWord} in the same way${secondLegSameRounds[3]}`;
  }

  const continueBodyWithoutCutting =
    /^(\s*(?:\d+\)\s*)?)(\d+)\s*x\s+örüyoruz\s*[,，]\s*ipimizi\s+kesmeden\s+gövde\s+ile\s+devam\s+ediyoruz([.]?\s*)$/iu.exec(
      source,
    );

  if (continueBodyWithoutCutting) {
    return `${continueBodyWithoutCutting[1]}Work ${continueBodyWithoutCutting[2]}sc, then continue with the body without cutting the yarn${continueBodyWithoutCutting[3]}`;
  }

  const legStuffingGuidance =
    /^\s*(✦\s*)?bacakları\s+örerken\s+(\d+)-(\d+)\s+sırada\s+bir\s+dolum\s+yapalım[.]\s*doldururken\s+görselde\s+görüldüğü\s+gibi\s+örgünün\s+dönmemesine\s+dikkat\s+edelim[.]\s*\(\s*dolum\s+yaptıkça\s+elimizle\s+örgüyü\s+sürekli\s+düzeltirsek\s*[,，]\s*örgümüz\s+dönmez\s+ve\s+bacaklar\s+çok\s+muntazam\s+olur[.]\s*\)\s*$/iu.exec(
      source,
    );

  if (legStuffingGuidance) {
    const bullet = legStuffingGuidance[1] ? "✦ " : "";
    const start = legStuffingGuidance[2];
    const end = legStuffingGuidance[3];

    return `${bullet}While crocheting the legs, add stuffing every ${start}-${end} rounds. While stuffing, make sure the work does not twist, as shown in the image. (If you keep straightening the work with your hands as you stuff, it will not twist and the legs will look much neater.)`;
  }

  const shortLoopRound =
    /^(\s*(?:\d+\)\s*)?)(FLO|BLO)\s*[‘’'`´]?\s*dan\s+([\s\S]+)$/iu.exec(
      source,
    );

  if (shortLoopRound) {
    const loop = shortLoopRound[2]?.toUpperCase();
    return translated.replace(
      new RegExp(`^(${shortLoopRound[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})?${loop}\\s+from\\s+`, "iu"),
      `${shortLoopRound[1]}In ${loop}, `,
    );
  }

  const hairStrandContinuation =
    /^(\s*(?:\d+\)\s*)?)(\d+)\s*x\s+örüyoruz\s+ipimizi\s+kesmeden\s+saç\s+telleri\s+ile\s+devam\s+ediyoruz([.]?\s*)$/iu.exec(
      source,
    );

  if (hairStrandContinuation) {
    return `${hairStrandContinuation[1]}${hairStrandContinuation[2]}sc. Without cutting the yarn, continue with the hair strands${hairStrandContinuation[3]}`;
  }

  const hookWithBrandedColorYarn =
    /^(\s*✦\s*)?(\d+(?:[.,]\d+)?)\s+(?:numara|no)\s+tığ\s*[,，]\s*mor\s+renk\s*\(\s*([^)]+?)\s*\)\s+ip\s+ile\s+örüyoruz[.]?\s*$/iu.exec(
      source,
    );

  if (hookWithBrandedColorYarn) {
    const bullet = hookWithBrandedColorYarn[1] ? "✦ " : "";
    const size = hookWithBrandedColorYarn[2];
    const brand = hookWithBrandedColorYarn[3]?.trim();

    return `${bullet}Using a ${size} mm crochet hook and purple yarn (${brand}), work as follows.`;
  }

  const hookAndStartingYarn =
    /^\s*(✦\s*)?(\d+(?:[.,]\d+)?)\s+(?:numara|no|mm)\s+tığ\s+ile\s+örüyoruz[.]\s+ekru\s+renk\s+ip\s*\(\s*([^)]+?)\s*\)\s+ile\s+başlıyoruz[.]?\s*$/iu.exec(
      source,
    );

  if (hookAndStartingYarn) {
    const bullet = hookAndStartingYarn[1] ? "✦ " : "";
    const size = hookAndStartingYarn[2];
    const brand = hookAndStartingYarn[3]?.trim();

    return `${bullet}Using a ${size} mm crochet hook, work as follows. Start with ecru yarn (${brand}).`;
  }

  const yarnColorChange =
    /^\s*(✦\s*)?turuncu\s+ipimize\s*\(\s*([^)]+?)\s*\)\s+geçiyoruz[.]\s*renk\s+geçişlerinde\s+bir\s+önceki\s+ipi\s+kesmeden\s*[,，]\s*içeride\s+beklemeye\s+alıyoruz[.]?\s*$/iu.exec(
      source,
    );

  if (yarnColorChange) {
    const bullet = yarnColorChange[1] ? "✦ " : "";
    const brand = yarnColorChange[2]?.trim();

    return `${bullet}Switch to orange yarn (${brand}). When changing colors, do not cut the previous yarn; leave it inside until needed again.`;
  }

  const yarnColorHeading =
    /^\s*(✦\s*)?(ekru\s+renk|turuncu)\s+ip\s+ile\s*[;:]?\s*$/iu.exec(
      source,
    );

  if (yarnColorHeading) {
    const bullet = yarnColorHeading[1] ? "✦ " : "";
    const color =
      yarnColorHeading[2]?.toLocaleLowerCase("tr-TR") === "turuncu"
        ? "orange"
        : "ecru";

    return `${bullet}With ${color} yarn:`;
  }

  const roundCount = parseBareRoundCountSourceLine(source);
  if (roundCount) {
    return renderEnglishBareRoundCountLine(roundCount, "sc");
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

  const referenceImageEmbroidery =
    /^\s*(?:✦\s*)?(kaşları\s+ve\s+)?kirpikleri\s+görsele\s+bakarak\s+işleyebiliriz[.]?\s*$/iu.exec(
      source,
    );

  if (referenceImageEmbroidery) {
    const leading = source.match(/^\s*(?:✦\s*)?/u)?.[0] ?? "";
    const prefix = leading.includes("✦") ? "✦ " : "";

    return referenceImageEmbroidery[1]
      ? `${prefix}Embroider the eyebrows and eyelashes following the reference image.`
      : `${prefix}Embroider the eyelashes following the reference image.`;
  }

  const completeDirectionalEarPlacement =
    /^\s*(?:✦\s*)?(?:kulak\s*[-–—]\s*)?kirpik\s+bitiminden\s+(\d+)\s*x\s+sayıyoruz\s*[,，]\s*(\d+)\s*x\s*[,，]\s*(\d+)\s*dc\s*[,，]\s*(\d+)\s*x\s+yukarıdan\s+aşağı\s+doğru\s+örüyoruz[.]\s*diğer\s+kulağı\s+da\s+aynı\s+şekilde\s+aşağıdan\s+yukarı\s+doğru\s+örüyoruz[.]?\s*$/iu.exec(
      source,
    );

  if (completeDirectionalEarPlacement) {
    const [, offset, firstSc, dc, lastSc] =
      completeDirectionalEarPlacement;

    const leadingBullet = /^\s*✦/u.test(source) ? "✦ " : "";
    const earPrefix = /\bkulak\s*[-–—]/iu.test(source)
      ? "Ear - "
      : "";
    const stitchWord =
      Number(offset) === 1 ? "stitch" : "stitches";

    return `${leadingBullet}${earPrefix}Count ${offset} ${stitchWord} from the end of the eyelashes. Work ${firstSc}sc, ${dc}dc, ${lastSc}sc from top to bottom. Work the other ear in the same way, from bottom to top.`;
  }

  const directionalEarPlacement =
    /^\s*(?:✦\s*)?(?:kulak\s*[-–—]\s*)?kirpik\s+bitiminden\s+(\d+)\s*x\s+sayıyoruz\s*[,，]\s*(\d+)\s*x\s*[,，]\s*(\d+)\s*dc\s*[,，]\s*(\d+)\s*x\s+yukarıdan\s+aşağı\s+doğru\s+örüyoruz[.]?\s*$/iu.exec(
      source,
    );

  if (directionalEarPlacement) {
    const [, offset, firstSc, dc, lastSc] = directionalEarPlacement;
    const leadingBullet = /^\s*✦/u.test(source) ? "✦ " : "";
    const earPrefix = /\bkulak\s*[-–—]/iu.test(source) ? "Ear - " : "";
    const stitchWord = Number(offset) === 1 ? "stitch" : "stitches";

    return `${leadingBullet}${earPrefix}Count ${offset} ${stitchWord} from the end of the eyelashes. Work ${firstSc}sc, ${dc}dc, ${lastSc}sc from top to bottom.`;
  }

  if (
    /^\s*diğer\s+kulağı\s+da\s+aynı\s+şekilde\s+aşağıdan\s+yukarı\s+doğru\s+örüyoruz[.]?\s*$/iu.test(
      source,
    )
  ) {
    return "Work the other ear in the same way, from bottom to top.";
  }

  if (isStitchMarkerInstruction(source)) {
    const marker = source.match(/^\s*(?:\d+\)\s*)?/u)?.[0] ?? "";
    return `${marker}${STITCH_MARKER_INSTRUCTION}`;
  }

  if (
    /gözleri[^.!?\n]{0,80}(?:takacağız|takıyoruz|yerleştirebiliriz|yerleştiriyoruz)/iu.test(
      source,
    )
  ) {
    return translated
      .replace(
        /\b(?:attach|place|position) the eyes\b/giu,
        "insert the eyes",
      )
      .replace(/\binsert the eyes in\b/giu, "insert the eyes into")
      .replace(
        /\binsert the eyes into (?:the )?(?:gaps|spaces)\b/giu,
        "insert the eyes into the chain spaces",
      );
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
