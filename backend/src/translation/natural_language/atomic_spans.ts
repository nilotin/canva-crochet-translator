export type SourceAtomicSpan = {
  start: number;
  end: number;
};

const ATOMIC_NATURAL_LANGUAGE_PATTERNS = [
  /(?:görselde\s+görüldüğü\s+gibi\s+)?\d+\.\s*sıra(?:da|nın)\s+(?:FLO|BLO)\s*[’'ʼ]?\s*(?:dan|den)\s+ördüğümüz\s+sık\s+iğne(?:lerin|lerinin)\s*[,，]?\s*(?:FLO|BLO)\s*[’'ʼ]?\s*(?:sundan|sından|dan|den)\s*[,，]?\s*(?:(?:siyah|beyaz|kırmızı|mavi|yeşil|sarı|mor|turuncu|pembe|kahverengi|gri|ekru)\s+)?ipimizi\s+sabitliyoruz\b/giu,
  /(?:görselde\s+görüldüğü\s+gibi\s+)?(?:yeşil|siyah|beyaz|kırmızı|mavi|sarı|mor|turuncu|pembe|kahverengi|gri|ekru)\s+ipimizi\s*[,，]?\s*\d+\.\s*sırada\s+(?:FLO|BLO)\s*[’'ʼ]?dan\s+ördüğümüz\s+sık\s+iğnelerin\s+(?:FLO|BLO)\s*[’'ʼ]?(?:sundan|sından|dan|den)(?:\s*\([^)]*\))?\s+sabitliyoruz\s*[,，]\s*\d+\s*x\b/giu,

  /(?:görselde\s+görüldüğü\s+gibi\s*[,，]?\s*)?\d+\.\s*sırada\s+(?:FLO|BLO)\s*[’'ʼ]?dan\s+ördüğümüz\s+sık\s+iğnelerin\s+üzerine\s+(?:yeşil|siyah|beyaz|kırmızı|mavi|sarı|mor|turuncu|pembe|kahverengi|gri|ekru)\s+ipimiz\s*(?:ile\b|le\b)\s+ilmek\s+kaydırma\s+yapıyoruz\b/giu,
] as const;

export const extractSourceAtomicNaturalLanguageSpans = (
  source: string,
): SourceAtomicSpan[] => {
  const spans: SourceAtomicSpan[] = [];

  for (const pattern of ATOMIC_NATURAL_LANGUAGE_PATTERNS) {
    pattern.lastIndex = 0;

    for (const match of source.matchAll(pattern)) {
      if (match.index === undefined) continue;

      spans.push({
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  return spans.sort((a, b) => a.start - b.start);
};
