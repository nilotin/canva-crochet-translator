import { describe, expect, it } from "vitest";
import {
  projectDeterministicFormattingRegions,
  projectSleeveAtomicFormattingRegions,
} from "../formatting_projection.js";

describe("formatting projection", () => {
  it("projects formatting across deterministic notation expansion", () => {
    const projected = projectDeterministicFormattingRegions(
      {
        id: "block-1",
        text: "6x, v, 4x",
        formattingRegions: [
          { id: "fmt-0", start: 0, end: 4 },
          { id: "fmt-red", start: 4, end: 5 },
          { id: "fmt-2", start: 5, end: 9 },
        ],
      },
      "en",
    );

    expect(projected).toEqual([
      { id: "fmt-0", start: 0, end: 5 },
      { id: "fmt-red", start: 5, end: 8 },
      { id: "fmt-2", start: 8, end: 13 },
    ]);
  });

  it.each([
    ["55cm", 5],
    ["2.20mm", 7],
    ["6. sıranın FLO’sundan", 18],
  ] as const)(
    "projects full-source formatting to the rendered target length for %s",
    (source, expectedEnd) => {
      const projected = projectDeterministicFormattingRegions(
        {
          id: "block-rendered-length",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: 0, end: source.length },
          ],
        },
        "en",
      );

      expect(projected).toEqual([
        { id: "fmt-0", start: 0, end: expectedEnd },
      ]);
    },
  );

  it.each([
    ["(55cm):", "(55 cm):", 1, 5, 1, 6],
    ["[2.20mm]", "[2.20 mm]", 1, 7, 1, 8],
  ] as const)(
    "projects mixed measurement formatting to rendered bounds for %s",
    (
      source,
      rendered,
      sourceTokenStart,
      sourceTokenEnd,
      targetTokenStart,
      targetTokenEnd,
    ) => {
      const projected = projectDeterministicFormattingRegions(
        {
          id: "block-mixed-measurement",
          text: source,
          formattingRegions: [
            { id: "fmt-prefix", start: 0, end: sourceTokenStart },
            {
              id: "fmt-token",
              start: sourceTokenStart,
              end: sourceTokenEnd,
            },
            { id: "fmt-suffix", start: sourceTokenEnd, end: source.length },
          ],
        },
        "en",
      );

      expect(projected).toEqual([
        { id: "fmt-prefix", start: 0, end: targetTokenStart },
        {
          id: "fmt-token",
          start: targetTokenStart,
          end: targetTokenEnd,
        },
        {
          id: "fmt-suffix",
          start: targetTokenEnd,
          end: rendered.length,
        },
      ]);
    },
  );

  it.each([
    ["(6. sıranın FLO’sundan):", "en", "(the FLO of Round 6):"],
    ["(6x):", "en", "(6sc):"],
    ["(3. sıra):", "es", "(Vuelta 3):"],
  ] as const)(
    "covers the rendered mixed target for %s in %s",
    (source, targetLanguage, rendered) => {
      const projected = projectDeterministicFormattingRegions(
        {
          id: "block-mixed-rendered-token",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: 0, end: source.length },
          ],
        },
        targetLanguage,
      );

      expect(projected).toEqual([
        { id: "fmt-0", start: 0, end: rendered.length },
      ]);
    },
  );

  it("does not guess projection when natural-language translation is involved", () => {
    const projected = projectDeterministicFormattingRegions(
      {
        id: "block-1",
        text: "6x örüyoruz",
        formattingRegions: [{ id: "fmt-0", start: 0, end: 12 }],
      },
      "en",
    );

    expect(projected).toBeUndefined();
  });
});

describe("bare round-count atomic semantic formatting projection", () => {
  it("projects reordered semantic pieces in target order", async () => {
    const { projectBareRoundCountAtomicFormattingRegions } =
      await import("../formatting_projection.js");

    const source = "2-11) 10 sıra 64x";
    const target = "2-11) 64sc for 10 rounds";

    const roundsStart = source.indexOf("10 sıra");
    const stitchesStart = source.indexOf("64x");

    expect(
      projectBareRoundCountAtomicFormattingRegions(
        source,
        target,
        [
          { id: "fmt-0", start: 0, end: roundsStart },
          { id: "fmt-1", start: roundsStart, end: stitchesStart },
          { id: "fmt-2", start: stitchesStart, end: source.length },
        ],
      ),
    ).toEqual([
      { id: "fmt-0", start: 0, end: target.indexOf("64sc") },
      {
        id: "fmt-2",
        start: target.indexOf("64sc"),
        end: target.indexOf("64sc") + "64sc".length,
      },
      {
        id: "fmt-1",
        start: target.indexOf("64sc") + "64sc".length,
        end: target.length,
      },
    ]);
  });

  it("refuses to guess when a formatting boundary splits a semantic piece", async () => {
    const { projectBareRoundCountAtomicFormattingRegions } =
      await import("../formatting_projection.js");

    const source = "2-11) 10 sıra 64x";
    const target = "2-11) 64sc for 10 rounds";

    expect(
      projectBareRoundCountAtomicFormattingRegions(
        source,
        target,
        [
          { id: "fmt-0", start: 0, end: 9 },
          { id: "fmt-1", start: 9, end: source.length },
        ],
      ),
    ).toBeUndefined();
  });
});

describe("sleeve atomic semantic formatting projection", () => {
  it("projects complete sleeve setup clauses onto canonical target clauses", () => {
    const source =
      "1) Görselde görüldüğü gibi kol boşluğunun arka tarafından ipimizi sabitliyoruz. 20x örüyoruz. Başlangıç noktamız burası olacak, işaretleyiciyi buraya takıyoruz.";

    const target =
      "1) As shown in the image, attach the yarn from the back of the armhole. Work 20sc. This will be the beginning of the round; place a stitch marker here.";

    const secondStart = source.indexOf("20x");
    const thirdStart = source.indexOf("Başlangıç noktamız");

    const targetSecondStart = target.indexOf("Work 20sc");
    const targetThirdStart = target.indexOf(
      "This will be the beginning of the round",
    );

    expect(
      projectSleeveAtomicFormattingRegions(
        source,
        target,
        [
          { id: "fmt-0", start: 0, end: secondStart },
          {
            id: "fmt-1",
            start: secondStart,
            end: thirdStart,
          },
          {
            id: "fmt-2",
            start: thirdStart,
            end: source.length,
          },
        ],
      ),
    ).toEqual([
      {
        id: "fmt-0",
        start: 0,
        end: targetSecondStart,
      },
      {
        id: "fmt-1",
        start: targetSecondStart,
        end: targetThirdStart,
      },
      {
        id: "fmt-2",
        start: targetThirdStart,
        end: target.length,
      },
    ]);
  });

  it("refuses sleeve projection when a style boundary cuts through a semantic clause", () => {
    const source =
      "1) Görselde görüldüğü gibi kol boşluğunun arka tarafından ipimizi sabitliyoruz. 20x örüyoruz. Başlangıç noktamız burası olacak, işaretleyiciyi buraya takıyoruz.";

    const target =
      "1) As shown in the image, attach the yarn from the back of the armhole. Work 20sc. This will be the beginning of the round; place a stitch marker here.";

    const splitInsideFirstClause = source.indexOf("kol boşluğunun");

    expect(
      projectSleeveAtomicFormattingRegions(
        source,
        target,
        [
          {
            id: "fmt-0",
            start: 0,
            end: splitInsideFirstClause,
          },
          {
            id: "fmt-1",
            start: splitInsideFirstClause,
            end: source.length,
          },
        ],
      ),
    ).toBeUndefined();
  });

  it("refuses sleeve projection when target is not the canonical renderer output", () => {
    const source =
      "1) Görselde görüldüğü gibi kol boşluğunun arka tarafından ipimizi sabitliyoruz. 20x örüyoruz. Başlangıç noktamız burası olacak, işaretleyiciyi buraya takıyoruz.";

    const nonCanonicalTarget =
      "1) This will be the beginning of the round; place a stitch marker here. Work 20sc. As shown in the image, attach the yarn from the back of the armhole.";

    const secondStart = source.indexOf("20x");
    const thirdStart = source.indexOf("Başlangıç noktamız");

    expect(
      projectSleeveAtomicFormattingRegions(
        source,
        nonCanonicalTarget,
        [
          { id: "fmt-0", start: 0, end: secondStart },
          {
            id: "fmt-1",
            start: secondStart,
            end: thirdStart,
          },
          {
            id: "fmt-2",
            start: thirdStart,
            end: source.length,
          },
        ],
      ),
    ).toBeUndefined();
  });
});

describe("compact crochet-row semantic formatting projection", () => {
  it("projects BLO intro, stitch sequence, and turn action independently", async () => {
    const { projectCompactCrochetRowFormattingRegions } =
      await import("../formatting_projection.js");

    const source =
      "2) Bu sırayı Blo’dan örüyoruz. 2x, 1v, (4x,1v)*3, 2x = 24x, 1 zincir, dön,";
    const target =
      "2) Work this round in BLO. 2sc, 1inc, (4sc,1inc)*3, 2sc = 24sc, Ch 1 and turn,";

    const stitchStart = source.indexOf("2x, 1v");
    const turnStart = source.indexOf("1 zincir");

    const targetStitchStart = target.indexOf("2sc, 1inc");
    const targetTurnStart = target.indexOf("Ch 1 and turn");

    expect(
      projectCompactCrochetRowFormattingRegions(
        source,
        target,
        [
          { id: "fmt-0", start: 0, end: stitchStart },
          { id: "fmt-1", start: stitchStart, end: turnStart },
          { id: "fmt-2", start: turnStart, end: source.length },
        ],
      ),
    ).toEqual([
      { id: "fmt-0", start: 0, end: targetStitchStart },
      {
        id: "fmt-1",
        start: targetStitchStart,
        end: targetTurnStart,
      },
      {
        id: "fmt-2",
        start: targetTurnStart,
        end: target.length,
      },
    ]);
  });

  it("projects a plain stitch row and turn action independently", async () => {
    const { projectCompactCrochetRowFormattingRegions } =
      await import("../formatting_projection.js");

    const source = "3) 24x, 1 zincir, dön,";
    const target = "3) 24sc, Ch 1 and turn,";

    const turnStart = source.indexOf("1 zincir");
    const targetTurnStart = target.indexOf("Ch 1");

    expect(
      projectCompactCrochetRowFormattingRegions(
        source,
        target,
        [
          { id: "fmt-0", start: 0, end: turnStart },
          { id: "fmt-1", start: turnStart, end: source.length },
        ],
      ),
    ).toEqual([
      {
        id: "fmt-0",
        start: 0,
        end: targetTurnStart,
      },
      {
        id: "fmt-1",
        start: targetTurnStart,
        end: target.length,
      },
    ]);
  });

  it("projects stitch and chain-cut actions across a source-to-target sentence split", async () => {
    const { projectCompactCrochetRowFormattingRegions } =
      await import("../formatting_projection.js");

    const source = "4) 24x, 1 zincir çekip ipimizi kesiyoruz.";
    const target = "4) 24sc. Ch 1 and cut the yarn.";

    const finishingStart = source.indexOf("1 zincir");
    const targetFinishingStart = target.indexOf("Ch 1");

    expect(
      projectCompactCrochetRowFormattingRegions(
        source,
        target,
        [
          { id: "fmt-0", start: 0, end: finishingStart },
          {
            id: "fmt-1",
            start: finishingStart,
            end: source.length,
          },
        ],
      ),
    ).toEqual([
      {
        id: "fmt-0",
        start: 0,
        end: targetFinishingStart,
      },
      {
        id: "fmt-1",
        start: targetFinishingStart,
        end: target.length,
      },
    ]);
  });

  it("refuses projection when a Canva boundary splits a compact semantic piece", async () => {
    const { projectCompactCrochetRowFormattingRegions } =
      await import("../formatting_projection.js");

    const source = "4) 24x, 1 zincir çekip ipimizi kesiyoruz.";
    const target = "4) 24sc. Ch 1 and cut the yarn.";

    expect(
      projectCompactCrochetRowFormattingRegions(
        source,
        target,
        [
          { id: "fmt-0", start: 0, end: 5 },
          { id: "fmt-1", start: 5, end: source.length },
        ],
      ),
    ).toBeUndefined();
  });
});

describe("sentence projection safety regressions", () => {
  it("does not treat equal sentence counts as semantic correspondence when target order is reversed", () => {
    const source =
      "1) Görselde görüldüğü gibi kol boşluğunun arka tarafından ipimizi sabitliyoruz. 20x örüyoruz. Başlangıç noktamız burası olacak, işaretleyiciyi buraya takıyoruz.";

    const reversedTarget =
      "1) This will be the beginning of the round; place a stitch marker here. Work 20sc. As shown in the image, attach the yarn from the back of the armhole.";

    const firstBoundary = source.indexOf("20x");
    const secondBoundary = source.indexOf("Başlangıç noktamız");

    expect(
      projectSleeveAtomicFormattingRegions(
        source,
        reversedTarget,
        [
          { id: "fmt-0", start: 0, end: firstBoundary },
          {
            id: "fmt-1",
            start: firstBoundary,
            end: secondBoundary,
          },
          {
            id: "fmt-2",
            start: secondBoundary,
            end: source.length,
          },
        ],
      ),
    ).toBeUndefined();
  });

  it("does not project unrelated equal-count sentences without deterministic family provenance", () => {
    const source = "Birinci cümle. İkinci cümle.";
    const target = "First sentence. Second sentence.";

    const boundary = source.indexOf("İkinci");

    expect(
      projectSleeveAtomicFormattingRegions(
        source,
        target,
        [
          { id: "fmt-0", start: 0, end: boundary },
          {
            id: "fmt-1",
            start: boundary,
            end: source.length,
          },
        ],
      ),
    ).toBeUndefined();
  });
});

describe("compact crochet-row structural validation regressions", () => {
  it("refuses chain-cut projection when stitch count changes", async () => {
    const { projectCompactCrochetRowFormattingRegions } =
      await import("../formatting_projection.js");

    const source = "4) 24x, 1 zincir çekip ipimizi kesiyoruz.";
    const target = "4) 99sc. Ch 1 and cut the yarn.";

    const finishingStart = source.indexOf("1 zincir");

    expect(
      projectCompactCrochetRowFormattingRegions(
        source,
        target,
        [
          { id: "fmt-0", start: 0, end: finishingStart },
          {
            id: "fmt-1",
            start: finishingStart,
            end: source.length,
          },
        ],
      ),
    ).toBeUndefined();
  });

  it("refuses chain-cut projection when row marker changes", async () => {
    const { projectCompactCrochetRowFormattingRegions } =
      await import("../formatting_projection.js");

    const source = "4) 24x, 1 zincir çekip ipimizi kesiyoruz.";
    const target = "9) 24sc. Ch 1 and cut the yarn.";

    const finishingStart = source.indexOf("1 zincir");

    expect(
      projectCompactCrochetRowFormattingRegions(
        source,
        target,
        [
          { id: "fmt-0", start: 0, end: finishingStart },
          {
            id: "fmt-1",
            start: finishingStart,
            end: source.length,
          },
        ],
      ),
    ).toBeUndefined();
  });

  it("refuses BLO projection when the stitch sequence changes", async () => {
    const { projectCompactCrochetRowFormattingRegions } =
      await import("../formatting_projection.js");

    const source =
      "2) Bu sırayı Blo’dan örüyoruz. 2x, 1v, (4x,1v)*3, 2x = 24x, 1 zincir, dön,";
    const target =
      "2) Work this round in BLO. 2sc, 1inc, (4sc,1inc)*3, 2sc = 99sc, Ch 1 and turn,";

    const stitchStart = source.indexOf("2x, 1v");
    const turnStart = source.indexOf("1 zincir");

    expect(
      projectCompactCrochetRowFormattingRegions(
        source,
        target,
        [
          { id: "fmt-0", start: 0, end: stitchStart },
          { id: "fmt-1", start: stitchStart, end: turnStart },
          { id: "fmt-2", start: turnStart, end: source.length },
        ],
      ),
    ).toBeUndefined();
  });

  it("refuses plain chain-turn projection when stitch count changes", async () => {
    const { projectCompactCrochetRowFormattingRegions } =
      await import("../formatting_projection.js");

    const source = "3) 24x, 1 zincir, dön,";
    const target = "3) 99sc, Ch 1 and turn,";

    const turnStart = source.indexOf("1 zincir");

    expect(
      projectCompactCrochetRowFormattingRegions(
        source,
        target,
        [
          { id: "fmt-0", start: 0, end: turnStart },
          {
            id: "fmt-1",
            start: turnStart,
            end: source.length,
          },
        ],
      ),
    ).toBeUndefined();
  });
});
