import { describe, expect, it } from "vitest";
import { validateReturnedBlockIds, validateTranslation } from "../validator.js";

const errorCodes = (result: ReturnType<typeof validateTranslation>) =>
  result.errors.map(({ code }) => code);

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

describe("validateTranslation", () => {
  it("warns about ambiguous compressed repetition notation without changing validity or numbers", () => {
    const result = validateTranslation(
      "11) FLO’ dan (9x, 1v)*66x",
      "11) In FLO, (9sc, 1inc)*66sc",
      "en",
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContainEqual({
      code: "AMBIGUOUS_REPETITION_NOTATION",
      message:
        "Ambiguous repetition notation detected in the source: *66x. Please review this instruction.",
    });
    expect(errorCodes(result)).not.toContain("NUMBER_MISMATCH");
  });

  it.each([
    ["(9x, 1v)*6 = 66x", "(9sc, 1inc)*6 = 66sc"],
    ["66x", "66sc"],
    ["*6", "*6"],
    ["(9x, 1v)*6", "(9sc, 1inc)*6"],
    ["Alan * 66 x uzunluğundadır.", "The area is * 66 stitches long."],
  ])("does not flag unambiguous repetition or prose: %s", (source, target) => {
    const result = validateTranslation(source, target, "en");
    expect(result.warnings.map(({ code }) => code)).not.toContain(
      "AMBIGUOUS_REPETITION_NOTATION",
    );
  });

  it("still blocks integrity changes when ambiguous source notation is present", () => {
    const changedNumber = validateTranslation(
      "11) FLO’ dan (9x, 1v)*66x",
      "11) In FLO, (9sc, 1inc)*65sc",
      "en",
    );
    const lostNotation = validateTranslation(
      "11) FLO’ dan (9x, 1v)*66x",
      "11) In FLO, (9sc, 1inc)*66",
      "en",
    );

    expect(changedNumber.valid).toBe(false);
    expect(errorCodes(changedNumber)).toContain("NUMBER_MISMATCH");
    expect(lostNotation.valid).toBe(false);
    expect(errorCodes(lostNotation)).toContain("LOST_PATTERN_NOTATION");
    expect(changedNumber.warnings.map(({ code }) => code)).toContain(
      "AMBIGUOUS_REPETITION_NOTATION",
    );
    expect(lostNotation.warnings.map(({ code }) => code)).toContain(
      "AMBIGUOUS_REPETITION_NOTATION",
    );
  });

  it.each([
    "__XQZZZZQX__",
    "__XQRENAMEDQX__",
    "crochet __XQZZZZQX__",
  ])("rejects reserved placeholder syntax in final output: %s", (translated) => {
    const result = validateTranslation("Normal Türkçe metin.", translated, "en");

    expect(result.valid).toBe(false);
    expect(errorCodes(result)).toContain("RESERVED_PLACEHOLDER_LEAK");
    expect(result.errors).toContainEqual({
      code: "RESERVED_PLACEHOLDER_LEAK",
      message:
        "Internal translation placeholder syntax was found in the output.",
    });
  });

  it.each(["XQ", "__HELLO__", "XQZZZZQX"])(
    "allows ordinary text outside the reserved placeholder namespace: %s",
    (translated) => {
      expect(errorCodes(validateTranslation("Metin", translated, "en"))).not.toContain(
        "RESERVED_PLACEHOLDER_LEAK",
      );
    },
  );

  it("does not treat contextual length and spacing shorthand as sc notation", () => {
    const result = validateTranslation(
      "Kaş — 4x uzunluğunda, aralarında 9x kalacak şekilde, gözden 4 sıra üzerinden işliyoruz.",
      "Eyebrow — 4 stitches long, with 9 stitches between them, worked 4 rounds above the eye.",
      "en",
    );

    expect(result.errors).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "LOST_PATTERN_NOTATION" }),
      ]),
    );
  });

  it("still treats a numbered x before natural instructions as sc notation", () => {
    const result = validateTranslation(
      "1. 6x ile sh oluşturuyoruz.",
      "1. We create a MR with 6 stitches.",
      "en",
    );

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "LOST_PATTERN_NOTATION" }),
      ]),
    );
  });

  it("does not match the yarn glossary term inside çekip", () => {
    const result = validateTranslation(
      "2 zn çekip sabitliyoruz.",
      "Pull 2 ch and secure it.",
      "en",
    );

    expect(result.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "POSSIBLE_GLOSSARY_MISMATCH" }),
      ]),
    );
  });

  it("still matches the inflected yarn term İpi", () => {
    const result = validateTranslation(
      "İpi arkada bırakıyoruz.",
      "Leave it at the back.",
      "en",
    );

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "POSSIBLE_GLOSSARY_MISMATCH" }),
      ]),
    );
  });

  it("accepts long tail as contextual terminology for Turkish ip", () => {
    const result = validateTranslation(
      "Kafayı vücuda dikmek için ipi uzun bırakıyoruz.",
      "Leave a long tail to sew the head to the body.",
      "en",
    );

    expect(result.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "POSSIBLE_GLOSSARY_MISMATCH",
          message: expect.stringContaining("ip"),
        }),
      ]),
    );
  });

  it("does not treat a noun phrase like apron top part as a critical spatial anchor", () => {
    const result = validateTranslation(
      "Önlüğün üst kısmından ipimizi sabitliyoruz.",
      "Attach the yarn from the top part of the apron.",
      "en",
    );

    expect(errorCodes(result)).not.toContain("SEMANTIC_ANCHOR_MISSING");
    expect(result.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SEMANTIC_ANCHOR_MISSING" }),
      ]),
    );
  });

  it("does not treat önceki as a critical front-placement anchor", () => {
    const result = validateTranslation(
      "Renk geçişlerinde bir önceki ipi kesmeden, içeride beklemeye alıyoruz.",
      "When changing colors, do not cut the previous yarn; leave it inside.",
      "en",
    );

    expect(errorCodes(result)).not.toContain("SEMANTIC_ANCHOR_MISSING");
    expect(result.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SEMANTIC_ANCHOR_MISSING",
        }),
      ]),
    );
  });

  it("does not treat crochet surface wording like zincir üstü as a critical above anchor", () => {
    const result = validateTranslation(
      "Zincir üstüne 5x örüyoruz.",
      "Work 5sc on the chain.",
      "en",
    );

    expect(errorCodes(result)).not.toContain("SEMANTIC_ANCHOR_MISSING");
    expect(result.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SEMANTIC_ANCHOR_MISSING" }),
      ]),
    );
  });

  it.each([
    ["Bir üst sıraya geçiyoruz.", "Move to the next row.", "en"],
    ["Bir alt sıraya geçiyoruz.", "Move to the next row down.", "en"],
    ["Bir üst sıraya geçiyoruz.", "Pasamos a la siguiente vuelta.", "es"],
  ] as const)(
    "does not require a literal above/below term for the ordinary row-transition idiom: %s -> %s (%s)",
    (source, translated, targetLanguage) => {
      const result = validateTranslation(source, translated, targetLanguage);

      expect(errorCodes(result)).not.toContain("SEMANTIC_ANCHOR_MISSING");
      expect(result.warnings).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "SEMANTIC_ANCHOR_MISSING" }),
        ]),
      );
      expect(result.valid).toBe(true);
    },
  );

  it("still flags a genuine, non-idiomatic üst reference even when the row-transition idiom also appears in the same text", () => {
    // The idiom-exclusion above is scoped to the specific "üst sıra"/
    // "alt sıra" occurrence, not a blanket skip of the "upper" anchor: a
    // second, genuinely spatial "üst" reference in the same block (here,
    // sewing a piece onto the head's upper side) must still be caught if
    // the translation drops it.
    const result = validateTranslation(
      "Bir üst sıraya geçiyoruz. Parçanın üst kısmını başın ön tarafına dikiyoruz.",
      "Move to the next row. We sew the piece to the front of the head.",
      "en",
    );

    expect(errorCodes(result)).toContain("SEMANTIC_ANCHOR_MISSING");
  });

  it("recommends manual review for spatial and directional instructions", () => {
    const result = validateTranslation(
      "Arkadan giriş yapıyoruz. Ön tarafta üstten çıkış yapıp alta giriyoruz.",
      "Enter from the back, exit at the upper front, and enter below.",
      "en",
    );

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MANUAL_REVIEW_RECOMMENDED" }),
      ]),
    );
    expect(result.valid).toBe(true);
  });

  it.each([
    ["The eyebrow is worked 4 rows from the face."],
    ["Work 4 rounds above the face."],
  ])("blocks a missing critical above-eye semantic anchor", (translated) => {
    const result = validateTranslation(
      "gözden 4 sıra üzerinden işliyoruz.",
      translated,
      "en",
    );

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SEMANTIC_ANCHOR_MISSING" }),
      ]),
    );
  });

  it("accepts the critical above-eye semantic anchors", () => {
    const result = validateTranslation(
      "gözden 4 sıra üzerinden işliyoruz.",
      "Work 4 rounds above the eye.",
      "en",
    );

    expect(errorCodes(result)).not.toContain("SEMANTIC_ANCHOR_MISSING");
  });

  it("blocks a lost eyebrow anchor in a complex placement instruction", () => {
    const result = validateTranslation(
      "Kaş gözden 4 sıra üzerinden işleniyor.",
      "Work the eyelash 4 rounds above the eye.",
      "en",
    );

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SEMANTIC_ANCHOR_MISSING" }),
      ]),
    );
  });

  it("flags known poor Spanish fluency", () => {
    const result = validateTranslation(
      "Çiçeği sabitlemek için işliyoruz.",
      "Securizamos el primer flor desde debajo.",
      "es",
    );

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "TARGET_LANGUAGE_FLUENCY_REVIEW",
        }),
      ]),
    );
  });

  it.each(["Aseguramos la flor.", "Fijamos la flor."])(
    "does not flag a preferred Spanish fastening verb: %s",
    (translated) => {
      const result = validateTranslation(
        "Çiçeği sabitlemek için işliyoruz.",
        translated,
        "es",
      );

      expect(result.warnings).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "TARGET_LANGUAGE_FLUENCY_REVIEW",
          }),
        ]),
      );
    },
  );

  it("rejects a changed numeric value", () => {
    const result = validateTranslation(
      "55 zincir çekiyoruz. 2 zincir çekiyoruz.",
      "Chain 50. Chain 2.",
      "en",
    );

    expect(result.valid).toBe(false);
    expect(errorCodes(result)).toContain("NUMBER_MISMATCH");
  });

  it("accepts multiple verified bare round-count swaps inside a composed block", () => {
    const result = validateTranslation(
      "2-11) 10 sıra 64x\n12) 60x\n19-33) 15 sıra 48x",
      "2-11) 64sc for 10 rounds\n12) 60sc\n19-33) 48sc for 15 rounds",
      "en",
    );

    expect(result.valid).toBe(true);
    expect(errorCodes(result)).not.toContain("NUMBER_MISMATCH");
  });

  it.each([
    [
      "changed stitch count",
      "2-11) 63sc for 10 rounds\n12) 60sc\n19-33) 48sc for 15 rounds",
    ],
    [
      "changed round count",
      "2-11) 64sc for 9 rounds\n12) 60sc\n19-33) 48sc for 15 rounds",
    ],
    [
      "arbitrary reorder elsewhere",
      "2-11) 64sc for 10 rounds\n60) 12sc\n19-33) 48sc for 15 rounds",
    ],
    [
      "noncanonical sentence with reordered values",
      "2-11) Work rounds 64 through 10.\n12) 60sc\n19-33) 48sc for 15 rounds",
    ],
    [
      "incorrect pluralization",
      "2-11) 64sc for 10 round\n12) 60sc\n19-33) 48sc for 15 rounds",
    ],
  ])("rejects %s around local bare round-count swaps", (_label, translated) => {
    const result = validateTranslation(
      "2-11) 10 sıra 64x\n12) 60x\n19-33) 15 sıra 48x",
      translated,
      "en",
    );

    expect(result.valid).toBe(false);
    expect(errorCodes(result)).toContain("NUMBER_MISMATCH");
  });

  it("accepts the verified yarn-cut swap inside the persisted 9-line/8-line Block 3", () => {
    expect(REAL_BLOCK_3_SOURCE.split("\n")).toHaveLength(9);
    expect(REAL_BLOCK_3_TARGET.split("\n")).toHaveLength(8);

    const result = validateTranslation(
      REAL_BLOCK_3_SOURCE,
      REAL_BLOCK_3_TARGET,
      "en",
    );

    expect(result.valid).toBe(true);
    expect(errorCodes(result)).not.toContain("NUMBER_MISMATCH");
  });

  it("accepts an exact yarn-cut semantic span without surrounding newlines", () => {
    const result = validateTranslation(
      "10-15) 6 sıra 18x --- ipimizi kesiyoruz. 20x",
      "10-15) 18sc for 6 rounds — cut the yarn. 20sc",
      "en",
    );

    expect(result.valid).toBe(true);
    expect(errorCodes(result)).not.toContain("NUMBER_MISMATCH");
  });

  it.each([
    ["changed stitch count", REAL_BLOCK_3_TARGET.replace("18sc for", "17sc for")],
    ["changed round count", REAL_BLOCK_3_TARGET.replace("for 6 rounds", "for 5 rounds")],
    ["changed range", REAL_BLOCK_3_TARGET.replace("10-15)", "10-14)")],
    ["wrong plurality", REAL_BLOCK_3_TARGET.replace("6 rounds", "6 round")],
    [
      "noncanonical yarn-cut wording",
      REAL_BLOCK_3_TARGET.replace(
        "18sc for 6 rounds — cut the yarn.",
        "Work 18sc for 6 rounds, then cut our yarn.",
      ),
    ],
    [
      "removed canonical span",
      REAL_BLOCK_3_TARGET.replace(
        "\n10-15) 18sc for 6 rounds — cut the yarn. ",
        "",
      ),
    ],
    [
      "extra canonical span",
      `${REAL_BLOCK_3_TARGET}\n20-21) 18sc for 2 rounds — cut the yarn.`,
    ],
    [
      "reordered earlier-round values",
      REAL_BLOCK_3_TARGET.replace(
        "4) (7sc, 1dec)*6 = 48sc",
        "4) (1dec, 7sc)*6 = 48sc",
      ),
    ],
    [
      "changed value before semantic span",
      REAL_BLOCK_3_TARGET.replace("= 48sc", "= 47sc"),
    ],
    [
      "arbitrary reorder elsewhere",
      REAL_BLOCK_3_TARGET.replace(
        "5) 3sc, 1dec, (6sc, 1dec)*5, 3sc = 42sc",
        "5) 1dec, 3sc, (6sc, 1dec)*5, 3sc = 42sc",
      ),
    ],
  ])("rejects %s in the complete Block 3 context", (_label, translated) => {
    const result = validateTranslation(
      REAL_BLOCK_3_SOURCE,
      translated,
      "en",
    );

    expect(result.valid).toBe(false);
    expect(errorCodes(result)).toContain("NUMBER_MISMATCH");
  });

  it("accepts a written Turkish stitch count rendered numerically", () => {
    const result = validateTranslation(
      "7) M(aynı anda üç ilmeği birlikte kesmek), 11x",
      "7) M (decrease 3 stitches together), 11sc",
      "en",
    );

    expect(errorCodes(result)).not.toContain("NUMBER_MISMATCH");
  });

  it("accepts a written Turkish chain count rendered numerically", () => {
    const result = validateTranslation(
      "11-35) 25 sıra 12x bir zincir çekip ipimizi kesiyoruz.",
      "11-35) 25 rounds, 12sc. Ch 1 and cut the yarn.",
      "en",
    );

    expect(errorCodes(result)).not.toContain("NUMBER_MISMATCH");
  });

  it("still rejects a changed written Turkish crochet count", () => {
    const result = validateTranslation(
      "7) M(aynı anda üç ilmeği birlikte kesmek), 11x",
      "7) M (decrease 4 stitches together), 11sc",
      "en",
    );

    expect(errorCodes(result)).toContain("NUMBER_MISMATCH");
  });

  it("does not treat ordinary Turkish number words as protected numeric values", () => {
    const result = validateTranslation(
      "Bir süre sonra 5x örüyoruz.",
      "After 1 while, work 5sc.",
      "en",
    );

    expect(errorCodes(result)).toContain("NUMBER_MISMATCH");
  });

  it("rejects a missing repetition count", () => {
    const result = validateTranslation("(1x, v) x 6", "(1sc, inc)", "en");

    expect(result.valid).toBe(false);
    expect(errorCodes(result)).toContain("REPETITION_COUNT_MISMATCH");
  });

  it("preserves all values in an eyebrow instruction", () => {
    const result = validateTranslation(
      "Kaş — 4x uzunluğunda, aralarında 9x kalacak şekilde, gözden 4 sıra üzerinden işliyoruz.",
      "Embroider the eyebrow 4sc long, leaving 9sc between them, 4 rounds above the eye.",
      "en",
    );

    expect(result.valid).toBe(true);
    expect(errorCodes(result)).not.toContain("NUMBER_MISMATCH");
    expect(errorCodes(result)).not.toContain("REPETITION_COUNT_MISMATCH");
  });

  it("preserves a leading instruction number and stitch count", () => {
    const result = validateTranslation(
      "1. 6 sık iğne ile sihirli halka oluşturuyoruz.",
      "1. Make a magic ring with 6 single crochet stitches.",
      "en",
    );

    expect(result.valid).toBe(true);
    expect(errorCodes(result)).not.toContain("NUMBER_MISMATCH");
  });

  it("does not treat a leading decimal as an instruction marker", () => {
    const result = validateTranslation(
      "2.00 no tığ ile örüyoruz.",
      "We crochet with a 2.00 mm hook.",
      "en",
    );

    expect(errorCodes(result)).not.toContain("LOST_PATTERN_NOTATION");
    expect(errorCodes(result)).not.toContain("NUMBER_MISMATCH");
  });

  it("rejects a lost leading instruction marker", () => {
    const result = validateTranslation(
      "1. 6 sık iğne ile sihirli halka oluşturuyoruz.",
      "Make a magic ring with 1 group of 6 single crochet stitches.",
      "en",
    );

    expect(result.valid).toBe(false);
    expect(errorCodes(result)).toContain("LOST_PATTERN_NOTATION");
  });

  it("rejects empty and missing translations", () => {
    expect(errorCodes(validateTranslation("Metin", "", "en"))).toContain(
      "EMPTY_TRANSLATION",
    );
    expect(errorCodes(validateTranslation("Metin", undefined, "en"))).toContain(
      "MISSING_TRANSLATION",
    );
  });

  it("rejects lost pattern notation and parentheses", () => {
    const result = validateTranslation("(1x, v) x 6 CC", "1sc x 6", "en");

    expect(errorCodes(result)).toContain("LOST_PATTERN_NOTATION");
    expect(errorCodes(result)).toContain("PARENTHESES_MISMATCH");
  });

  it("allows parentheses removal only for the recognized hook and yarn intro", () => {
    const recognized = validateTranslation(
      "2.20 numara tığ, siyah ip (Catania 110) ile örüyoruz.",
      "With a 2.20 mm crochet hook and black Catania 110 yarn, work as follows.",
      "en",
    );

    expect(errorCodes(recognized)).not.toContain("PARENTHESES_MISMATCH");

    const unrelated = validateTranslation(
      "Parçayı (arka taraftan) dikiyoruz.",
      "Sew the piece from the back.",
      "en",
    );

    expect(errorCodes(unrelated)).toContain("PARENTHESES_MISMATCH");
  });

  it("rejects extra target parentheses in the recognized hook and yarn intro", () => {
    const result = validateTranslation(
      "2 numara tığ, pamuk ip (Catania) ile örüyoruz.",
      "With a 2 mm crochet hook and Catania yarn (((, work as follows.",
      "en",
    );

    expect(result.valid).toBe(false);
    expect(errorCodes(result)).toContain("PARENTHESES_MISMATCH");
  });

  it("still allows flattening the recognized material brand parentheses", () => {
    const result = validateTranslation(
      "2 numara tığ, pamuk ip (Catania) ile örüyoruz.",
      "With a 2 mm crochet hook and cotton Catania yarn, work as follows.",
      "en",
    );

    expect(errorCodes(result)).not.toContain("PARENTHESES_MISMATCH");
  });

  it("warns about suspicious length and glossary mismatches", () => {
    const result = validateTranslation(
      "Kaş için sık iğne kullanarak çok uzun bir açıklama oluşturuyoruz.",
      "Short.",
      "en",
    );
    const warningCodes = result.warnings.map(({ code }) => code);

    expect(warningCodes).toContain("SUSPICIOUSLY_SHORT_TRANSLATION");
    expect(warningCodes).toContain("POSSIBLE_GLOSSARY_MISMATCH");
  });

  it.each([
    ["en", "(1sc, inc) x 6"],
    ["es", "(1pb, aum) x 6"],
  ] as const)(
    "distinguishes Turkish stitch x from multiplication for %s",
    (targetLanguage, translated) => {
      const result = validateTranslation(
        "(1x, v) x 6",
        translated,
        targetLanguage,
      );

      expect(result.valid).toBe(true);
    },
  );

  it("does not match dc inside dc-inc", () => {
    const result = validateTranslation("dc", "dc-inc", "en");

    expect(result.valid).toBe(false);
    expect(errorCodes(result)).toContain("LOST_PATTERN_NOTATION");
  });

  it.each([
    ["en", "6sc, inc, 6sc, SL.ST"],
    ["es", "6pb, aum, 6pb, pd"],
  ] as const)(
    "accepts complete project notation conversion for %s",
    (targetLanguage, translated) => {
      const result = validateTranslation(
        "6x, v, 6x, CC",
        translated,
        targetLanguage,
      );

      expect(result.valid).toBe(true);
    },
  );

  it.each([
    ["en", "25sc, 40SL.ST, 1sc skip, SL.ST in the next stitch"],
    ["es", "25pb, 40pd, saltar 1pb, pd en el siguiente punto"],
  ] as const)(
    "accepts lowercase cc as slip-stitch notation without inflating x counts for %s",
    (targetLanguage, translated) => {
      const result = validateTranslation(
        "25x, 40cc, 1x atla, sıradaki ilmeğe cc",
        translated,
        targetLanguage,
      );

      expect(errorCodes(result)).not.toContain("LOST_PATTERN_NOTATION");
    },
  );

  it.each([
    ["Cc", "en", "SL.ST"],
    ["cC", "es", "pd"],
    ["FlO", "en", "FLO"],
    ["fLo", "es", "Flo"],
    ["BlO", "en", "BLO"],
    ["bLo", "es", "Blo"],
    ["Dc", "en", "dc"],
    ["Hdc", "en", "hdc"],
  ] as const)(
    "validates mixed-case source notation: %s",
    (source, targetLanguage, translated) => {
      const result = validateTranslation(
        source,
        translated,
        targetLanguage,
      );

      expect(result.valid).toBe(true);
      expect(errorCodes(result)).not.toContain("LOST_PATTERN_NOTATION");
    },
  );

  it.each([
    ["Cc", "en"],
    ["FlO", "en"],
    ["BlO", "es"],
    ["Dc", "en"],
    ["Hdc", "en"],
  ] as const)(
    "rejects lost mixed-case source notation: %s",
    (source, targetLanguage) => {
      const result = validateTranslation(
        source,
        "ordinary prose",
        targetLanguage,
      );

      expect(result.valid).toBe(false);
      expect(errorCodes(result)).toContain("LOST_PATTERN_NOTATION");
    },
  );

  it.each(["sc", "Sc", "SC"])(
    "treats %s as a valid single-crochet target casing when notationCaseInsensitive is set " +
      "(the same option translateSegment now passes at the segment level, matching the " +
      "full-block validation call sites)",
    (targetCasing) => {
      const result = validateTranslation("x örüyoruz", `${targetCasing} we work`, "en", {
        notationCaseInsensitive: true,
      });

      expect(errorCodes(result)).not.toContain("LOST_PATTERN_NOTATION");
    },
  );

  it("still flags a genuinely lost sc notation even with notationCaseInsensitive set", () => {
    const result = validateTranslation("x örüyoruz", "we work", "en", {
      notationCaseInsensitive: true,
    });

    expect(errorCodes(result)).toContain("LOST_PATTERN_NOTATION");
  });

  it("rejects mismatched sc casing by default (case sensitivity is opt-in, not the default)", () => {
    const result = validateTranslation("x örüyoruz", "Sc we work", "en");

    expect(errorCodes(result)).toContain("LOST_PATTERN_NOTATION");
  });

  it("rejects an unconverted Turkish abbreviation", () => {
    const result = validateTranslation(
      "6x, v, 6x, CC",
      "6pb, aum, 6pb, CC",
      "es",
    );

    expect(result.valid).toBe(false);
    expect(errorCodes(result)).toContain("LOST_PATTERN_NOTATION");
  });

  it.each([
    ["en", "hdc-inc"],
    ["es", "aum-mpa"],
  ] as const)("converts hdcv for %s", (targetLanguage, translated) => {
    expect(validateTranslation("hdcv", translated, targetLanguage).valid).toBe(
      true,
    );
  });

  it.each([
    ["en", "tr-inc"],
    ["es", "aum-pa-tri"],
  ] as const)("converts trv for %s", (targetLanguage, translated) => {
    expect(validateTranslation("trv", translated, targetLanguage).valid).toBe(
      true,
    );
  });

  it.each([
    ["en", "dc-inc, dc-dec"],
    ["es", "aum-pa, dism-pa"],
  ] as const)(
    "converts dcv and dce without substring collisions for %s",
    (targetLanguage, translated) => {
      expect(
        validateTranslation("dcv, dce", translated, targetLanguage).valid,
      ).toBe(true);
    },
  );

  it.each([
    ["en", "esc-inc"],
    ["es", "aum-pb-ex"],
  ] as const)("converts escv for %s", (targetLanguage, translated) => {
    expect(validateTranslation("escv", translated, targetLanguage).valid).toBe(
      true,
    );
  });

  it.each([
    ["en", "escw"],
    ["es", "W-pb-ex"],
  ] as const)("converts escw for %s", (targetLanguage, translated) => {
    expect(validateTranslation("escw", translated, targetLanguage).valid).toBe(
      true,
    );
  });

  it("rejects an unconverted Spanish escw", () => {
    const result = validateTranslation("escw", "escw", "es");

    expect(result.valid).toBe(false);
    expect(errorCodes(result)).toContain("LOST_PATTERN_NOTATION");
  });

  it.each([
    ["en", "esc, esc-inc, escw"],
    ["es", "pb-ex, aum-pb-ex, W-pb-ex"],
  ] as const)(
    "converts the complete extended-stitch family for %s",
    (targetLanguage, translated) => {
      expect(
        validateTranslation("esc, escv, escw", translated, targetLanguage)
          .valid,
      ).toBe(true);
    },
  );
});

describe("validateReturnedBlockIds", () => {
  it("detects duplicate, missing, and unexpected returned IDs", () => {
    const result = validateReturnedBlockIds(
      [
        { id: "block-1", text: "Bir" },
        { id: "block-2", text: "İki" },
      ],
      [
        { id: "block-1", translated: "One" },
        { id: "block-1", translated: "One again" },
        { id: "block-3", translated: "Three" },
      ],
    );

    expect(result.get("block-1")?.[0]?.code).toBe(
      "DUPLICATE_RETURNED_BLOCK_ID",
    );
    expect(result.get("block-2")?.[0]?.code).toBe("MISSING_RETURNED_BLOCK_ID");
    expect(result.get("block-3")?.[0]?.code).toBe(
      "UNEXPECTED_RETURNED_BLOCK_ID",
    );
  });
});

describe("validateTranslation materials profile", () => {
  it("allows natural-language changes inside materials parentheses without pattern-specific diagnostics", () => {
    const result = validateTranslation(
      "2.5mm Elektrik Teli (kol, gövde)",
      "2.5mm Electrical Wire (arm, body)",
      "en",
      { contentKind: "materials" },
    );

    expect(result.valid).toBe(true);
    expect(errorCodes(result)).not.toContain("PARENTHESES_MISMATCH");
    expect(errorCodes(result)).not.toContain("LOST_PATTERN_NOTATION");
    expect(result.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MANUAL_REVIEW_RECOMMENDED" }),
      ]),
    );
  });

  it("still rejects changed numeric values in materials", () => {
    const result = validateTranslation(
      "2.5mm Elektrik Teli, 55cm",
      "3mm Electrical Wire, 60cm",
      "en",
      { contentKind: "materials" },
    );

    expect(result.valid).toBe(false);
    expect(errorCodes(result)).toContain("NUMBER_MISMATCH");
  });
});

describe("conditional FLO/BLO integrity", () => {
  const sourceBoth =
    "Bu sırayı FLO’dan örüyoruz (çapraz ya da düz sık iğne ile örenler BLO’dan örecekler).";
  const sourceCrossed =
    "Bu sırayı BLO’dan örüyoruz (çapraz sık iğne ile örenler FLO’dan örecekler).";
  const sourceRegular =
    "Bu sırayı FLO’dan örüyoruz (düz sık iğne tekniği ile örenler BLO’dan örecekler).";

  it("rejects English output that drops the conditional technique", () => {
    const result = validateTranslation(
      sourceBoth,
      "Work in FLO. Work in BLO instead.",
      "en",
    );

    expect(result.valid).toBe(false);
    expect(errorCodes(result)).toContain("PARENTHESES_MISMATCH");
  });

  it("rejects English output with the wrong conditional technique", () => {
    const result = validateTranslation(
      sourceBoth,
      "Work in FLO. If using crossed single crochet, work in BLO instead.",
      "en",
    );

    expect(result.valid).toBe(false);
    expect(errorCodes(result)).toContain("PARENTHESES_MISMATCH");
  });

  it("accepts English output that preserves the full conditional technique", () => {
    const result = validateTranslation(
      sourceBoth,
      "Work in FLO. If using crossed or regular single crochet, work in BLO instead.",
      "en",
    );

    expect(result.valid).toBe(true);
    expect(errorCodes(result)).not.toContain("PARENTHESES_MISMATCH");
  });

  it("accepts crossed-only English conditional output", () => {
    const result = validateTranslation(
      sourceCrossed,
      "Work in BLO. If using crossed single crochet, work in FLO instead.",
      "en",
    );

    expect(result.valid).toBe(true);
    expect(errorCodes(result)).not.toContain("PARENTHESES_MISMATCH");
  });

  it("accepts regular-only English conditional output", () => {
    const result = validateTranslation(
      sourceRegular,
      "Work in FLO. If using regular single crochet, work in BLO instead.",
      "en",
    );

    expect(result.valid).toBe(true);
    expect(errorCodes(result)).not.toContain("PARENTHESES_MISMATCH");
  });

  it.each([
    ["lost", "Work in FLO. (Work in BLO instead.)"],
    [
      "narrowed",
      "Work in FLO. (If using crossed single crochet, work in BLO instead.)",
    ],
    [
      "reversed",
      "Work in BLO. (If using crossed or regular single crochet, work in FLO instead.)",
    ],
  ])("rejects English output with a %s conditional meaning", (_case, target) => {
    const result = validateTranslation(sourceBoth, target, "en");

    expect(result.valid).toBe(false);
    expect(errorCodes(result)).toContain("PARENTHESES_MISMATCH");
  });

  it("accepts English output with valid retained parentheses", () => {
    const result = validateTranslation(
      sourceBoth,
      "Work in FLO. (If using crossed or regular single crochet, work in BLO instead.)",
      "en",
    );

    expect(result.valid).toBe(true);
    expect(errorCodes(result)).not.toContain("PARENTHESES_MISMATCH");
  });

  it("rejects Spanish output that drops the conditional technique", () => {
    const result = validateTranslation(
      sourceBoth,
      "Trabaja en Flo. Trabaja en Blo en su lugar.",
      "es",
    );

    expect(result.valid).toBe(false);
    expect(errorCodes(result)).toContain("PARENTHESES_MISMATCH");
  });

  it("accepts Spanish output that preserves the full conditional technique", () => {
    const result = validateTranslation(
      sourceBoth,
      "Trabaja en Flo. Si usando punto bajo cruzado o punto bajo normal, trabaja en Blo en su lugar.",
      "es",
    );

    expect(result.valid).toBe(true);
    expect(errorCodes(result)).not.toContain("PARENTHESES_MISMATCH");
  });

  it("rejects Spanish output that loses the condition inside retained parentheses", () => {
    const result = validateTranslation(
      sourceBoth,
      "Trabaja en Flo. (Trabaja en Blo en su lugar.)",
      "es",
    );

    expect(result.valid).toBe(false);
    expect(errorCodes(result)).toContain("PARENTHESES_MISMATCH");
  });

  it("accepts Spanish output with valid retained parentheses", () => {
    const result = validateTranslation(
      sourceBoth,
      "Trabaja en Flo. (Si usando punto bajo cruzado o punto bajo normal, trabaja en Blo en su lugar.)",
      "es",
    );

    expect(result.valid).toBe(true);
    expect(errorCodes(result)).not.toContain("PARENTHESES_MISMATCH");
  });
});

describe("round-count trailing-action numeric validation", () => {
  it.each([
    [
      "buttonhole chain",
      "12-20) 9 sıra 54x, 6 zincir (düğme iliği)",
      "12-20) 54sc for 9 rounds, ch 6 (buttonhole)",
    ],
    [
      "chain and cut",
      "21-25) 5 sıra 54x, 1 zincir çekip ipimizi kesiyoruz.",
      "21-25) 54sc for 5 rounds, ch 1 and cut the yarn.",
    ],
  ])("accepts a verified %s round-count reorder", (_label, source, target) => {
    const result = validateTranslation(source, target, "en");

    expect(result.valid).toBe(true);
    expect(errorCodes(result)).not.toContain("NUMBER_MISMATCH");
  });

  it.each([
    [
      "changed stitch count",
      "12-20) 54sc for 9 rounds, ch 6 (buttonhole)",
      "12-20) 53sc for 9 rounds, ch 6 (buttonhole)",
    ],
    [
      "changed round count",
      "12-20) 54sc for 9 rounds, ch 6 (buttonhole)",
      "12-20) 54sc for 8 rounds, ch 6 (buttonhole)",
    ],
    [
      "changed chain count",
      "12-20) 54sc for 9 rounds, ch 6 (buttonhole)",
      "12-20) 54sc for 9 rounds, ch 7 (buttonhole)",
    ],
    [
      "wrong plurality",
      "12-20) 54sc for 9 rounds, ch 6 (buttonhole)",
      "12-20) 54sc for 9 round, ch 6 (buttonhole)",
    ],
  ])("rejects %s in buttonhole round-count instructions", (_label, validTarget, changedTarget) => {
    const source =
      "12-20) 9 sıra 54x, 6 zincir (düğme iliği)";

    expect(validateTranslation(source, validTarget, "en").valid).toBe(true);

    const result = validateTranslation(source, changedTarget, "en");

    expect(result.valid).toBe(false);
    expect(errorCodes(result)).toContain("NUMBER_MISMATCH");
  });
});

describe("inflected chain-and-skip notation validation", () => {
  it("accepts skipped x counts rendered as generic stitches", () => {
    const result = validateTranslation(
      "6 zincir çekip 12x atlıyoruz",
      "ch 6, skip 12 sts",
      "en",
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("still rejects an incorrect skip count", () => {
    const result = validateTranslation(
      "6 zincir çekip 12x atlıyoruz",
      "ch 6, skip 11 sts",
      "en",
    );

    expect(result.valid).toBe(false);
    expect(errorCodes(result)).toContain("NUMBER_MISMATCH");
  });

  it("does not exempt unrelated x notation", () => {
    const result = validateTranslation(
      "12x örüyoruz",
      "Work 12 stitches",
      "en",
    );

    expect(result.valid).toBe(false);
    expect(errorCodes(result)).toContain("LOST_PATTERN_NOTATION");
  });
});
