import {
  parseBareRoundCountSourceLine,
  scanRoundCountTrailingActionSourceSpans,
  scanRoundCountYarnCutSourceSpans,
  splitLogicalLines,
} from "./bare_round_count.js";

export type SourceAtomicSpan = {
  start: number;
  end: number;
};

const ATOMIC_NATURAL_LANGUAGE_PATTERNS = [
  /(?:\d+\)\s*)?(?:görselde\s+görüldüğü\s+gibi\s+)?dışa\s+kıvırmak\s+için\s+ördüğümüz\s+kısmın\s+çevresini\s+simli\s+ip\s+ile\s+\d+\s+zincir\s*[,，]\s*sıradaki\s+sık\s+iğneye\s+cc\s*[,，]?\s*yaparak\s+dönüyoruz\s*[.]\s*tüm\s+çevreyi\s+ördükten\s+sonra\s+\d+\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz\s*[.]?/giu,
  /(?:görselde\s+görüldüğü\s+gibi\s+)?\d+\.\s*sıra(?:da|nın)\s+(?:FLO|BLO)\s*[’'ʼ]?\s*(?:dan|den)\s+ördüğümüz\s+sık\s+iğne(?:lerin|lerinin)\s*[,，]?\s*(?:FLO|BLO)\s*[’'ʼ]?\s*(?:sundan|sından|dan|den)\s*[,，]?\s*(?:(?:siyah|beyaz|kırmızı|mavi|yeşil|sarı|mor|turuncu|pembe|kahverengi|gri|ekru)\s+)?ipimizi\s+sabitliyoruz\b/giu,
  /(?:görselde\s+görüldüğü\s+gibi\s+)?(?:yeşil|siyah|beyaz|kırmızı|mavi|sarı|mor|turuncu|pembe|kahverengi|gri|ekru)\s+ipimizi\s*[,，]?\s*\d+\.\s*sırada\s+(?:FLO|BLO)\s*[’'ʼ]?dan\s+ördüğümüz\s+sık\s+iğnelerin\s+(?:FLO|BLO)\s*[’'ʼ]?(?:sundan|sından|dan|den)(?:\s*\([^)]*\))?\s+sabitliyoruz\s*[,，]\s*\d+\s*x\b/giu,
  /(?:görselde\s+görüldüğü\s+gibi\s+)?\d+\.\s*sıra(?:da|nın)\s+(?:FLO|BLO)\s*[’'ʼ]?\s*(?:dan|den)\s+ördüğümüz\s+sık\s+iğne(?:lerin|lerinin)\s*[,，]?\s*(?:FLO|BLO)\s*[’'ʼ]?\s*(?:sundan|sından|dan|den)\s*[,，]?\s*\d+\s*x\s+(?:örüp|örüyoruz|örerek)\s+devam\s+ediyoruz\s*[,，]?\s*\d+\s*x(?:\s*=\s*\d+\s*x)?\b/giu,

  /(?:görselde\s+görüldüğü\s+gibi\s*[,，]?\s*)?\d+\.\s*sırada\s+(?:FLO|BLO)\s*[’'ʼ]?dan\s+ördüğümüz\s+sık\s+iğnelerin\s+üzerine\s+(?:yeşil|siyah|beyaz|kırmızı|mavi|sarı|mor|turuncu|pembe|kahverengi|gri|ekru)\s+ipimiz\s*(?:ile\b|le\b)\s+ilmek\s+kaydırma\s+yapıyoruz\b/giu,
  /\d+\s+zincir\s+atlıyoruz\s*\(\s*düğme\s+iliği\s+oluşturuyoruz\s*[.]\s*düğme\s+iliği\s+için\s+çektiğimiz\s+zincir\s+sayısını\s*[,，]?\s*kullanacağınız\s+düğme\s+boyutuna\s+göre\s+(?:artırıp|arttırıp)\s+ya\s+da\s+azaltabilirsiniz\s*[.]?\s*\)/giu,
  /(?:\d+\)\s*)?(?:görselde\s+görüldüğü\s+gibi\s+)?kol\s+boşluğunun\s+arka\s+tarafından\s+ipimizi\s+sabitliyoruz\s*[.]\s*\d+\s*x\s+örüyoruz\s*[.]\s*başlangıç\s+noktamız\s+burası\s+olacak\s*[,，]\s*(?:işaretleyiciyi|işaretleyicimizi|markerı|markeri)\s+buraya\s+(?:takıyoruz|yerleştiriyoruz|koyuyoruz)\s*[.]?/giu,

  /(?:\d+\)\s*)?\d+\s*x\s+örüyoruz\s*\(\s*kolun\s+üzerindeki\s+dışa\s+doğru\s+kıvırdığımız\s+kısmı\s+öreceğiz\s*\)\s*[.]\s*görselde\s+görüldüğü\s+gibi\s+ben\s+\d+\s*x\s+ördüğümde\s+tam\s+kolun\s+üzerine\s+denk\s+geldi\s*[.]\s*sizde\s+kolun\s+üst\s+kısmına\s+denk\s+gelecek\s+şekilde\s+\d+-\d+\s+sık\s+iğne\s+eksik\s+ya\s+da\s+fazla\s+örebilirsiniz\s*[.]\s*\d+\s+zincir\s+çekip\s+dönüyoruz\s*[.]?/giu,

  /[♦✦]\s*diğer\s+kolu\s+da\s+aynı\s+şekilde\s+örüyoruz\s*[.]\s*\(\s*\d+\.\s*sırada\s+ilk\s+kolda\s+\d+\s*x\s+örüp\s+kolun\s+üzerine\s+denk\s+getirmiştim\s*[.]\s*diğer\s+kolu\s+örerken\s+\d+\s*x\s+ördüğümde\s+kolun\s+üzerine\s+denk\s+geldi\s*[.]\s*sizde\s+kolun\s+üzerine\s+denk\s+gelecek\s+şekilde\s+\d+-\d+\s+sık\s+iğne\s+eksik\s+ya\s+da\s+fazla\s+örerek\s+üst\s+kısma\s+gelin\s*[.]?\s*\)/giu,

  /(?<![^\r\n])(?:\d+\)\s*)?bu\s+sırayı\s+(?:FLO|BLO)\s*[’'ʼ]?\s*dan\s+örüyoruz\s*[.]\s*\d+\s*x\s*[,，]\s*\d+\s*v\s*[,，]\s*\(\s*\d+\s*x\s*[,，]\s*\d+\s*v\s*\)\s*\*\s*\d+\s*[,，]\s*\d+\s*x\s*=\s*\d+\s*x\s*[,，]\s*\d+\s+zincir\s*[,，]\s*dön\s*[,]?(?=$|[\r\n])/gimu,

  /(?<![^\r\n])(?:\d+\)\s*)?\d+\s*x\s*[,，]\s*\d+\s+zincir\s*[,，]\s*dön\s*[,]?(?=$|[\r\n])/gimu,

  /(?<![^\r\n])(?:\d+\)\s*)?\d+\s*x\s*[,，]\s*\d+\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz\s*[.]?(?=$|[\r\n])/gimu,
  /\d+\s+zincir\s+çekip\s+(?:geriye\s+)?dönüyoruz\s*[,，.]\s*(?:zincir\s+üzerine\s+)?(?:birinci|ikinci|üçüncü|dördüncü|beşinci|altıncı|yedinci|sekizinci|dokuzuncu|onuncu)\s+zincirden\s+itibaren\s+\d+\s*(?:x|hdc|sc|dc|tr)\s*[,，]\s*\d+\s*x\s+atla\s*[,，]?\s*sıradaki\s+(?:sık\s+iğneye|ilmeğe)\s+cc\s*[,，]\s*tekrar\s+(?:sıradaki|sırdaki)\s+(?:sık\s+iğneye|ilmeğe)\s+cc(?:\s+yapıyoruz)?\s*[.]\s*bu\s+şekilde\s+sıra\s+sonuna\s+kadar\s+devam\s+ediyoruz\s*[.]\s*sıra\s+sonuna\s+geldiğimizde\s+\d+\s+zincir\s+çekiyoruz\b/giu,
] as const;

export const extractSourceAtomicNaturalLanguageSpans = (
  source: string,
): SourceAtomicSpan[] => {
  const spans: SourceAtomicSpan[] = splitLogicalLines(source).flatMap(
    ({ text, start, end }) =>
      parseBareRoundCountSourceLine(text) ? [{ start, end }] : [],
  );

  spans.push(
    ...scanRoundCountYarnCutSourceSpans(source).map(({ start, end }) => ({
      start,
      end,
    })),
  );

  spans.push(
    ...scanRoundCountTrailingActionSourceSpans(source).map(({ start, end }) => ({
      start,
      end,
    })),
  );

  for (const pattern of ATOMIC_NATURAL_LANGUAGE_PATTERNS) {
    pattern.lastIndex = 0;

    for (const match of source.matchAll(pattern)) {
      if (match.index === undefined) continue;

      spans.push({
        start: match.index,
        end:
          match.index +
          match[0].length +
          (source[match.index + match[0].length] === "." ? 1 : 0),
      });
    }
  }

  return spans.sort((a, b) => a.start - b.start);
};
