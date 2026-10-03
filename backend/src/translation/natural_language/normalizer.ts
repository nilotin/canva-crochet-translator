import type { TargetLanguage } from "../types.js";
import {
  ARM_JOINING_SOURCE_PATTERN,
  COMPACT_CHAIN_CUT_SOURCE_PATTERN,
  legacyCourseUnitResolver,
  parseBareRoundCountSourceLine,
  parseCourseCountClauseLine,
  renderEnglishArmJoiningSpan,
  renderEnglishBareRoundCountLine,
  renderEnglishGenericCourseCountSpan,
  renderEnglishRoundCountTrailingActionSpan,
  renderEnglishRoundCountYarnCutSpan,
  renderEnglishWorkedChainCutSpan,
  renderEnglishWrittenChainCutSpan,
  scanCompactChainCutSourceSpans,
  scanGenericCourseCountSourceSpans,
  scanRoundCountTrailingActionSourceSpans,
  scanRoundCountYarnCutSourceSpans,
  scanWorkedChainCutSourceSpans,
  scanWrittenChainCutSourceSpans,
  splitLogicalLines,
  type CourseUnitResolver,
} from "./bare_round_count.js";
import {
  translateTurkishYarnColor,
  TURKISH_YARN_COLOR_PATTERN,
} from "./yarn_colors.js";
import { renderEnglishSleeveInstruction } from "./sleeve_instructions.js";

const targetPhrase = (
  targetLanguage: TargetLanguage,
  english: string,
  spanish: string,
) => (targetLanguage === "en" ? english : spanish);


const fullyResolvedChainSkipContinueAndFinishPattern =
  /^\s*\d+\s+zincir\s*[,，]?\s*\d+\s*x\s+atla\s*[,，]?\s*sıradaki\s+sık\s+iğneye\s+\d+\s*x\s*[,，]?\s*bu\s+şekilde\s+sıra\s+sonuna\s+kadar\s+devam\s+ediyoruz\s*\.\s*sıra\s+sonuna\s+geldiğimizde\s+\d+\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz\s*[.]?\s*$/iu;

const fullyResolvedReferencedLoopStitchCountPattern =
  /^\s*(?:(?:görselde\s+görüldüğü\s+gibi)\s+)?\d+\.\s*sıra(?:da|nın)\s+(?:FLO|BLO)\s*[’'ʼ]?\s*(?:dan|den)\s+ördüğümüz\s+sık\s+iğne(?:lerin|lerinin)\s*[,，]?\s*(?:FLO|BLO)\s*[’'ʼ]?\s*(?:sundan|sından|dan|den)\s*[,，]?\s*\d+\s*x\s+(?:örüp|örüyoruz|örerek)\s+devam\s+ediyoruz\s*[,，]?\s*\d+\s*x(?:\s*=\s*\d+\s*x)?\s*[.]?\s*$/iu;

const fullyResolvedChainTurnSlipStitchContinuationPattern =
  /^\s*\d+\s+zincir\s+çekip\s+(?:geriye\s+)?dönüyoruz\s*[,，.]\s*(?:zincir\s+üzerine\s+)?(?:birinci|ikinci|üçüncü|dördüncü|beşinci|altıncı|yedinci|sekizinci|dokuzuncu|onuncu)\s+zincirden\s+itibaren\s+\d+\s*(?:x|hdc|sc|dc|tr)\s*[,，]\s*\d+\s*x\s+atla\s*[,，]?\s*sıradaki\s+(?:sık\s+iğneye|ilmeğe)\s+cc\s*[,，]\s*tekrar\s+(?:sıradaki|sırdaki)\s+(?:sık\s+iğneye|ilmeğe)\s+cc(?:\s+yapıyoruz)?\s*[.]\s*bu\s+şekilde\s+sıra\s+sonuna\s+kadar\s+devam\s+ediyoruz\s*[.]\s*sıra\s+sonuna\s+geldiğimizde\s+\d+\s+zincir\s+çekiyoruz\s*[.]?\s*$/iu;

export type SourceNaturalLanguageNormalization = {
  text: string;
  fullyResolved: boolean;
};

const englishOrdinal = (raw: string): string => {
  const value = Number.parseInt(raw, 10);
  const mod100 = value % 100;

  if (mod100 >= 11 && mod100 <= 13) {
    return `${value}th`;
  }

  const suffix =
    value % 10 === 1
      ? "st"
      : value % 10 === 2
        ? "nd"
        : value % 10 === 3
          ? "rd"
          : "th";

  return `${value}${suffix}`;
};

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

/** Plain "sıra sonunda / sıra sonlarında N zincir çekip dönüyoruz", never after "bütün". */
const COURSE_END_TURN_PATTERN =
  /(?<!\bbütün\s+)\bsıra\s+(sonunda|sonlarında)\s+(\d+)\s+zincir\s+çekip\s+dönüyoruz\b[.]?/giu;

type OriginalSourceReplacement = {
  start: number;
  end: number;
  text: string;
};

const normalizeEnglishRoundCountStructures = (
  source: string,
  sourceContext: string,
  sourceOffset: number,
  resolveCourseUnit: CourseUnitResolver,
): string => {
  const replacements: OriginalSourceReplacement[] = [];

  // Every course-count family below is scanned on the immutable source text,
  // so resolver offsets cannot drift after earlier normalization replacements.
  // Worked chain-cut: "N sıra Mx örüyoruz, K zincir çekip ipimizi kesiyoruz".
  for (const span of scanWorkedChainCutSourceSpans(source)) {
    replacements.push({
      start: span.start,
      end: span.end,
      text: renderEnglishWorkedChainCutSpan(
        span,
        resolveCourseUnit(sourceContext, sourceOffset + span.start),
      ),
    });
  }

  // Written-chain yarn cut: "N sıra Mx bir zincir çekip ipimizi kesiyoruz".
  for (const span of scanWrittenChainCutSourceSpans(source)) {
    replacements.push({
      start: span.start,
      end: span.end,
      text: renderEnglishWrittenChainCutSpan(
        span,
        resolveCourseUnit(sourceContext, sourceOffset + span.start),
      ),
    });
  }

  for (const span of scanRoundCountTrailingActionSourceSpans(source)) {
    replacements.push({
      start: span.start,
      end: span.end,
      text: renderEnglishRoundCountTrailingActionSpan(
        span,
        "x",
        resolveCourseUnit(
          sourceContext,
          sourceOffset + span.start,
        ),
      ),
    });
  }

  for (const span of scanRoundCountYarnCutSourceSpans(source)) {
    replacements.push({
      start: span.start,
      end: span.end,
      text: renderEnglishRoundCountYarnCutSpan(
        span,
        "x",
        resolveCourseUnit(
          sourceContext,
          sourceOffset + span.start,
        ),
      ),
    });
  }

  for (const line of splitLogicalLines(source)) {
    const armJoining = parseCourseCountClauseLine(
      ARM_JOINING_SOURCE_PATTERN,
      line.text,
    );
    if (armJoining) {
      // Resolve against immutable source coordinates, before earlier text
      // replacements can change lengths. Reuse the final renderer's grammar.
      replacements.push({
        start: line.start,
        end: line.end,
        text: renderEnglishArmJoiningSpan(
          armJoining,
          "x",
          resolveCourseUnit(sourceContext, sourceOffset + line.start),
        ),
      });
      continue;
    }

    const parsed = parseBareRoundCountSourceLine(line.text);
    if (!parsed) continue;

    replacements.push({
      start: line.start,
      end: line.end,
      text: renderEnglishBareRoundCountLine(
        parsed,
        "x",
        resolveCourseUnit(
          sourceContext,
          sourceOffset + line.start,
        ),
      ),
    });
  }

  // The generic "N sıra Mx" count is the fallback for every course count no
  // specialized family claimed. It keeps its former precedence: no span
  // already claimed above, and none the earlier chain replacements would
  // consume. Each count asks the resolver at its own source offset.
  const claimed = [
    ...replacements,
    ...scanCompactChainCutSourceSpans(source),
  ];
  for (const span of scanGenericCourseCountSourceSpans(source)) {
    if (claimed.some(({ start, end }) => span.start < end && start < span.end)) continue;
    replacements.push({
      start: span.start,
      end: span.end,
      text: renderEnglishGenericCourseCountSpan(
        span,
        "x",
        resolveCourseUnit(sourceContext, sourceOffset + span.start),
      ),
    });
  }

  replacements.sort((left, right) => {
    if (left.start !== right.start) return right.start - left.start;
    return right.end - left.end;
  });

  let normalized = source;
  let rightmostStart = source.length;

  for (const replacement of replacements) {
    if (
      replacement.start < 0 ||
      replacement.end < replacement.start ||
      replacement.end > source.length
    ) {
      continue;
    }

    // All spans were discovered against the same immutable source.
    // If two recognized families ever overlap, keep the later/more-specific
    // replacement already applied and fail closed on the overlapping one.
    if (replacement.end > rightmostStart) {
      continue;
    }

    normalized =
      normalized.slice(0, replacement.start) +
      replacement.text +
      normalized.slice(replacement.end);

    rightmostStart = replacement.start;
  }

  return normalized;
};

const normalizeEnglishCrochetStructures = (
  source: string,
  targetLanguage: TargetLanguage,
  sourceContext: string = source,
  sourceOffset = 0,
  resolveCourseUnit: CourseUnitResolver = legacyCourseUnitResolver,
): string => {
  if (targetLanguage !== "en") return source;

  return normalizeEnglishRoundCountStructures(
    source,
    sourceContext,
    sourceOffset,
    resolveCourseUnit,
  )
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
      COMPACT_CHAIN_CUT_SOURCE_PATTERN,
      (
        _match,
        marker: string,
        stitches: string,
        chains: string,
      ) => `${marker}${stitches}sc. Ch ${chains} and cut the yarn`,
    )
    .replace(
      /\b(\d+)\.\s*sıranın\s+sonunda\s+(\d+)\s+zincir\s*\(\s*düğme\s+iliği\s*\)\s*dön\b/giu,
      (_match, round: string, chains: string) =>
        `At the end of Round ${round}, ch ${chains} (buttonhole) and turn.`,
    )
    .replace(
      /\b(\d+)\s*x\s*[-–—]\s*(\d+)\s+zincir\s*\(\s*düğme\s+iliği\s*\)\s*dön\b/giu,
      (_match, stitches: string, chains: string) =>
        `${stitches}x, ch ${chains} (buttonhole) and turn`,
    )
    .replace(
      // Long-form buttonhole guidance. Resolve the structural skip action and
      // its explanatory advice together so a provider cannot mechanically
      // reconstruct the parenthetical sentence around the deterministic count.
      /\b(\d+)\s+zincir\s+atlıyoruz\s*\(\s*düğme\s+iliği\s+oluşturuyoruz\s*[.]\s*düğme\s+iliği\s+için\s+çektiğimiz\s+zincir\s+sayısını\s*[,，]?\s*kullanacağınız\s+düğme\s+boyutuna\s+göre\s+(?:artırıp|arttırıp)\s+ya\s+da\s+azaltabilirsiniz\s*[.]?\s*\)/giu,
      (_match, chains: string) =>
        `Skip ${chains} chains (to form a buttonhole; you can increase or decrease the number of chains depending on the size of the button you will use).`,
    )
    .replace(
      // Standalone buttonhole chain annotation, e.g. "6 zincir (düğme iliği)".
      /\b(\d+)\s+zincir\s*\(\s*düğme\s+iliği\s*\)/giu,
      (_match, chains: string) => `ch ${chains} (buttonhole)`,
    )
    .replace(
      /(^|[\r\n])(\s*(?:\d+\)\s*)?)(?:görselde\s+görüldüğü\s+gibi\s+)?dışa\s+kıvırmak\s+için\s+ördüğümüz\s+kısmın\s+çevresini\s+simli\s+ip\s+ile\s+(\d+)\s+zincir\s*[,，]\s*sıradaki\s+sık\s+iğneye\s+cc\s*[,，]?\s*yaparak\s+dönüyoruz\s*[.]\s*tüm\s+çevreyi\s+ördükten\s+sonra\s+(\d+)\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz\s*[.]?(?=$|[\r\n])/gimu,
      (
        _match,
        lineStart: string,
        prefix: string,
        repeatedChains: string,
        finalChains: string,
      ) =>
        `${lineStart}${prefix}As shown in the image, work around the edge of the section crocheted to fold outward with metallic yarn, making ch ${repeatedChains} and cc into the next single crochet as you go. ` +
        `After working around the entire edge, ch ${finalChains} and cut the yarn.`,
    )
    .replace(
      /(^|[\r\n])(\s*(?:\d+\)\s*)?)(?:görselde\s+görüldüğü\s+gibi\s+)?kol\s+boşluğunun\s+arka\s+tarafından\s+ipimizi\s+sabitliyoruz\s*[.]\s*(\d+)\s*x\s+örüyoruz\s*[.]\s*başlangıç\s+noktamız\s+burası\s+olacak\s*[,，]\s*(?:işaretleyiciyi|işaretleyicimizi|markerı|markeri)\s+buraya\s+(?:takıyoruz|yerleştiriyoruz|koyuyoruz)\s*[.]?(?=$|[\r\n])/gimu,
      (_match, lineStart: string, prefix: string, stitches: string) =>
        `${lineStart}${prefix}As shown in the image, attach the yarn from the back of the armhole. Work ${stitches}x. This will be the beginning of the round; place a stitch marker here.`,
    )
    .replace(
      /(^|[\r\n])(\s*(?:\d+\)\s*)?)(\d+)\s*x\s+örüyoruz\s*\(\s*kolun\s+üzerindeki\s+dışa\s+doğru\s+kıvırdığımız\s+kısmı\s+öreceğiz\s*\)\s*[.]\s*görselde\s+görüldüğü\s+gibi\s+ben\s+(\d+)\s*x\s+ördüğümde\s+tam\s+kolun\s+üzerine\s+denk\s+geldi\s*[.]\s*sizde\s+kolun\s+üst\s+kısmına\s+denk\s+gelecek\s+şekilde\s+(\d+)-(\d+)\s+sık\s+iğne\s+eksik\s+ya\s+da\s+fazla\s+örebilirsiniz\s*[.]\s*(\d+)\s+zincir\s+çekip\s+dönüyoruz\s*[.]?(?=$|[\r\n])/gimu,
      (
        _match,
        lineStart: string,
        prefix: string,
        firstStitches: string,
        alignedStitches: string,
        minAdjustment: string,
        maxAdjustment: string,
        chains: string,
      ) =>
        `${lineStart}${prefix}Work ${firstStitches}x (we will crochet the section folded outward over the arm). ` +
        `As shown in the image, when I worked ${alignedStitches}x, it aligned exactly over the arm. ` +
        `You can work ${minAdjustment}-${maxAdjustment} fewer or additional single crochet stitches so that it aligns with the top of the arm. ` +
        `Ch ${chains} and turn.`,
    )
    .replace(
      // "Bütün sıra sonlarında" is explicit back-and-forth row guidance.
      /\bbütün\s+sıra\s+sonlarında\s+(\d+)\s+zincir\s+çekip\s+dönüyoruz\b[.]?/giu,
      (_match, chains: string) =>
        `At the end of each row, ch ${chains} and turn.`,
    )
    .replace(
      // Plain "sıra sonunda/sonlarında ... dönüyoruz" turns at the course end
      // but does not say whether the course is a row or a turned round, so it
      // stays unit-neutral. "Bütün sıra ..." (explicit row guidance) is handled
      // above and never reaches this rule.
      COURSE_END_TURN_PATTERN,
      (_match, ending: string, chains: string) =>
        ending.toLocaleLowerCase("tr-TR") === "sonunda"
          ? `When you reach the end, ch ${chains} and turn.`
          : `Each time you reach the end, ch ${chains} and turn.`,
    )
    .replace(
      /\b(\d+)\s+zincir\s*,?\s*dön\b/giu,
      (_match, count: string) => `Ch ${count} and turn`,
    )
    .replace(
      /\b(\d+)\s+zincir\s+çekip\s+(?:geriye\s+)?dönüyoruz\s*[,，.]?/giu,
      (_match, count: string) => `Ch ${count} and turn.`,
    )
    .replace(
      /(^|[^\p{L}\p{N}_])(\d+)\s+zincir\s+atlayıp\s*\(\s*düğme\s+iliği\s+oluşturuyoruz\s*\)\s*[,，]?\s*(birinci|ikinci|üçüncü|dördüncü|beşinci|altıncı|yedinci|sekizinci|dokuzuncu|onuncu)\s+zincirden\s+itibaren\s+(\d+)\s*x(?:\s+örüyoruz)?\b/giu,
      (
        _match,
        prefix: string,
        chains: string,
        ordinalSource: string,
        stitches: string,
      ) => {
        const ordinals: Record<string, string> = {
          birinci: "first",
          ikinci: "second",
          üçüncü: "third",
          dördüncü: "fourth",
          beşinci: "fifth",
          altıncı: "sixth",
          yedinci: "seventh",
          sekizinci: "eighth",
          dokuzuncu: "ninth",
          onuncu: "tenth",
        };

        const ordinal =
          ordinals[ordinalSource.toLocaleLowerCase("tr-TR")];

        return `${prefix}Skip ${chains} chains (to form a buttonhole), then work ${stitches}x starting from the ${ordinal} chain`;
      },
    )
    .replace(
      /\b(\d+)\s+zincir\s+atlayıp\b/giu,
      (_match, count: string) => `Skip ${count} chains and`,
    )
    .replace(
      /\b(\d+)\s+zincir\s+atlıyoruz\b/giu,
      (_match, count: string) => `skip ${count} chains`,
    )
    .replace(
      /\b(?:zincir\s+üzerine\s+)?(\d+)\.\s*zincirden\s+itibaren\s+(\d+)\s*x\b/giu,
      (_match, chain: string, stitches: string) =>
        `Starting from the ${englishOrdinal(chain)} chain, work ${stitches}x`,
    )
    .replace(
      // Optional "zincir üzerine" prefix (as the numeric-ordinal sibling
      // above already allows) and, alongside the generic "Nx" multiplier
      // notation, compact stitch-abbreviation notation ("18hdc", "18sc",
      // "18dc", "18tr") directly -- preserved verbatim rather than forced
      // through the "x" multiplier form.
      /(^|[^\p{L}\p{N}_])(?:zincir\s+üzerine\s+)?(birinci|üçüncü|dördüncü|beşinci|altıncı|yedinci|sekizinci|dokuzuncu|onuncu)\s+zincirden\s+itibaren\s+(\d+)\s*(x|hdc|sc|dc|tr)(?:\s+örüyoruz)?\b/giu,
      (
        _match,
        prefix: string,
        ordinalSource: string,
        stitches: string,
        stitchAbbreviation: string,
      ) => {
        const ordinals: Record<string, string> = {
          birinci: "first",
          üçüncü: "third",
          dördüncü: "fourth",
          beşinci: "fifth",
          altıncı: "sixth",
          yedinci: "seventh",
          sekizinci: "eighth",
          dokuzuncu: "ninth",
          onuncu: "tenth",
        };

        const ordinal =
          ordinals[ordinalSource.toLocaleLowerCase("tr-TR")];

        return `${prefix}Starting from the ${ordinal} chain, work ${stitches}${stitchAbbreviation}`;
      },
    )
    .replace(
      /\b(?:zincir\s+üzerine\s+)?ikinci\s+zincirden\s+(\d+)\s*x\s+örüyoruz\b/giu,
      (_match, stitches: string) =>
        `Starting from the second chain, work ${stitches}x along the chain`,
    )
    .replace(
      /\b(?:zincir\s+üzerine\s+)?ikinci\s+zincirden\s+itibaren(?=\s+\d+\s*x\b)/giu,
      "Starting from the second chain,",
    )
    .replace(
      /\b(?:zincir\s+üzerine\s+)?ikinci\s+zincirden\s+itibaren\b/giu,
      "Starting from the second chain",
    )
    .replace(
      /\bzincir\s+üzerine\s+(\d+)\s*x\b/giu,
      (_match, stitches: string) => `work ${stitches}x along the chain`,
    )
    .replace(
      /\baynı\s+ilmek\s+içine\s+(\d+)\s*x\b/giu,
      (_match, count: string) => `${count}sc in the same stitch`,
    )
    .replace(
      /\baynı\s+ilmek\s+içine\s+(\d+)\s*tr\b/giu,
      (_match, count: string) => `${count}tr in the same stitch`,
    )
    .replace(
      /\bzincirin\s+diğer\s+tarafından\s+devam\s+ediyoruz\b/giu,
      "continue along the other side of the chain",
    )
    .replace(
      /\b(\d+)\s+zincir\s+çekip\s+ördüğümüz\s+parçanın\s+iki\s+ucunu\s*[,，]?\s*görselde\s+görüldüğü\s+gibi\s+(cc|x|dc|tr)\s+ile\s+birleştiriyoruz\b/giu,
      (
        _match,
        chains: string,
        stitch: string,
      ) =>
        `Ch ${chains} and join the two ends of the piece with ${stitch} as shown in the image`,
    )
    .replace(
      /(^|[^\p{L}\p{N}_])(?:(görselde\s+görüldüğü\s+gibi)\s+)?başlangıç\s+noktamıza\s+(cc|x|dc|tr)\s+ile\s+birleştiriyoruz\b/giu,
      (
        _match,
        prefix: string,
        imageReference: string | undefined,
        stitch: string,
      ) =>
        `${prefix}Join to the starting point with ${stitch}${imageReference ? " as shown in the image" : ""}`,
    )
    .replace(
      /(^|[^\p{L}\p{N}_])(?:yine\s+bütün\s+)?sıra\s+sonlarında\s+(cc|x|dc|tr)\s+ile\s+birleştirip\s*[,，]?\s*(\d+)\s+zincir\s+çekip\s+bir\s+üst\s+sıraya\s+geçiyoruz\b/giu,
      (
        _match,
        prefix: string,
        stitch: string,
        chains: string,
      ) =>
        `${prefix}At the end of each round, join with ${stitch}, ch ${chains}, and continue to the next round`,
    )
    .replace(
      /\b(\d+)\s+zincir\s+çekip\s*[,，]?\s*bir\s+üst\s+sıradan\s+devam\s+ediyoruz\b/giu,
      (_match, chains: string) =>
        `Ch ${chains} and continue with the next round`,
    )
    .replace(
      /(^|[^\p{L}\p{N}_])(\d+)\s+zincir\s+çekip\s+devam\s+ediyoruz\b/giu,
      (_match, prefix: string, chains: string) =>
        `${prefix}Ch ${chains} and continue`,
    )
    .replace(
      /\bM\s*\(\s*aynı\s+anda\s+(bir|iki|üç|dört|beş|\d+)\s+ilmeği\s+birlikte\s+kesmek\s*\)/giu,
      (_match, countRaw: string) => {
        const wordCounts: Record<string, string> = {
          bir: "1",
          iki: "2",
          üç: "3",
          dört: "4",
          beş: "5",
        };
        const count =
          wordCounts[countRaw.toLocaleLowerCase("tr-TR")] ?? countRaw;

        return `M (decrease ${count} stitches together)`;
      },
    )
    .replace(
      /(\d+)\s+zincir\s+çekip\s+(?:geriye\s+)?dönüyoruz\b/giu,
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
      /\bsihirli\s+halka\s+içine\s+(\d+)\s*x\b(\s*[,，])?/giu,
      (_match, stitches: string, separator: string | undefined) =>
        `${stitches}x into the magic ring${separator ? "." : ""}`,
    )
    .replace(
      // Generic "Ch N, skip M sc into the next single crochet, continue to
      // the end of the round" instruction family. Matched (and fully
      // resolved) as one clause before the narrower standalone "N zincir,
      // Mx atla" rule below gets a chance to partially consume it, so the
      // whole sentence is rewritten together rather than word-by-word.
      /\b(\d+)\s+zincir\s*[,，]?\s*(\d+)\s*x\s+atla\s*[,，]?\s*sıradaki\s+sık\s+iğneye\s+(\d+)\s*x\s*[,，]?\s*bu\s+şekilde\s+sıra\s+sonuna\s+kadar\s+devam\s+ediyoruz\b[.]?/giu,
      (
        _match,
        chains: string,
        skip: string,
        work: string,
      ) =>
        // The skip count uses the project's existing "st/sts" wording (see
        // the narrower "N zincir, Mx atla" sibling below) rather than "sc":
        // the notation-integrity validator deliberately excludes an "x"
        // immediately followed by "atla" from its expected sc-count tally,
        // so rendering the skip count as "sc" here would introduce an
        // extra, unexpected "sc" and trip LOST_PATTERN_NOTATION.
        `Ch ${chains}, skip ${skip} ${skip === "1" ? "st" : "sts"}, work ${work}sc in the next single crochet. Continue in this way to the end of the round.`,
    )
    .replace(
      // Inflected sibling used in prose-style pattern instructions:
      // "N zincir çekip Mx atlıyoruz".
      /\b(\d+)\s+zincir\s+çekip\s+(\d+)\s*x\s+atlıyoruz\b/giu,
      (_match, chains: string, skip: string) =>
        `ch ${chains}, skip ${skip} ${skip === "1" ? "st" : "sts"}`,
    )
    .replace(
      // Narrower sibling of the family above for "N zincir, Mx atla" on its
      // own (no "sıradaki sık iğneye..." continuation). Uses the project's
      // existing "st/sts" wording for a plain skip count; singular vs.
      // plural is derived from the count instead of a hardcoded "sts" so a
      // count of 1 doesn't produce "skip 1 sts".
      /\b(\d+)\s+zincir\s*,?\s*(\d+)\s*x\s+atla\b/giu,
      (_match, chains: string, skip: string) =>
        `ch ${chains}, skip ${skip} ${skip === "1" ? "st" : "sts"}`,
    )
    .replace(
      // Sentence boundary after a repeated parenthesized action immediately
      // followed by the round-end finishing clause below, e.g.
      // "(1 zincir, sıradaki sık iğneye cc)*60, sıra sonuna geldiğimizde...".
      // Narrowly scoped to a "...)*N," directly before "sıra sonuna
      // geldiğimizde" -- not a global comma-to-period rewrite -- so a clean
      // ". " sentence break is produced instead of ", At the end of the
      // round...".
      /(\)\s*\*\s*\d+)\s*[,，]\s*(?=sıra\s+sonuna\s+geldiğimizde\b)/giu,
      "$1. ",
    )
    .replace(
      /\b(?:görselde\s+görüldüğü\s+gibi\s+)?kol\s+boşluğunun\s+arka\s+tarafından\s+ipimizi\s+sabitliyoruz\b[.]?/giu,
      (_match) =>
        "As shown in the image, attach the yarn from the back of the armhole.",
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
      /\b(?:bu(?:ras[ıi])?\s+(?:bizim\s+)?başlangıç\s+noktamız(?:dır|\s+olacak)?|burası\s+başlangıç\s+noktamız(?:dır|\s+olacak)?|başlangıç\s+noktamız\s+burası\s+olacak)\s*[;,.]?\s*(?:işaretleyiciyi|işaretleyicimizi|markerı|markeri)\s+buraya\s+(?:takıyoruz|yerleştiriyoruz|koyuyoruz)\b/giu,
      "This will be the beginning of the round; place a stitch marker here",
    )
    .replace(
      new RegExp(
        `(^|[^\\p{L}\\p{N}_])(${TURKISH_YARN_COLOR_PATTERN})\\s+(?:renk\\s+)?ip\\s*\\(\\s*([^)]+?)\\s*\\)\\s+ile\\s+başlıyoruz\\b`,
        "giu",
      ),
      (
        _match,
        prefix: string,
        colorSource: string,
        brand: string,
      ) => {
        const color = translateTurkishYarnColor(colorSource, "en");

        return color
          ? `${prefix}Start with ${color} yarn (${brand.trim()})`
          : _match;
      },
    )
    .replace(
      /\bekru\s+renk\s+ip\s*\(\s*([^)]+?)\s*\)\s+ile\s+başlıyoruz\b/giu,
      (_match, brand: string) =>
        `Start with ecru yarn (${brand.trim()})`,
    )
    .replace(
      /\bturuncu\s+ipimize\s*\(\s*([^)]+?)\s*\)\s+geçiyoruz\b/giu,
      (_match, brand: string) =>
        `Switch to orange yarn (${brand.trim()})`,
    )
    .replace(
      /(^|[^\p{L}\p{N}_])ördüğümüz\s+(tabanın|parçanın)\s+ters\s+yüzünü\s+çeviriyoruz\b/giu,
      (
        _match,
        prefix: string,
        itemSource: string,
      ) => {
        const items: Record<string, string> = {
          tabanın: "base",
          parçanın: "piece",
        };

        const item =
          items[itemSource.toLocaleLowerCase("tr-TR")];

        return `${prefix}Turn the crocheted ${item} inside out`;
      },
    )
    .replace(
      /(^|[^\p{L}\p{N}_])sık\s+iğnelerin\s+ters\s+yüzü\s+dışarıda\s*[,，]\s*düz\s+yüzü\s+içeride\s+kalacak\b/giu,
      (_match, prefix: string) =>
        `${prefix}The back of the single crochet stitches should face outward, and the front should face inward`,
    )
    .replace(
      /\brenk\s+geçişlerinde\s+bir\s+önceki\s+ipi\s+kesmeden\s*[,，]\s*içeride\s+beklemeye\s+alıyoruz\b/giu,
      "When changing colors, do not cut the previous yarn; leave it inside until needed again",
    )
    .replace(
      /\bekru\s+renk\s+ip\s+ile\s*[;:]?\s*\(\s*turuncu\s+ipimizi\s+kesiyoruz\s*[.]?\s*\)/giu,
      "With ecru yarn: (Cut the orange yarn.)",
    )
    .replace(
      /\bekru\s+renk\s+ip\s+ile\b/giu,
      "With ecru yarn",
    )
    .replace(
      /\bturuncu\s+ip\s+ile\b/giu,
      "With orange yarn",
    )
    .replace(
      /\bbacakları\s+örerken\s+(\d+)-(\d+)\s+sırada\s+bir\s+dolum\s+yapalım\b/giu,
      (_match, start: string, end: string) =>
        `While crocheting the legs, add stuffing every ${start}-${end} rounds`,
    )
    .replace(
      /\bdoldururken\s+görselde\s+görüldüğü\s+gibi\s+örgünün\s+dönmemesine\s+dikkat\s+edelim\b/giu,
      "While stuffing, make sure the work does not twist, as shown in the image",
    )
    .replace(
      /\bdolum\s+yaptıkça\s+elimizle\s+örgüyü\s+sürekli\s+düzeltirsek\s*[,，]\s*örgümüz\s+dönmez\s+ve\s+bacaklar\s+çok\s+muntazam\s+olur\b/giu,
      "If you keep straightening the work with your hands as you stuff, it will not twist and the legs will look much neater",
    )
    .replace(
      /(?<!\p{L})[iİ]kinci\s+bacakta\s+(?:da\s+)?ilk\s+(\d+)\s+sırayı\s+aynı\s+şekilde\s+örüyoruz(?!\p{L})/giu,
      (_match, rounds: string) =>
        `On the second leg, work the first ${rounds} ${rounds === "1" ? "round" : "rounds"} in the same way`,
    )
    .replace(
      /\b(\d+)\s*x\s+örüyoruz\s*[,，]\s*ipimizi\s+kesmeden\s+gövde\s+ile\s+devam\s+ediyoruz\b/giu,
      (_match, stitches: string) =>
        `Work ${stitches}sc, then continue with the body without cutting the yarn`,
    )
    .replace(
      /\bbende\s+her\s+iki\s+bacağın\s+bitiş\s+noktası\s+bacağın\s+iç\s+kısmının\s+ortasına\s+denk\s+geldi[.]\s*sizde\s+denk\s+gelmiyorsa\s+(\d+)-(\d+)\s+sık\s+iğne\s+eksik\s+ya\s+da\s+fazla\s+örerek\s+orta\s+noktaya\s+gelin\b/giu,
      (_match, min: string, max: string) =>
        `For me, the finishing point of both legs aligned with the center of the inner side of each leg. If yours does not align, work ${min}-${max} fewer or additional single crochet stitches to reach the center`,
    )
    .replace(
      /(?<!\p{L})[iİ]kinci\s+bacaktan\s+(\d+)\s+zincir\s+ile\s+bacakların\s+arka\s+tarafı\s+bize\s+dönük\s+olacak\s+şekilde\s+ilk\s+bacak\s+ile\s+birleştiriyoruz(?!\p{L})/giu,
      (_match, chains: string) =>
        `From the second leg, ch ${chains} and join to the first leg with the backs of the legs facing you`,
    )
    .replace(
      /(\d+)\s*x\s*\(\s*ilk\s+bacak\s*\)/giu,
      "$1sc (first leg)",
    )
    .replace(
      /(\d+)\s*x\s*\(\s*ikinci\s+bacak\s*\)/giu,
      "$1sc (second leg)",
    )
    .replace(
      /(\d+)\s*x\s*\(\s*zincir\s+üstü\s*\)/giu,
      "$1sc (along the chain)",
    )
    .replace(
      /⊱\s*kol\s+b[iİIı]rleşt[iİIı]rme\s*⊰/giu,
      "⊱ARM JOINING⊰",
    )
    .replace(
      /[,，]\s*[iİ]pimizi\s+kesmeden\s+kol\s+birleştirme\s+ile\s+devam\s+ediyoruz\b/giu,
      ". Without cutting the yarn, continue by joining the arms",
    )
    .replace(
      /(^|\n)(\s*(?:\d+\)\s*)?)(FLO|BLO)\s*[‘’'`´]\s*dan(?=\s)/gimu,
      (_match, lineStart: string, prefix: string, loop: string) =>
        `${lineStart}${prefix}In ${loop.toUpperCase()},`,
    )
    .replace(
      /\b(\d+)\s*x\s+örüyoruz\s+ipimizi\s+kesmeden\s+saç\s+telleri\s+ile\s+devam\s+ediyoruz\b/giu,
      (_match, stitches: string) =>
        `${stitches}sc. Without cutting the yarn, continue with the hair strands`,
    )
    .replace(
      /\bbaşlangıç\s+noktamız\s+burası\s+olacak\s*[.]\s*[iİ]şaretleyiciyi\s+buraya\s+takıyoruz\b/giu,
      "This will be the beginning of the round; place a stitch marker here",
    )
    .replace(
      /\byeniden\s+(\d+)\s+zincir\s+çekip\b/giu,
      (_match, chains: string) => `then ch ${chains} again and`,
    )
    .replace(
      /(^|(?:[.!?;]\s+)|(?:[\r\n]+\s*))(\d+)\s*(x|dc|tr)\s+örüyoruz\s*([.])?/giu,
      (
        _match,
        prefix: string,
        count: string,
        stitch: string,
        terminalPeriod: string | undefined,
      ) => `${prefix}Work ${count}${stitch}${terminalPeriod ? "." : ""}`,
    )
    .replace(
      // Canva may place the repeated action ("*N") and the following
      // round-end finishing clause in separate formatting regions. When
      // this translation unit therefore starts with the source comma,
      // promote that boundary to a sentence break instead of producing
      // ", At the end of the round...".
      /^\s*[,，]\s*(?=sıra\s+sonuna\s+geldiğimizde\b)/iu,
      ". ",
    )
    .replace(
      /\bsıra\s+sonuna\s+geldiğimizde\s+(\d+)\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz\b/giu,
      (_match, chains: string) =>
        `At the end of the round, ch ${chains} and cut the yarn`,
    )
    .replace(
      /\btüm\s+çevreyi\s+ördükten\s+sonra\s+(\d+)\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz\b/giu,
      (_match, chains: string) =>
        `After working around the entire edge, ch ${chains} and cut the yarn`,
    )
    .replace(
      /\b(\d+)\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz\b/giu,
      (_match, chains: string) => `ch ${chains} and cut the yarn`,
    )
    .replace(
      // "sıradaki sık iğneye cc" (single crochet, specifically) and its
      // generic-stitch sibling "sıradaki ilmeğe cc" both resolve to the same
      // English wording here -- neither names the stitch type in this
      // particular construction, so there is nothing to disambiguate.
      /\b(\d+)\s*x\s+atla\s*[,，]?\s*sıradaki\s+(?:sık\s+iğneye|ilmeğe)\s+cc\b/giu,
      (_match, count: string) =>
        `skip ${count}x, cc into the next stitch`,
    )
    .replace(
      // Standalone "tekrar sıradaki X'e cc yapıyoruz" (again, sl st into the
      // next X) -- factored as its own reusable atomic clause rather than
      // only existing embedded inside larger composite templates, so it
      // also applies to constructions those templates don't cover. Must run
      // before the bare "sıradaki X'e cc" fallbacks below, which would
      // otherwise consume the inner clause first and leave a dangling
      // "tekrar ... yapıyoruz".
      /\btekrar\s+(?:sıradaki|sırdaki)\s+(sık\s+iğneye|ilmeğe)\s+cc(?:\s+yapıyoruz)?\b/giu,
      (_match, stitchWord: string) =>
        `then cc into the following ${
          /ilmeğe/iu.test(stitchWord) ? "stitch" : "single crochet"
        }`,
    )
    .replace(
      /\b(\d+)\s+zincir\s*[,，]\s*sıradaki\s+sık\s+iğneye\s+cc\s*[,，]?\s*yaparak\s+dönüyoruz\b/giu,
      (_match, chains: string) =>
        `making ch ${chains} and cc into the next single crochet as you go`,
    )
    .replace(
      /\(\s*(\d+)\s+zincir\s*[,，]\s*sıradaki\s+sık\s+iğneye\s+cc\s*\)/giu,
      (_match, chains: string) =>
        `(ch ${chains}, cc into the next single crochet)`,
    )
    .replace(
      /\bsıradaki\s+sık\s+iğneye\s+cc\b/giu,
      "cc into the next single crochet",
    )
    .replace(/\bsıradaki\s+ilmeğe\s+cc\b/giu, "cc into the next stitch")
    .replace(
      // Standalone "bu şekilde sıra sonuna kadar devam ediyoruz" -- reuses
      // the same wording already used for this meaning inside the larger
      // composite continuation templates elsewhere in this file, so a
      // stand-alone occurrence of the clause renders identically.
      /\bbu\s+şekilde\s+sıra\s+sonuna\s+kadar\s+devam\s+ediyoruz\b/giu,
      "Continue in this way to the end of the round",
    )
    .replace(
      // No-yarn-cut sibling of the "sıra sonuna geldiğimizde N zincir çekip
      // ipimizi kesiyoruz" family above, for a mid-pattern round transition
      // that just chains N without finishing the piece.
      /\bsıra\s+sonuna\s+geldiğimizde\s+(\d+)\s+zincir\s+çekiyoruz\b/giu,
      (_match, chains: string) => `At the end of the round, ch ${chains}`,
    )
    .replace(
      /(^|[,;]\s+|[.!?]\s+)([^.!?;,]+?)\s+yerden\s+(\d+)\s*(cc|x|dc|tr)\s+atlıyoruz\b/giu,
      (
        _match,
        prefix: string,
        location: string,
        count: string,
        stitch: string,
      ) =>
        `${prefix}Skip ${count}${stitch} from ${location.trim()} yer`,
    )
    .replace(
      /(^|[^\p{L}\p{N}_])(\d+)\s*(cc|x|dc|tr)\s+atlıyoruz\b/giu,
      (
        _match,
        prefix: string,
        count: string,
        stitch: string,
      ) => `${prefix}Skip ${count}${stitch}`,
    )
    .replace(
      /(^|[^\p{L}\p{N}_])(birinci|[iİ]kinci|[üÜ]çüncü|dördüncü|beşinci|altıncı)\s+bacağın\s+bittiği\s+yerin\s+yanındaki\s+ilk\s+sık\s+iğneden\s+ipimizi\s+sabitliyoruz\b/giu,
      (
        _match,
        prefix: string,
        ordinalSource: string,
      ) => {
        const ordinals: Record<string, string> = {
          birinci: "first",
          ikinci: "second",
          üçüncü: "third",
          dördüncü: "fourth",
          beşinci: "fifth",
          altıncı: "sixth",
        };

        const ordinal =
          ordinals[ordinalSource.toLocaleLowerCase("tr-TR")];

        return `${prefix}Attach the yarn to the first single crochet next to where the ${ordinal} leg ends`;
      },
    )
    .replace(
      /(^|[^\p{L}\p{N}_])(?:(görselde\s+görüldüğü\s+gibi)\s+)?(yeşil|siyah|beyaz|kırmızı|mavi|sarı|mor|turuncu|pembe|kahverengi|gri|ekru)\s+ipimizi\s*[,，]?\s*(\d+)\.\s*sırada\s+(FLO|BLO)\s*[’'ʼ]?dan\s+ördüğümüz\s+sık\s+iğnelerin\s+(FLO|BLO)\s*[’'ʼ]?(?:sundan|sından|dan|den)\s*(?:\(\s*tabanın\s+ters\s+yüzünü\s+çevirdiğimiz\s+için\s+flo\s*[’'ʼ]?\s*lar\s+iç\s+kısımda\s+kaldı\s*\)\s*)?sabitliyoruz\s*[,，]\s*(\d+)\s*x\b/giu,
      (
        _match,
        prefix: string,
        imageReference: string | undefined,
        colorSource: string,
        round: string,
        workedLoop: string,
        attachmentLoop: string,
        stitches: string,
      ) => {
        const colors: Record<string, string> = {
          yeşil: "green",
          siyah: "black",
          beyaz: "white",
          kırmızı: "red",
          mavi: "blue",
          sarı: "yellow",
          mor: "purple",
          turuncu: "orange",
          pembe: "pink",
          kahverengi: "brown",
          gri: "gray",
          ekru: "ecru",
        };

        const color =
          colors[colorSource.toLocaleLowerCase("tr-TR")];

        return (
          `${prefix}Attach the ${color} yarn to the ${attachmentLoop.toUpperCase()} ` +
          `of the single crochet stitches worked in the ${workedLoop.toUpperCase()} of Round ${round}` +
          `${imageReference ? " as shown in the image" : ""} ` +
          `(because the base was turned inside out, the FLO loops remained on the inside), ` +
          `then work ${stitches}x`
        );
      },
    )
    .replace(
      /(^|[^\p{L}\p{N}_])(?:(görselde\s+görüldüğü\s+gibi)\s+)?(\d+)\.\s*sıra(?:da|nın)\s+(FLO|BLO)\s*[’'ʼ]?\s*(?:dan|den)\s+ördüğümüz\s+sık\s+iğne(?:lerin|lerinin)\s*[,，]?\s*(FLO|BLO)\s*[’'ʼ]?\s*(?:sundan|sından|dan|den)\s*[,，]?\s*(?:(siyah|beyaz|kırmızı|mavi|yeşil|sarı|mor|turuncu|pembe|kahverengi|gri|ekru)\s+)?ipimizi\s+sabitliyoruz\b/giu,
      (
        _match,
        prefix: string,
        imageReference: string | undefined,
        round: string,
        workedLoop: string,
        attachmentLoop: string,
        colorSource: string | undefined,
      ) => {
        const colors: Record<string, string> = {
          yeşil: "green",
          siyah: "black",
          beyaz: "white",
          kırmızı: "red",
          mavi: "blue",
          sarı: "yellow",
          mor: "purple",
          turuncu: "orange",
          pembe: "pink",
          kahverengi: "brown",
          gri: "gray",
          ekru: "ecru",
        };

        const color = colorSource
          ? colors[colorSource.toLocaleLowerCase("tr-TR")]
          : undefined;
        const yarnPhrase = color ? `the ${color} yarn` : "the yarn";

        return (
          `${prefix}Attach ${yarnPhrase} to the ${attachmentLoop.toUpperCase()} ` +
          `of the single crochet stitches worked in the ${workedLoop.toUpperCase()} of Round ${round}` +
          `${imageReference ? " as shown in the image" : ""}`
        );
      },
    )
    .replace(
      /(^|[^\p{L}\p{N}_])(?:(görselde\s+görüldüğü\s+gibi)\s+)?(\d+)\.\s*sıra(?:da|nın)\s+(FLO|BLO)\s*[’'ʼ]?\s*(?:dan|den)\s+ördüğümüz\s+sık\s+iğne(?:lerin|lerinin)\s*[,，]?\s*(FLO|BLO)\s*[’'ʼ]?\s*(?:sundan|sından|dan|den)\s*[,，]?\s*(\d+)\s*x\s+(?:örüp|örüyoruz|örerek)\s+devam\s+ediyoruz\s*[,，]?\s*(\d+)\s*x(?:\s*=\s*(\d+)\s*x)?\b/giu,
      (
        _match,
        prefix: string,
        imageReference: string | undefined,
        round: string,
        workedLoop: string,
        currentLoop: string,
        firstStitches: string,
        continuationStitches: string,
        total: string | undefined,
      ) => {
        // The round number is kept first (matching the source's own
        // number order: round, then stitch counts) so the numeric
        // integrity check comparing source and target digit sequences
        // stays satisfied -- unlike the yarn-attachment sibling above,
        // this construction has multiple trailing numbers, so where the
        // round number lands in the sentence is not just a style choice.
        return (
          `${prefix}In Round ${round}${imageReference ? " (as shown in the image)" : ""}, ` +
          `work ${firstStitches}x in the ${currentLoop.toUpperCase()} of the single crochet stitches ` +
          `worked in the ${workedLoop.toUpperCase()}, then continue with ${continuationStitches}x` +
          `${total ? ` = ${total}x` : ""}`
        );
      },
    )
    .replace(
      /(^|[^\p{L}\p{N}_])(birinci|[iİ]kinci|[üÜ]çüncü|dördüncü|beşinci|altıncı)\s+(cc|x|dc|tr)\s*[’'ʼ]?\s*(?:nin|nın|nun|nün|in|ın|un|ün)\s+(FLO|BLO)\s*[’'ʼ]?\s*(?:sundan|sından|dan|den)\s+ipimizi\s+sabitliyoruz\b/giu,
      (
        _match,
        prefix: string,
        ordinalSource: string,
        stitch: string,
        loop: string,
      ) => {
        const ordinals: Record<string, string> = {
          birinci: "first",
          ikinci: "second",
          üçüncü: "third",
          dördüncü: "fourth",
          beşinci: "fifth",
          altıncı: "sixth",
        };

        const ordinal =
          ordinals[ordinalSource.toLocaleLowerCase("tr-TR")];

        return `${prefix}Attach the yarn to the ${loop.toUpperCase()} of the ${ordinal} ${stitch}`;
      },
    )
    .replace(
      /(^|[^\p{L}\p{N}_])(?:(görselde\s+görüldüğü\s+gibi)\s*[,，]?\s*)?(\d+)\.\s*sırada\s+(FLO|BLO)\s*[’'ʼ]?dan\s+ördüğümüz\s+sık\s+iğnelerin\s+üzerine\s+(yeşil|siyah|beyaz|kırmızı|mavi|sarı|mor|turuncu|pembe|kahverengi|gri|ekru)\s+ipimiz\s*(?:ile\b|le\b)\s+ilmek\s+kaydırma\s+yapıyoruz\b/giu,
      (
        _match,
        prefix: string,
        imageReference: string | undefined,
        round: string,
        loop: string,
        colorSource: string,
      ) => {
        const colors: Record<string, string> = {
          yeşil: "green",
          siyah: "black",
          beyaz: "white",
          kırmızı: "red",
          mavi: "blue",
          sarı: "yellow",
          mor: "purple",
          turuncu: "orange",
          pembe: "pink",
          kahverengi: "brown",
          gri: "gray",
          ekru: "ecru",
        };

        const color =
          colors[colorSource.toLocaleLowerCase("tr-TR")];

        return (
          `${prefix}Using ${color} yarn, work slip stitches over the single crochet stitches ` +
          `worked in the ${loop.toUpperCase()} of Round ${round}` +
          `${imageReference ? " as shown in the image" : ""}`
        );
      },
    )
    .replace(
      /(^|[^\p{L}\p{N}_])([iİ]lmek\s+kaydırmaların)\s+(FLO|BLO)\s*[’'ʼ]?\s*(?:sundan|sından|dan|den)\s+(\d+)\s*x\s+örüyoruz\b/giu,
      (
        _match,
        prefix: string,
        _subject: string,
        loop: string,
        stitches: string,
      ) =>
        `${prefix}Work ${stitches}x in the ${loop.toUpperCase()} of the slip stitches`,
    )
    .replace(
      /\b(\d+)\s*cc\s*\(\s*ilmek\s+kaydırma\s*\)\s*yapıyoruz\s*[.]?/giu,
      (_match, stitches: string) =>
        `Work ${stitches}cc (slip stitches).`,
    )
    .replace(
      /\(\s*(\d+)\s+zincir\s*[,，]\s*sıradaki\s+sık\s+iğneye\s+(\d+)\s*x\s*\)/giu,
      (_match, chains: string, stitches: string) =>
        `(ch ${chains}, ${stitches}x in the next single crochet)`,
    )
    .replace(
      /\b(\d+)\s+zincir\s*[,，]\s*sıradaki\s+sık\s+iğneye\s+(\d+)\s*x\s+yaparak\b/giu,
      (_match, chains: string, stitches: string) =>
        `Ch ${chains} and work ${stitches}x in the next single crochet while`,
    )
    .replace(
      /\b(\d+)\s+zincir\s*[,，]\s*(?=sıradaki\s+sık\s+iğneye\b)/giu,
      (_match, chains: string) => `Ch ${chains}, `,
    )
    .replace(
      /(^|[^\p{L}\p{N}_])(iki|üç|dört)\s+parça\s+arasındaki\s+(cc|x|dc|tr)\s+üzerine\s+yine\s+\3\s+yapıyoruz\b/giu,
      (
        _match,
        prefix: string,
        pieceCountSource: string,
        stitch: string,
      ) => {
        const pieceCounts: Record<string, string> = {
          iki: "two",
          üç: "three",
          dört: "four",
        };

        const pieceCount =
          pieceCounts[pieceCountSource.toLocaleLowerCase("tr-TR")];

        return `${prefix}Work another ${stitch} into the ${stitch} between the ${pieceCount} pieces`;
      },
    )
    .replace(
      /\bsıradaki\s+sık\s+iğneye\s+(\d+)\s*x\b/giu,
      (_match, stitches: string) =>
        `${stitches}x in the next single crochet`,
    )
    .replace(
      /[,，]\s*(\d+)\s+tane\s+uzun\s+saç\s+teli\s+ördükten\s+sonra\s+kahkülleri\s+öreceğiz\b/giu,
      (_match, count: string) =>
        `. After making ${count} long hair strands, work the bangs`,
    )
    .replace(
      /\b(\d+)\s+tane\s+uzun\s+saç\s+teli\s+ördükten\s+sonra\s+kahkülleri\s+öreceğiz\b/giu,
      (_match, count: string) =>
        `After making ${count} long hair strands, work the bangs`,
    )
    .replace(
      /\btoplamda\s+(\d+)\s+tane\s+kahkülümüz\s+olacak\b/giu,
      (_match, count: string) =>
        `We will have ${count} bangs in total`,
    )
    .replace(
      /\btoplamda\s+(\d+)\s+tane\s+kahkülümüz\s+olacak[.]\s*tekrar\s+uzun\s+saç\s+tellerini\s+örmeye\s+devam\s+ediyoruz\b/giu,
      (_match, count: string) =>
        `We will have ${count} bangs in total. Continue making the long hair strands`,
    )
    .replace(
      /\btekrar\s+uzun\s+saç\s+tellerini\s+örmeye\s+devam\s+ediyoruz\b/giu,
      "Continue making the long hair strands",
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

// Tool/yarn intro shapes ("N numara tığ, <yarn> ip ile ... örüyoruz"). Each
// source is used both by the renderer below and, anchored to a whole line, by
// `isFullyResolvedToolIntro`, so the two can never disagree about the grammar.
const HOOK_SIZE_SOURCE = String.raw`(\d+(?:[.,]\d+)?)`;
const DESCRIPTION_BRAND_AFTER_ILE_SOURCE = String.raw`${HOOK_SIZE_SOURCE}\s*(?:numara|no)\s+tığ\s*,\s*([^,()]+?)\s+ip\s+ile\s*\(\s*([^)]+?)\s*\)\s+örüyoruz`;
const DESCRIPTION_BRAND_BEFORE_ILE_SOURCE = String.raw`${HOOK_SIZE_SOURCE}\s*(?:numara|no)\s+tığ\s*,\s*([^,()]+?)\s+ip\s*\(\s*([^)]+?)\s*\)\s+ile\s+örüyoruz`;
const BRANDED_COLOR_SOURCE = String.raw`${HOOK_SIZE_SOURCE}\s+(?:numara|no)\s+tığ\s*[,，]\s*(${TURKISH_YARN_COLOR_PATTERN})(?:\s+renk)?\s*\(\s*([^)]+?)\s*\)\s*ip\s+ile\s+örüyoruz`;
const HOOK_ONLY_WORK_SOURCE = String.raw`${HOOK_SIZE_SOURCE}\s*(?:mm\s+|(?:numara|no)\s+)?tığ\s+ile\s+örüyoruz`;
const HOOK_ONLY_USE_SOURCE = String.raw`${HOOK_SIZE_SOURCE}\s*(?:mm\s+|(?:numara|no)\s+)?tığ\s+kullanıyoruz`;

/**
 * A free yarn description becomes English only when the WHOLE description is
 * a mapped colour; anything else ("pamuk", "simli", "simli siyah") stays as
 * written, so it keeps its provider round-trip.
 */
const toolIntroDescription = (
  description: string,
  targetLanguage: TargetLanguage,
): string =>
  targetLanguage === "en"
    ? translateTurkishYarnColor(description, targetLanguage) ?? description
    : description;

const normalizeToolMaterialIntro = (
  source: string,
  targetLanguage: TargetLanguage,
): string => {
  let normalized = source;

  normalized = normalized.replace(
    new RegExp(String.raw`\b${DESCRIPTION_BRAND_AFTER_ILE_SOURCE}\b`, "giu"),
    (
      _match,
      size: string,
      yarnDescription: string,
      yarnBrand: string,
    ) => {
      const description = toolIntroDescription(yarnDescription.trim(), targetLanguage);
      const brand = yarnBrand.trim();

      return targetLanguage === "en"
        ? `Using a ${size} mm crochet hook and ${description} yarn (${brand}), work as follows`
        : `Con un ganchillo de ${size} mm y hilo ${description} (${brand}), tejemos de la siguiente manera`;
    },
  );

  normalized = normalized.replace(
    new RegExp(String.raw`\b${DESCRIPTION_BRAND_BEFORE_ILE_SOURCE}\b`, "giu"),
    (
      _match,
      size: string,
      yarnDescription: string,
      yarnBrand: string,
    ) => {
      const description = toolIntroDescription(yarnDescription.trim(), targetLanguage);
      const brand = yarnBrand.trim();

      return targetLanguage === "en"
        ? `Using a ${size} mm crochet hook and ${description} ${brand} yarn, work as follows`
        : `Con un ganchillo de ${size} mm y hilo ${description} ${brand}, tejemos de la siguiente manera`;
    },
  );

  const brandedColorHookPattern = new RegExp(
    String.raw`(?<!\p{L})${BRANDED_COLOR_SOURCE}(?!\p{L})`,
    "giu",
  );

  normalized = normalized.replace(
    brandedColorHookPattern,
    (_match, size: string, color: string, brand: string) => {
      const translatedColor =
        translateTurkishYarnColor(color, targetLanguage) ?? color.trim();

      return targetLanguage === "en"
        ? `Using a ${size} mm crochet hook and ${translatedColor} yarn (${brand.trim()}), work as follows`
        : `Con un ganchillo de ${size} mm y hilo ${translatedColor} (${brand.trim()}), tejemos de la siguiente manera`;
    },
  );

  normalized = normalized.replace(
    new RegExp(String.raw`\b${HOOK_ONLY_WORK_SOURCE}\b`, "giu"),
    (_match, size: string) =>
      targetLanguage === "en"
        ? `Using a ${size} mm crochet hook, work as follows`
        : `Con un ganchillo de ${size} mm, tejemos de la siguiente manera`,
  );

  normalized = normalized.replace(
    new RegExp(String.raw`\b${HOOK_ONLY_USE_SOURCE}\b`, "giu"),
    (_match, size: string) =>
      targetLanguage === "en"
        ? `Use a ${size} mm crochet hook`
        : `Usa un ganchillo de ${size} mm`,
  );

  return normalized;
};

/**
 * True when the whole line (after an optional `N)` marker and `✦`/`◆` bullet)
 * is one tool/yarn intro whose every slot renders deterministically: hook size
 * only, or hook size plus a mapped colour and brand. Such a line is complete
 * English after normalization and must not be sent to the provider. A line with
 * any other content, or a description that is not exactly a mapped colour,
 * keeps the provider path.
 */
const isFullyResolvedToolIntro = (source: string): boolean => {
  const whole = (shape: string) =>
    new RegExp(String.raw`^\s*(?:\d+\)\s*)?(?:[✦◆]\s*)?${shape}\s*[.]?\s*$`, "iu").exec(source);

  if (whole(HOOK_ONLY_WORK_SOURCE) || whole(HOOK_ONLY_USE_SOURCE) || whole(BRANDED_COLOR_SOURCE)) {
    return true;
  }
  for (const shape of [DESCRIPTION_BRAND_AFTER_ILE_SOURCE, DESCRIPTION_BRAND_BEFORE_ILE_SOURCE]) {
    const match = whole(shape);
    if (match && translateTurkishYarnColor(match[2]?.trim() ?? "", "en") !== undefined) return true;
  }
  return false;
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
    // "bu sırayı" ("this course") names the current course without saying
    // whether it is a row or a round, and nothing here knows which (turned
    // rows use it too). Both languages therefore stay unit-neutral, like the
    // conditional loop template above: "Work in <loop>" / "Trabaja en <loop>".
    /\bbu\s+sırayı\s+(FLO|BLO)\s*[’'ʼ]?\s*dan\s+örüyoruz\b/giu,
    (_match, loopRaw: string) =>
      targetLanguage === "en"
        ? `Work in ${loopRaw.toUpperCase()}`
        : `Trabaja en ${loopRaw.toUpperCase()}`,
  );

const normalizeSourceNaturalLanguageBase = (
  source: string,
  targetLanguage: TargetLanguage,
  contentKind: "pattern" | "materials" = "pattern",
  sourceContext: string = source,
  sourceOffset = 0,
  resolveCourseUnit: CourseUnitResolver = legacyCourseUnitResolver,
): string =>
  normalizeSimpleLoopInstruction(
    normalizeConditionalLoopInstruction(
      normalizeToolMaterialIntro(
        normalizeEnglishCrochetStructures(
          normalizeMaterialsTerminology(source, targetLanguage, contentKind),
          targetLanguage,
          sourceContext,
          sourceOffset,
          resolveCourseUnit,
        ),
        targetLanguage,
      ),
      targetLanguage,
    ),
    targetLanguage,
  )
    .replace(
      /\b(kaşları\s+ve\s+)?kirpikleri\s+görsele\s+bakarak\s+işleyebiliriz\b/giu,
      (_match, eyebrowsPrefix: string | undefined) =>
        eyebrowsPrefix
          ? targetPhrase(
              targetLanguage,
              "Embroider the eyebrows and eyelashes following the reference image",
              "Borda las cejas y las pestañas siguiendo la imagen de referencia",
            )
          : targetPhrase(
              targetLanguage,
              "Embroider the eyelashes following the reference image",
              "Borda las pestañas siguiendo la imagen de referencia",
            ),
    )
    .replace(
      /kirpik\s+bitiminden\s+(\d+)\s*x\s+sayıyoruz\s*[,，]\s*(\d+)\s*x\s*[,，]\s*(\d+)\s*dc\s*[,，]\s*(\d+)\s*x\s+yukarıdan\s+aşağı\s+doğru\s+örüyoruz\b/giu,
      (
        _match,
        offset: string,
        firstSc: string,
        dc: string,
        lastSc: string,
      ) =>
        targetPhrase(
          targetLanguage,
          `Count ${offset} ${offset === "1" ? "stitch" : "stitches"} from the end of the eyelashes. Work ${firstSc}sc, ${dc}dc, ${lastSc}sc from top to bottom`,
          `Cuenta ${offset} ${offset === "1" ? "punto" : "puntos"} desde el final de las pestañas. Teje ${firstSc} pb, ${dc} pa, ${lastSc} pb de arriba hacia abajo`,
        ),
    )
    .replace(
      /diğer\s+kulağı\s+da\s+aynı\s+şekilde\s+aşağıdan\s+yukarı\s+doğru\s+örüyoruz\b/giu,
      targetPhrase(
        targetLanguage,
        "Work the other ear in the same way, from bottom to top",
        "Teje la otra oreja de la misma manera, de abajo hacia arriba",
      ),
    )
    .replace(
      /(^|[^\p{L}\p{N}_])(\d+)\s+zincir\s+çekip\s+ipimizi\s+dikiş\s+için\s+uzun\s+kesiyoruz\b/giu,
      (_match, prefix: string, chains: string) =>
        `${prefix}Ch ${chains} and cut the yarn, leaving a long tail for sewing`,
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


/** Options shared by the source normalizers. */
export type SourceNormalizationOptions = {
  /** Row/round authority for course counts; defaults to `legacyCourseUnitResolver`. */
  readonly resolveCourseUnit?: CourseUnitResolver;
};

export const normalizeSourceNaturalLanguage = (
  source: string,
  targetLanguage: TargetLanguage,
  contentKind: "pattern" | "materials" = "pattern",
  sourceContext: string = source,
  sourceOffset = 0,
  options: SourceNormalizationOptions = {},
): string => {
  if (contentKind === "pattern" && targetLanguage === "en") {
    const sleeve = renderEnglishSleeveInstruction(source);

    if (sleeve) {
      return sleeve.target;
    }
  }

  return normalizeSourceNaturalLanguageBase(
    source,
    targetLanguage,
    contentKind,
    sourceContext,
    sourceOffset,
    options.resolveCourseUnit,
  );
};

const fullyResolvedLoopCompactChainTurnPattern =
  /^\s*(?:\d+\)\s*)?bu\s+sırayı\s+(?:FLO|BLO)\s*[’'ʼ]?\s*dan\s+örüyoruz\s*[.]\s*\d+\s*x\s*[,，]\s*\d+\s*v\s*[,，]\s*\(\s*\d+\s*x\s*[,，]\s*\d+\s*v\s*\)\s*\*\s*\d+\s*[,，]\s*\d+\s*x\s*=\s*\d+\s*x\s*[,，]\s*\d+\s+zincir\s*[,，]\s*dön\s*[,]?\s*$/iu;

const fullyResolvedCompactChainTurnPattern =
  /^\s*(?:\d+\)\s*)?\d+\s*x\s*[,，]\s*\d+\s+zincir\s*[,，]\s*dön\s*[,]?\s*$/iu;

const fullyResolvedCompactChainCutPattern =
  /^\s*(?:\d+\)\s*)?\d+\s*x\s*[,，]\s*\d+\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz\s*[.]?\s*$/iu;

const fullyResolvedAroundEdgeSlipStitchPattern =
  /^\s*(?:\d+\)\s*)?(?:görselde\s+görüldüğü\s+gibi\s+)?dışa\s+kıvırmak\s+için\s+ördüğümüz\s+kısmın\s+çevresini\s+simli\s+ip\s+ile\s+\d+\s+zincir\s*[,，]\s*sıradaki\s+sık\s+iğneye\s+cc\s*[,，]?\s*yaparak\s+dönüyoruz\s*[.]\s*tüm\s+çevreyi\s+ördükten\s+sonra\s+\d+\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz\s*[.]?\s*$/iu;

const fullyResolvedSleeveSetupPattern =
  /^\s*(?:\d+\)\s*)?(?:görselde\s+görüldüğü\s+gibi\s+)?kol\s+boşluğunun\s+arka\s+tarafından\s+ipimizi\s+sabitliyoruz\s*[.]\s*\d+\s*x\s+örüyoruz\s*[.]\s*başlangıç\s+noktamız\s+burası\s+olacak\s*[,，]\s*(?:işaretleyiciyi|işaretleyicimizi|markerı|markeri)\s+buraya\s+(?:takıyoruz|yerleştiriyoruz|koyuyoruz)\s*[.]?\s*$/iu;

const fullyResolvedSleeveShapingPattern =
  /^\s*(?:\d+\)\s*)?\d+\s*x\s+örüyoruz\s*\(\s*kolun\s+üzerindeki\s+dışa\s+doğru\s+kıvırdığımız\s+kısmı\s+öreceğiz\s*\)\s*[.]\s*görselde\s+görüldüğü\s+gibi\s+ben\s+\d+\s*x\s+ördüğümde\s+tam\s+kolun\s+üzerine\s+denk\s+geldi\s*[.]\s*sizde\s+kolun\s+üst\s+kısmına\s+denk\s+gelecek\s+şekilde\s+\d+-\d+\s+sık\s+iğne\s+eksik\s+ya\s+da\s+fazla\s+örebilirsiniz\s*[.]\s*\d+\s+zincir\s+çekip\s+dönüyoruz\s*[.]?\s*$/iu;

const fullyResolvedCourseEndTurnPattern =
  /^\s*(?:\d+(?:-\d+)?\)\s*)?sıra\s+(?:sonunda|sonlarında)\s+\d+\s+zincir\s+çekip\s+dönüyoruz\s*[.]?\s*$/iu;

const fullyResolvedLongButtonholeGuidancePattern =
  /^\s*\d+\s+zincir\s+atlıyoruz\s*\(\s*düğme\s+iliği\s+oluşturuyoruz\s*[.]\s*düğme\s+iliği\s+için\s+çektiğimiz\s+zincir\s+sayısını\s*[,，]?\s*kullanacağınız\s+düğme\s+boyutuna\s+göre\s+(?:artırıp|arttırıp)\s+ya\s+da\s+azaltabilirsiniz\s*[.]?\s*\)\s*$/iu;

export const normalizeSourceNaturalLanguageDetailed = (
  source: string,
  targetLanguage: TargetLanguage,
  contentKind: "pattern" | "materials" = "pattern",
  sourceContext: string = source,
  sourceOffset = 0,
  options: SourceNormalizationOptions = {},
): SourceNaturalLanguageNormalization => {
  const normalized = normalizeSourceNaturalLanguage(
    source,
    targetLanguage,
    contentKind,
    sourceContext,
    sourceOffset,
    options,
  );

  const trimmedSource = source.trim();
  const trailingActionSpans =
    scanRoundCountTrailingActionSourceSpans(trimmedSource);

  const fullyResolvedRoundCountTrailingAction =
    trailingActionSpans.length === 1 &&
    trailingActionSpans[0]?.start === 0 &&
    trailingActionSpans[0]?.end === trimmedSource.length;

  const fullyResolvedSleeveInstruction =
    targetLanguage === "en" &&
    renderEnglishSleeveInstruction(trimmedSource) !== undefined;

  const fullyResolved =
    contentKind === "pattern" &&
    targetLanguage === "en" &&
    (
      fullyResolvedChainSkipContinueAndFinishPattern.test(source) ||
      fullyResolvedReferencedLoopStitchCountPattern.test(source) ||
      fullyResolvedChainTurnSlipStitchContinuationPattern.test(source) ||
      fullyResolvedLoopCompactChainTurnPattern.test(source) ||
      fullyResolvedCompactChainTurnPattern.test(source) ||
      fullyResolvedCompactChainCutPattern.test(source) ||
      fullyResolvedAroundEdgeSlipStitchPattern.test(source) ||
      fullyResolvedSleeveSetupPattern.test(source) ||
      fullyResolvedSleeveShapingPattern.test(source) ||
      fullyResolvedSleeveInstruction ||
      fullyResolvedLongButtonholeGuidancePattern.test(source) ||
      fullyResolvedCourseEndTurnPattern.test(source) ||
      isFullyResolvedToolIntro(source) ||
      fullyResolvedRoundCountTrailingAction
    );

  return {
    text: normalized,
    fullyResolved,
  };
};
