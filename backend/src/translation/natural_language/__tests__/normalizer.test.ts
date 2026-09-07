import { describe, expect, it } from "vitest";
import { protectNotation } from "../../notation/protector.js";
import { normalizeSourceNaturalLanguage } from "../normalizer.js";

describe("normalizeSourceNaturalLanguage", () => {
  it.each([
    ["en", "4 stitches long"],
    ["es", "4 puntos de largo"],
  ] as const)("normalizes length shorthand for %s", (language, expected) => {
    expect(normalizeSourceNaturalLanguage("4x uzunluğunda", language)).toBe(
      expected,
    );
  });

  it.each([
    ["en", "9 stitches apart"],
    ["es", "separados por 9 puntos"],
  ] as const)("normalizes spacing shorthand for %s", (language, expected) => {
    expect(
      normalizeSourceNaturalLanguage("aralarında 9x kalacak şekilde", language),
    ).toBe(expected);
  });

  it.each([
    ["en", "4 rounds above the eye"],
    ["es", "4 filas por encima del ojo"],
  ] as const)("normalizes above-eye placement for %s", (language, expected) => {
    expect(
      normalizeSourceNaturalLanguage("gözden 4 sıra üzerinden", language),
    ).toBe(expected);
  });

  it.each([
    ["4x sayıyoruz", "en", "count 4 stitches"],
    ["4x sayıyoruz", "es", "contamos 4 puntos"],
    ["4x üzerinden", "en", "over 4 stitches"],
    ["2x üzerinden", "es", "sobre 2 puntos"],
    ["16x’ in üzerinden", "en", "over 16 stitches"],
    ["16x' in üzerinden", "es", "sobre 16 puntos"],
  ] as const)(
    "normalizes contextual stitch-count x without treating x as notation: %s",
    (source, language, expected) => {
      expect(normalizeSourceNaturalLanguage(source, language)).toBe(expected);
    },
  );

  it.each([
    ["en", "two chains"],
    ["es", "dos cadenas"],
  ] as const)(
    "normalizes written Turkish chain count without introducing digits for %s",
    (language, expected) => {
      expect(normalizeSourceNaturalLanguage("iki zincir", language)).toBe(
        expected,
      );
    },
  );

  it.each([
    ["flodan 32x", "FLO’dan 32x"],
    ["blodan 24x", "BLO’dan 24x"],
  ] as const)(
    "canonicalizes apostrophe-less FLO/BLO Turkish suffix forms",
    (source, expected) => {
      expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
    },
  );

  it("does not reinterpret ordinary crochet notation or repetition", () => {
    expect(normalizeSourceNaturalLanguage("6x", "en")).toBe("6x");
    expect(normalizeSourceNaturalLanguage("(1x, v) x 6", "es")).toBe(
      "(1x, v) x 6",
    );
    expect(protectNotation("6x").tokens).toHaveLength(1);
    expect(protectNotation("(1x, v) x 6").tokens).toHaveLength(2);
  });

  it("normalizes the live conditional FLO/BLO instruction", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "Bu sırayı Flo’dan örüyoruz (çapraz ya da düz sık iğne tekniği ile örenler, Blo’dan örecekler), 6x",
        "en",
      ),
    ).toBe(
      "Work in FLO. If using crossed or regular single crochet, work in BLO instead. 6x",
    );
  });

  it("supports the reverse BLO/FLO conditional instruction", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "Bu sırayı BLO’dan örüyoruz (çapraz sık iğne ile örenler FLO’dan örecekler).",
        "en",
      ),
    ).toBe(
      "Work in BLO. If using crossed single crochet, work in FLO instead.",
    );
  });

  it("normalizes a simple FLO instruction without inventing a condition", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "Bu sırayı FLO’dan örüyoruz, 6x",
        "en",
      ),
    ).toBe("Work in FLO, 6x");
  });

  it("accepts apostrophe and spacing variants in conditional loop instructions", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "Bu sırayı FLO' dan örüyoruz (düz sık iğne tekniği ile örenler, BLO' dan örecekler), 6x",
        "en",
      ),
    ).toBe(
      "Work in FLO. If using regular single crochet, work in BLO instead. 6x",
    );
  });

  it("preserves measurements next to a simple loop instruction", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "2.20 mm tığ ile bu sırayı FLO’dan örüyoruz",
        "en",
      ),
    ).toBe("2.20 mm tığ ile Work in FLO");
  });

  it("does not rewrite an unsupported conditional technique unsafely", () => {
    const source =
      "Bu sırayı FLO’dan örüyoruz (farklı bir teknik kullananlar, BLO’dan örecekler)";

    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(
      "Work in FLO (farklı bir teknik kullananlar, BLO’dan örecekler)",
    );
  });


  it("normalizes the live hook and yarn intro into crochet-native English", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "2.20 numara tığ, siyah ip (Catania 110) ile örüyoruz.",
        "en",
      ),
    ).toBe(
      "Using a 2.20 mm crochet hook and siyah Catania 110 yarn, work as follows.",
    );
  });

  it("normalizes a simple hook intro", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "2.5 mm tığ ile örüyoruz.",
        "en",
      ),
    ).toBe("Using a 2.5 mm crochet hook, work as follows.");
  });

  it("normalizes hook-use phrasing without changing decimal precision", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "3.00 mm tığ kullanıyoruz.",
        "en",
      ),
    ).toBe("Use a 3.00 mm crochet hook.");
  });

  it("normalizes Turkish hook-number wording to millimeters", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "2.00 no tığ ile örüyoruz.",
        "en",
      ),
    ).toBe("Using a 2.00 mm crochet hook, work as follows.");
  });

  it("supports the same hook intro structure in Spanish", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "2.20 numara tığ ile örüyoruz.",
        "es",
      ),
    ).toBe(
      "Con un ganchillo de 2.20 mm, tejemos de la siguiente manera.",
    );
  });

  it.each([
    ["12 sıra 66x", "12 rounds, 66x"],
    ["3 sıra 78x", "3 rounds, 78x"],
    ["Sihirli halka içine 6x", "6x into the magic ring"],
    ["2 zincir 2x atla", "ch 2, skip 2 sts"],
    ["zincir içine 2x", "2x into the chain space"],
  ])("normalizes crochet instruction structure: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it("normalizes the representative-photo notice for pattern instructions", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "Fotoğraf temsilidir.",
        "en",
      ),
    ).toBe("The images are for reference only.");
  });

  it("uses insert for amigurumi eye placement verbs", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "Gözleri takacağız. Gözleri yerleştirebiliriz.",
        "en",
      ),
    ).toBe("we will insert the eyes. we can insert the eyes.");
  });

  it("normalizes reusable ear sewing and placement instructions", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "1 zincir çekip kafaya dikmek için ipimizi uzun kesiyoruz. Üst kirpikten 6x sayıyoruz ve burayı işaretliyoruz. Aşağı doğru 5x sayıp burayı da işaretliyoruz. Bu 5x üzerinden kulakları dikiyoruz.",
        "en",
      ),
    ).toBe(
      "ch 1. Cut the yarn, leaving a long tail for sewing the ear to the head. Count 6 stitches from the upper eyelash and mark that point. Count 5 stitches downward and mark that point as well. Sew the ears along these 5 stitches.",
    );
  });

  it.each([
    [
      "Kaş: 5x uzunluğunda, aralarında 10x kalacak şekilde, gözden 3 sıra üzerinden işliyoruz.",
      "Eyebrow: Embroider the eyebrows 5 stitches long, 10 stitches apart, 3 rounds above the eyes.",
    ],
    [
      "Burun: gözün bir sıra altında 4x üzerinden dolama yöntemi ile işliyoruz.",
      "Nose: One round below the eyes, embroider over 4 stitches using the wrap-around method.",
    ],
    [
      "Ağız: Toz pastel ile boyadım. (İsterseniz burnun 4 sıra altından, 2x üzerinden işleyebilirsiniz.)",
      "Mouth: I colored it with soft pastels. (If you prefer, you can embroider the mouth 4 rounds below the nose over 2 stitches.)",
    ],
    [
      "13-38) 26 sıra 14x  örüyoruz, 1 zincir \nçekip ipimizi kesiyoruz.",
      "13-38) 26 rounds, 14 sc. Ch 1 and cut the yarn.",
    ],
  ])("normalizes a complete crochet instruction: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "Kaş — 5x uzunluğunda, aralarında 10x kalacak şekilde, gözden 3 sıra üzerinden işliyoruz.",
      "Eyebrow: Embroider the eyebrows 5 stitches long, 10 stitches apart, 3 rounds above the eyes.",
    ],
    [
      "Burun - gözün bir sıra altından, 4x üzerinden dolama yöntemi ile işliyoruz.",
      "Nose: One round below the eyes, embroider over 4 stitches using the wrap-around method.",
    ],
    [
      "Ağız; Toz pastel ile boyadım. (İsterseniz burnun 4 sıra altından, 2x üzerinden işleyebilirsiniz.)",
      "Mouth: I colored it with soft pastels. (If you prefer, you can embroider the mouth 4 rounds below the nose over 2 stitches.)",
    ],
  ])("normalizes punctuation and case variants: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it.each([
    [
      "5x uzunluğunda, aralarında 10x kalacak şekilde, gözden 3 sıra üzerinden işliyoruz.",
      "Embroider the eyebrows 5 stitches long, 10 stitches apart, 3 rounds above the eyes.",
    ],
    [
      "gözün bir sıra altında 4x üzerinden dolama yöntemi ile işliyoruz.",
      "One round below the eyes, embroider over 4 stitches using the wrap-around method.",
    ],
    [
      "Toz pastel ile boyadım.",
      "I colored it with soft pastels.",
    ],
    [
      "İsterseniz burnun 4 sıra altından, 2x üzerinden işleyebilirsiniz.",
      "If you prefer, you can embroider the mouth 4 rounds below the nose over 2 stitches.",
    ],
  ])("normalizes split face-detail fragments: %s", (source, expected) => {
    expect(normalizeSourceNaturalLanguage(source, "en")).toBe(expected);
  });

  it("leaves the new English-specific constructions unchanged in Spanish", () => {
    const source =
      "Burun: gözün bir sıra altında 4x üzerinden dolama yöntemi ile işliyoruz.";

    expect(normalizeSourceNaturalLanguage(source, "es")).not.toContain(
      "Nose:",
    );
  });

});
