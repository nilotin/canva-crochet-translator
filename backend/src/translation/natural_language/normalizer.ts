import type { TargetLanguage } from "../types.js";

const targetPhrase = (
  targetLanguage: TargetLanguage,
  english: string,
  spanish: string,
) => (targetLanguage === "en" ? english : spanish);

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
      /((?:\d+\)\s*)?)(\d+)\s*x\s*[,，]\s*(\d+)\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz\b/giu,
      (
        _match,
        marker: string,
        stitches: string,
        chains: string,
      ) => `${marker}${stitches}sc. Ch ${chains} and cut the yarn`,
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
    .replace(
      /((?:\d+(?:-\d+)?\)\s*)?)(\d+)\s+sıra\s+(\d+)\s*x\s+bir\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz\b/giu,
      (
        _match,
        marker: string,
        rounds: string,
        stitches: string,
      ) =>
        `${marker}${rounds} ${rounds === "1" ? "round" : "rounds"}, ${stitches}sc. Ch 1 and cut the yarn`,
    )
    .replace(/\b(\d+)\s+sıra\s+(\d+)\s*x\b/giu, "$1 rounds, $2x")
    .replace(
      /\b(\d+)\s*x\s*[-–—]\s*(\d+)\s+zincir\s*\(\s*düğme\s+iliği\s*\)\s*dön\b/giu,
      (_match, stitches: string, chains: string) =>
        `${stitches}x, ch ${chains} (buttonhole) and turn`,
    )
    .replace(
      /\b(\d+)\s+zincir\s+dön\b/giu,
      (_match, count: string) => `Ch ${count} and turn`,
    )
    .replace(
      /\b(\d+)\s+zincir\s+çekip\s+(?:geriye\s+)?dönüyoruz\s*[,，.]?/giu,
      (_match, count: string) => `Ch ${count} and turn.`,
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
      /\b(\d+)\s+zincir\s*,?\s*(\d+)\s*x\s+atla\b/giu,
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
      /(?<!\p{L})[iİ]kinci\s+bacakta\s+da\s+ilk\s+(\d+)\s+sırayı\s+aynı\s+şekilde\s+örüyoruz(?!\p{L})/giu,
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
      /\bsıra\s+sonuna\s+geldiğimizde\s+(\d+)\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz\b/giu,
      (_match, chains: string) =>
        `At the end of the round, ch ${chains} and cut the yarn`,
    )
    .replace(
      /\b(\d+)\s*x\s+atla\s*[,，]?\s*sıradaki\s+sık\s+iğneye\s+cc\b/giu,
      (_match, count: string) =>
        `skip ${count}x, cc into the next stitch`,
    )
    .replace(
      /\bsıradaki\s+sık\s+iğneye\s+cc\b/giu,
      "cc into the next single crochet",
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
    /(?<!\p{L})(\d+(?:[.,]\d+)?)\s+(?:numara|no)\s+tığ\s*[,，]\s*(mor)\s+renk\s*\(\s*([^)]+?)\s*\)\s+ip\s+ile\s+örüyoruz(?!\p{L})/giu,
    (_match, size: string, color: string, brand: string) => {
      const translatedColor =
        color.toLocaleLowerCase("tr-TR") === "mor" ? "purple" : color;

      return targetLanguage === "en"
        ? `Using a ${size} mm crochet hook and ${translatedColor} yarn (${brand.trim()}), work as follows`
        : `Con un ganchillo de ${size} mm y hilo ${translatedColor} (${brand.trim()}), tejemos de la siguiente manera`;
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
