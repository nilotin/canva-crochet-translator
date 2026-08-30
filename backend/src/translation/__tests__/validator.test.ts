import { describe, expect, it } from "vitest";
import { validateReturnedBlockIds, validateTranslation } from "../validator.js";

const errorCodes = (result: ReturnType<typeof validateTranslation>) =>
  result.errors.map(({ code }) => code);

describe("validateTranslation", () => {
  it("does not treat contextual length and spacing shorthand as sc notation", () => {
    const result = validateTranslation(
      "Kaş — 4x uzunluğunda, aralarında 9x kalacak şekilde, gözden 4 sıra üzerinden işliyoruz.",
      "Eyebrow — 4 stitches long, with 9 stitches between them, worked 4 rows above the eye.",
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
    ["Work 4 rows above the face."],
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
      "Work 4 rows above the eye.",
      "en",
    );

    expect(errorCodes(result)).not.toContain("SEMANTIC_ANCHOR_MISSING");
  });

  it("blocks a lost eyebrow anchor in a complex placement instruction", () => {
    const result = validateTranslation(
      "Kaş gözden 4 sıra üzerinden işleniyor.",
      "Work the eyelash 4 rows above the eye.",
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

  it("rejects a missing repetition count", () => {
    const result = validateTranslation("(1x, v) x 6", "(1sc, inc)", "en");

    expect(result.valid).toBe(false);
    expect(errorCodes(result)).toContain("REPETITION_COUNT_MISMATCH");
  });

  it("preserves all values in an eyebrow instruction", () => {
    const result = validateTranslation(
      "Kaş — 4x uzunluğunda, aralarında 9x kalacak şekilde, gözden 4 sıra üzerinden işliyoruz.",
      "Embroider the eyebrow 4sc long, leaving 9sc between them, 4 rows above the eye.",
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
    ["es", "aum-pa-ex"],
  ] as const)("converts escv for %s", (targetLanguage, translated) => {
    expect(validateTranslation("escv", translated, targetLanguage).valid).toBe(
      true,
    );
  });

  it.each([
    ["en", "escw"],
    ["es", "W-pa-ex"],
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
    ["es", "pa-ex, aum-pa-ex, W-pa-ex"],
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
