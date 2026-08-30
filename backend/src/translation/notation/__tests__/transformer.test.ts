import { describe, expect, it } from "vitest";
import { protectNotation } from "../protector.js";
import { restoreNotation } from "../transformer.js";

const simulateModel = (source: string, targetLanguage: "en" | "es") => {
  const protectedSource = protectNotation(source);
  return restoreNotation(protectedSource.text, protectedSource, targetLanguage);
};

describe("deterministic notation transformation", () => {
  it.each([
    ["en", "6sc, inc, 6sc, SL.ST"],
    ["es", "6pb, aum, 6pb, pd"],
  ] as const)(
    "protects and restores pure notation for %s",
    (language, expected) => {
      const protectedSource = protectNotation("6x, v, 6x, CC");

      expect(protectedSource.text).toBe(
        "6__XQAAAAQX__, __XQAAABQX__, 6__XQAAACQX__, __XQAAADQX__",
      );
      expect(
        restoreNotation(protectedSource.text, protectedSource, language),
      ).toEqual({
        text: expected,
        valid: true,
        errors: [],
      });
    },
  );

  it.each([
    ["en", "40SL.ST, SL.ST"],
    ["es", "40pd, pd"],
  ] as const)(
    "accepts lowercase cc as the project slip-stitch source alias for %s",
    (language, expected) => {
      expect(simulateModel("40cc, cc", language).text).toBe(expected);
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
    "recognizes source notation case-insensitively: %s",
    (source, language, expected) => {
      expect(simulateModel(source, language).text).toBe(expected);
    },
  );

  it.each([
    ["en", "(1sc, inc) x 6"],
    ["es", "(1pb, aum) x 6"],
  ] as const)(
    "distinguishes repetition syntax for %s",
    (language, expected) => {
      const protectedSource = protectNotation("(1x, v) x 6");

      expect(protectedSource.text).toBe("(1__XQAAAAQX__, __XQAAABQX__) x 6");
      expect(
        restoreNotation(protectedSource.text, protectedSource, language).text,
      ).toBe(expected);
    },
  );

  it("does not protect explicit length and spacing x contexts", () => {
    const protectedSource = protectNotation(
      "4x uzunluğunda, 9x kalacak şekilde",
    );

    expect(protectedSource).toEqual({
      text: "4x uzunluğunda, 9x kalacak şekilde",
      tokens: [],
    });
  });

  it.each([
    ["4x üzerinden", "en", "4x üzerinden"],
    ["2x üzerinden", "es", "2x üzerinden"],
    ["16x’ in üzerinden", "en", "16x’ in üzerinden"],
    ["4x sayıyoruz", "en", "4x sayıyoruz"],
  ] as const)(
    "does not protect contextual stitch-count x: %s",
    (source, language, expected) => {
      const protectedSource = protectNotation(source);

      expect(protectedSource.tokens).toHaveLength(0);
      expect(
        restoreNotation(protectedSource.text, protectedSource, language).text,
      ).toBe(expected);
    },
  );

  it.each([
    ["4X üzerinden", "en", "4X üzerinden"],
    ["16X’ in üzerinden", "es", "16X’ in üzerinden"],
  ] as const)(
    "does not protect uppercase contextual stitch-count X: %s",
    (source, language, expected) => {
      const protectedSource = protectNotation(source);

      expect(protectedSource.tokens).toHaveLength(0);
      expect(
        restoreNotation(protectedSource.text, protectedSource, language).text,
      ).toBe(expected);
    },
  );

  it("keeps lowercase m as prose while preserving uppercase M notation", () => {
    const lowercase = protectNotation("m");
    const uppercase = protectNotation("M");

    expect(lowercase.tokens).toHaveLength(0);
    expect(uppercase.tokens).toHaveLength(1);
    expect(restoreNotation(uppercase.text, uppercase, "en").text).toBe("M");
  });

  it("allows grammatical notation reordering in natural-language blocks", () => {
    const protectedSource = protectNotation("6x ile sh oluşturuyoruz.");
    const translated = "Make __XQAAABQX__ using 6__XQAAAAQX__.";

    expect(restoreNotation(translated, protectedSource, "en")).toEqual({
      text: "Make mr using 6sc.",
      valid: true,
      errors: [],
    });
  });

  it("blocks notation reordering in pattern-only blocks", () => {
    const protectedSource = protectNotation("6x, v");
    const restoration = restoreNotation(
      "__XQAAABQX__, 6__XQAAAAQX__",
      protectedSource,
      "en",
    );

    expect(restoration.valid).toBe(false);
    expect(restoration.errors).toEqual([
      expect.objectContaining({ code: "REORDERED_PROTECTED_NOTATION" }),
    ]);
  });

  it.each([
    ["en", "hdc-inc, dc-inc, dc-dec, esc-inc, escw"],
    ["es", "aum-mpa, aum-pa, dism-pa, aum-pa-ex, W-pa-ex"],
  ] as const)(
    "recognizes compound tokens longest-first for %s",
    (language, expected) => {
      expect(simulateModel("hdcv, dcv, dce, escv, escw", language).text).toBe(
        expected,
      );
    },
  );

  it("restores project-defined Spanish FLO/BLO casing", () => {
    expect(simulateModel("FLO, BLO", "es").text).toBe("Flo, Blo");
  });

  it.each([
    ["Flo, flo, Blo, blo", "en", "FLO, FLO, BLO, BLO"],
    ["Flo, flo, Blo, blo", "es", "Flo, Flo, Blo, Blo"],
  ] as const)(
    "accepts explicit FLO/BLO source casing variants for %s",
    (source, language, expected) => {
      expect(simulateModel(source, language).text).toBe(expected);
    },
  );

  it.each([
    ["", "MISSING_PROTECTED_NOTATION"],
    ["__XQAAAAQX____XQAAAAQX__", "DUPLICATE_PROTECTED_NOTATION"],
    ["__XQRENAMEDQX__", "MUTATED_PROTECTED_NOTATION"],
  ] as const)("blocks corrupted placeholder output", (translated, code) => {
    const restoration = restoreNotation(translated, protectNotation("x"), "en");

    expect(restoration.valid).toBe(false);
    expect(restoration.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code })]),
    );
  });
});
