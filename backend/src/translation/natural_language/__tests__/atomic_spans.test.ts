import { describe, expect, it } from "vitest";
import { extractSourceAtomicNaturalLanguageSpans } from "../atomic_spans.js";
import {
  scanRoundCountYarnCutSourceSpans,
  scanRoundCountYarnCutTargetSpans,
} from "../bare_round_count.js";

const REAL_BLOCK_3_SOURCE =
  "✦ Bu sıradan sonra kol ve \n" +
  "gövdeye teli takabilirsiniz.\n" +
  "4) (7x, 1e)*6 = 48x\n" +
  "5) 3x, 1e, (6x, 1e)*5, 3x = 42x\n" +
  "6) (5x, 1e)*6 = 36x\n" +
  "7) 2x, 1e, (4x, 1e)*5, 2x = 30x\n" +
  "8) (3x, 1e)*6 = 24x\n" +
  "9) 1x, 1e, (2x, 1e)*5, 1x = 18x\n" +
  "10-15) 6 sıra 18x --- ipimizi kesiyoruz. ";

const REAL_BLOCK_3_TARGET =
  "✦ After this round, you can attach the wire to the arm and body.\n" +
  "4) (7sc, 1dec)*6 = 48sc\n" +
  "5) 3sc, 1dec, (6sc, 1dec)*5, 3sc = 42sc\n" +
  "6) (5sc, 1dec)*6 = 36sc\n" +
  "7) 2sc, 1dec, (4sc, 1dec)*5, 2sc = 30sc\n" +
  "8) (3sc, 1dec)*6 = 24sc\n" +
  "9) 1sc, 1dec, (2sc, 1dec)*5, 1sc = 18sc\n" +
  "10-15) 18sc for 6 rounds — cut the yarn. ";

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
      { start: 2, end: 106 },
    ]);
    expect(source.slice(2, 106)).toBe(
      "Görselde görüldüğü gibi 5. sırada Flo’dan ördüğümüz sık iğnelerin Blo’sundan yeşil ipimizi sabitliyoruz.",
    );
  });

  it("protects the same relation generically for a different round, color, and loop order", () => {
    const source =
      "12. sırada BLO’dan ördüğümüz sık iğnelerin FLO’sundan siyah ipimizi sabitliyoruz.";

    const spans = extractSourceAtomicNaturalLanguageSpans(source);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.start).toBe(0);
    expect(source.slice(spans[0]?.start, spans[0]?.end)).toBe(
      "12. sırada BLO’dan ördüğümüz sık iğnelerin FLO’sundan siyah ipimizi sabitliyoruz.",
    );
  });

  it("does not require a color or an image reference", () => {
    const source =
      "18. sırada BLO’dan ördüğümüz sık iğnelerin FLO’sundan ipimizi sabitliyoruz.";

    const spans = extractSourceAtomicNaturalLanguageSpans(source);
    expect(spans).toHaveLength(1);
    expect(source.slice(spans[0]?.start, spans[0]?.end)).toBe(
      "18. sırada BLO’dan ördüğümüz sık iğnelerin FLO’sundan ipimizi sabitliyoruz.",
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

  it("locates the complete yarn-cut span at the persisted Block 3 offsets", () => {
    const semanticSpans = scanRoundCountYarnCutSourceSpans(
      REAL_BLOCK_3_SOURCE,
    );

    expect(semanticSpans).toHaveLength(1);
    expect(semanticSpans[0]).toMatchObject({
      start: 212,
      end: 253,
      prefix: "10-15) ",
      range: "10-15",
      rounds: "6",
      stitches: "18",
      roundsSpan: { start: 219, end: 220 },
      stitchesSpan: { start: 226, end: 228 },
    });
    expect(
      REAL_BLOCK_3_SOURCE.slice(
        semanticSpans[0]?.start,
        semanticSpans[0]?.end,
      ),
    ).toBe("10-15) 6 sıra 18x --- ipimizi kesiyoruz. ");
    expect(extractSourceAtomicNaturalLanguageSpans(REAL_BLOCK_3_SOURCE)).toContainEqual(
      { start: 212, end: 253 },
    );

    expect(scanRoundCountYarnCutTargetSpans(REAL_BLOCK_3_TARGET)).toMatchObject([
      {
        start: 257,
        end: 298,
        prefix: "10-15) ",
        range: "10-15",
        stitches: "18",
        rounds: "6",
        roundWord: "rounds",
        stitchesSpan: { start: 264, end: 266 },
        roundsSpan: { start: 273, end: 274 },
      },
    ]);
  });

  it("keeps the live 'sırdaki' typo variant atomic", () => {
    const prefix = "FREE PROSE. ";
    const continuation =
      "20 zincir çekip dönüyoruz, zincir üzerine üçüncü zincirden itibaren 18hdc, " +
      "1x atla sıradaki ilmeğe cc, tekrar sırdaki sık iğneye cc yapıyoruz. " +
      "Bu şekilde sıra sonuna kadar devam ediyoruz. " +
      "Sıra sonuna geldiğimizde 3 zincir çekiyoruz.";

    const source = prefix + continuation;
    const spans = extractSourceAtomicNaturalLanguageSpans(source);

    expect(spans).toHaveLength(1);
    expect(spans[0]?.start).toBe(prefix.length);
    expect(source.slice(spans[0]?.start, spans[0]?.end)).toBe(continuation);
  });

  it.each([
    [
      "20 zincir çekip dönüyoruz, zincir üzerine üçüncü zincirden itibaren 18hdc, " +
        "1x atla sıradaki ilmeğe cc, tekrar sıradaki sık iğneye cc yapıyoruz. " +
        "Bu şekilde sıra sonuna kadar devam ediyoruz. " +
        "Sıra sonuna geldiğimizde 3 zincir çekiyoruz.",
    ],
    [
      "20 zincir çekip geriye dönüyoruz. Zincir üzerine üçüncü zincirden itibaren 18hdc, " +
        "1x atla, sıradaki sık iğneye cc, tekrar sıradaki sık iğneye cc. " +
        "Bu şekilde sıra sonuna kadar devam ediyoruz. " +
        "Sıra sonuna geldiğimizde 3 zincir çekiyoruz.",
    ],
  ])(
    "keeps the chain-turn/slip-stitch continuation family atomic across surrounding prose",
    (continuation) => {
      const prefix = "FREE PROSE. ";
      const source = prefix + continuation;
      const spans = extractSourceAtomicNaturalLanguageSpans(source);

      expect(spans).toHaveLength(1);
      expect(spans[0]?.start).toBe(prefix.length);
      expect(source.slice(spans[0]?.start, spans[0]?.end)).toBe(continuation);
    },
  );


});

describe("round-count trailing-action atomic spans", () => {
  it.each([
    "12-20) 9 sıra 54x, 6 zincir (düğme iliği)",
    "21-25) 5 sıra 54x, 1 zincir çekip ipimizi kesiyoruz.",
  ])("keeps the complete instruction atomic: %s", (instruction) => {
    const prefix = "FREE PROSE. ";
    const source = prefix + instruction;

    const spans = extractSourceAtomicNaturalLanguageSpans(source);

    expect(spans).toEqual([
      {
        start: prefix.length,
        end: prefix.length + instruction.length,
      },
    ]);
  });
});

describe("Page 13 long buttonhole guidance atomic span", () => {
  it("keeps the complete long-form buttonhole guidance atomic", () => {
    const instruction =
      "6 zincir atlıyoruz (düğme iliği oluşturuyoruz. " +
      "Düğme iliği için çektiğimiz zincir sayısını, " +
      "kullanacağınız düğme boyutuna göre arttırıp ya da azaltabilirsiniz.)";

    const prefix = "1) 34 zincir çekip dönüyoruz. ";
    const suffix = " Yedinci zincirden itibaren 28x örüyoruz.";
    const source = prefix + instruction + suffix;

    const spans = extractSourceAtomicNaturalLanguageSpans(source);

    expect(spans).toContainEqual({
      start: prefix.length,
      end: prefix.length + instruction.length,
    });
  });
});

describe("Page 13 exact-live buttonhole spelling regression", () => {
  it("keeps the live 'artırıp' spelling atomic", () => {
    const instruction =
      "6 zincir atlıyoruz (düğme iliği oluşturuyoruz. " +
      "Düğme iliği için çektiğimiz zincir sayısını, " +
      "kullanacağınız düğme boyutuna göre artırıp ya da azaltabilirsiniz.)";

    const spans = extractSourceAtomicNaturalLanguageSpans(instruction);

    expect(spans).toEqual([
      {
        start: 0,
        end: instruction.length,
      },
    ]);
  });
});
