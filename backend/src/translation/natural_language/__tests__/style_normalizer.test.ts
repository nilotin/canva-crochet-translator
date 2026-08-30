import { describe, expect, it } from "vitest";
import { normalizeTranslationStyle } from "../style_normalizer.js";

describe("normalizeTranslationStyle", () => {
  it.each([
    ["Ch 55 ch.", "Ch 55."],
    ["Ch 2 ch", "Ch 2"],
    ["Ch 55 ch. Fasten off. Ch 2 ch.", "Ch 55. Fasten off. Ch 2."],
  ])("removes redundant English chain notation from %s", (input, expected) => {
    expect(normalizeTranslationStyle("zn", input, "en")).toBe(expected);
  });

  it("does not globally remove English ch", () => {
    expect(normalizeTranslationStyle("zn", "Work 2 ch stitches.", "en")).toBe(
      "Work 2 ch stitches.",
    );
  });

  it.each([
    ["FLO work.", "Work in FLO."],
    ["FLO Work.", "Work in FLO."],
    ["BLO work.", "Work in BLO."],
    ["BLO Work.", "Work in BLO."],
    ["FLO crochet.", "Work in FLO."],
    ["BLO crochet.", "Work in BLO."],
    ["FLO We crochet.", "Work in FLO."],
    ["BLO We crochet.", "Work in BLO."],
  ])("normalizes simple English loop instruction %s", (input, expected) => {
    expect(normalizeTranslationStyle("örüyoruz", input, "en")).toBe(expected);
  });

  it.each([
    ["Flo tejemos.", "Tejemos en Flo."],
    ["Blo tejemos.", "Tejemos en Blo."],
  ])("normalizes simple Spanish loop instruction %s", (input, expected) => {
    expect(normalizeTranslationStyle("örüyoruz", input, "es")).toBe(expected);
  });

  it.each([
    ["FLO örüyoruz.", "en", "FLO.", "Work in FLO."],
    ["BLO örüyoruz.", "en", "BLO.", "Work in BLO."],
    ["FLO örüyoruz.", "es", "Flo.", "Tejemos en Flo."],
    ["BLO örüyoruz.", "es", "Blo.", "Tejemos en Blo."],
  ] as const)(
    "uses the exact short loop source for stable %s output",
    (source, language, input, expected) => {
      expect(normalizeTranslationStyle(source, input, language)).toBe(expected);
    },
  );

  it.each([
    ["en", "Create sc with 6mr.", "1. Work 6 sc into a mr."],
    ["es", "Formamos pb con 6am.", "1. Hacemos 6 pb en un am."],
  ] as const)(
    "normalizes the recognized magic-ring source for %s",
    (language, input, expected) => {
      expect(
        normalizeTranslationStyle(
          "1. 6x ile sh oluşturuyoruz.",
          input,
          language,
        ),
      ).toBe(expected);
    },
  );

  it("does not infer a magic-ring rewrite from unrelated source text", () => {
    expect(
      normalizeTranslationStyle(
        "Başka bir talimat.",
        "Create sc with 6mr.",
        "en",
      ),
    ).toBe("Create sc with 6mr.");
  });

  it("does not rewrite longer FLO/BLO instructions", () => {
    expect(
      normalizeTranslationStyle(
        "FLO örüyoruz.",
        "FLO work across the entire round.",
        "en",
      ),
    ).toBe("FLO work across the entire round.");
  });

  it.each([
    ["2.00 no tığ ile örüyoruz.", "2.00 crochet without a hook."],
    ["2.5 mm tığ ile örüyoruz.", "2.5 mm crochet hook."],
    ["3.00 mm tığ kullanıyoruz.", "3.00 mm crochet hook."],
  ])(
    "does not introduce a source numeric literal during style normalization: %s",
    (source, translated) => {
      const normalized = normalizeTranslationStyle(source, translated, "en");
      expect(normalized).toBe(translated);
      expect(normalized.match(/\d+(?:[.,]\d+)?/gu)).toHaveLength(1);
    },
  );

  it.each([
    ["en", "(1sc, inc) x 6"],
    ["es", "(1pb, aum) x 6"],
    ["en", "6sc, inc, 6sc, SL.ST"],
    ["es", "6pb, aum, 6pb, pd"],
    ["en", "hdc-inc, dc-inc, dc-dec, esc-inc"],
    ["es", "aum-mpa, aum-pa, dism-pa, aum-pa-ex"],
    ["en", "esc, esc-inc, escw"],
    ["es", "pa-ex, aum-pa-ex, W-pa-ex"],
  ] as const)("leaves known-good %s notation unchanged", (language, text) => {
    expect(normalizeTranslationStyle("pattern", text, language)).toBe(text);
  });
});
