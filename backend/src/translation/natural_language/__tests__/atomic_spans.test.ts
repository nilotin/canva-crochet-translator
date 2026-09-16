import { describe, expect, it } from "vitest";
import { extractSourceAtomicNaturalLanguageSpans } from "../atomic_spans.js";

describe("extractSourceAtomicNaturalLanguageSpans", () => {
  it("protects the round-first referenced-loop attachment relation as a single atomic span, matching the live Canva source", () => {
    // Exact live source recovered from backend/.data/canva-page-states.json
    // for the reported duplicate-opening bug. The decorative bullet ("✦ ")
    // sits outside the atomic span -- it is not part of the semantic
    // relation and formatting boundaries are free to fall on it.
    const source =
      "✦ Görselde görüldüğü gibi 5. sırada Flo’dan ördüğümüz sık iğnelerin Blo’sundan yeşil ipimizi sabitliyoruz. " +
      "(1 zincir, sıradaki sık iğneye cc)*32, 1 zincir çekip ipimizi kesiyoruz.";

    expect(extractSourceAtomicNaturalLanguageSpans(source)).toEqual([
      { start: 2, end: 105 },
    ]);
    expect(source.slice(2, 105)).toBe(
      "Görselde görüldüğü gibi 5. sırada Flo’dan ördüğümüz sık iğnelerin Blo’sundan yeşil ipimizi sabitliyoruz",
    );
  });

  it("protects the same relation generically for a different round, color, and loop order", () => {
    const source =
      "12. sırada BLO’dan ördüğümüz sık iğnelerin FLO’sundan siyah ipimizi sabitliyoruz.";

    const spans = extractSourceAtomicNaturalLanguageSpans(source);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.start).toBe(0);
    expect(source.slice(spans[0]?.start, spans[0]?.end)).toBe(
      "12. sırada BLO’dan ördüğümüz sık iğnelerin FLO’sundan siyah ipimizi sabitliyoruz",
    );
  });

  it("does not require a color or an image reference", () => {
    const source =
      "18. sırada BLO’dan ördüğümüz sık iğnelerin FLO’sundan ipimizi sabitliyoruz.";

    const spans = extractSourceAtomicNaturalLanguageSpans(source);
    expect(spans).toHaveLength(1);
    expect(source.slice(spans[0]?.start, spans[0]?.end)).toBe(
      "18. sırada BLO’dan ördüğümüz sık iğnelerin FLO’sundan ipimizi sabitliyoruz",
    );
  });

  it("protects the referenced-loop stitch-count relation (Page 24) as a single atomic span", () => {
    const source =
      "22. sırada FLO’dan ördüğümüz sık iğnelerin BLO’sundan 24x örüp devam ediyoruz, 12x";

    const spans = extractSourceAtomicNaturalLanguageSpans(source);
    expect(spans).toHaveLength(1);
    expect(source.slice(spans[0]?.start, spans[0]?.end)).toBe(source);
  });

  it("protects the referenced-loop stitch-count relation with a stated total and the alternate verb form", () => {
    const source =
      "25. sırada FLO’dan ördüğümüz sık iğnelerin BLO’sundan 48x örüyoruz devam ediyoruz, 12x = 60x";

    const spans = extractSourceAtomicNaturalLanguageSpans(source);
    expect(spans).toHaveLength(1);
    expect(source.slice(spans[0]?.start, spans[0]?.end)).toBe(source);
  });

  it("protects the referenced-loop stitch-count relation generically for the opposite loop order", () => {
    const source =
      "18. sırada BLO’dan ördüğümüz sık iğnelerin FLO’sundan 16x örüp devam ediyoruz, 8x";

    const spans = extractSourceAtomicNaturalLanguageSpans(source);
    expect(spans).toHaveLength(1);
    expect(source.slice(spans[0]?.start, spans[0]?.end)).toBe(source);
  });

  it("protects bare round-count lines at the beginning, middle, and end of a block", () => {
    const source =
      "2-11) 10 sıra 64x\n12) 60x\n13-15) 3 sıra 56x.\n16) 52x\n1 sıra 29x";

    const spans = extractSourceAtomicNaturalLanguageSpans(source);

    expect(spans.map(({ start, end }) => source.slice(start, end))).toEqual([
      "2-11) 10 sıra 64x",
      "13-15) 3 sıra 56x.",
      "1 sıra 29x",
    ]);
  });

  it("does not classify an arm-joining continuation as a bare round-count line", () => {
    const source =
      "15-29) 15 sıra 42x, İpimizi kesmeden kol birleştirme ile devam ediyoruz.";

    expect(extractSourceAtomicNaturalLanguageSpans(source)).toEqual([]);
  });
});
