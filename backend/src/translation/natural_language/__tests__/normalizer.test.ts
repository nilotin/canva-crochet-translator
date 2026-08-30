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
});
