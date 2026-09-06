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
    ["en", "4 rows above the eye"],
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
      "With a 2.20 mm crochet hook and siyah Catania 110 yarn, work as follows.",
    );
  });

  it("normalizes a simple hook intro", () => {
    expect(
      normalizeSourceNaturalLanguage(
        "2.5 mm tığ ile örüyoruz.",
        "en",
      ),
    ).toBe("With a 2.5 mm crochet hook, work as follows.");
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
    ).toBe("With a 2.00 mm crochet hook, work as follows.");
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

});
