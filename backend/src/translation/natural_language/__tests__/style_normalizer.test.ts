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
    ["en", "Create sc with 6mr.", "1. Work 6sc into a mr."],
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
    ["es", "aum-mpa, aum-pa, dism-pa, aum-pb-ex"],
    ["en", "esc, esc-inc, escw"],
    ["es", "pb-ex, aum-pb-ex, W-pb-ex"],
  ] as const)("leaves known-good %s notation unchanged", (language, text) => {
    expect(normalizeTranslationStyle("pattern", text, language)).toBe(text);
  });

  it("uses back/front terminology in reverse single crochet explanations", () => {
    const source =
      "Ters sık iğne tekniğinde sık iğnelerin ters yüzü dışarı bakar, düz yüzü içeride kalır.";

    expect(
      normalizeTranslationStyle(
        source,
        "In the reverse single crochet technique, the wrong side of the single crochet stitches faces outward, while the right side of the single crochet stitches remains on the inside.",
        "en",
      ),
    ).toBe(
      "In the reverse single crochet technique, the back of the single crochet stitches faces outward, while the front of the single crochet stitches remains on the inside.",
    );
  });

  it("does not globally replace wrong side and right side outside the crochet context", () => {
    expect(
      normalizeTranslationStyle(
        "Parçanın ters yüzünü kontrol ediyoruz.",
        "Check the wrong side of the piece.",
        "en",
      ),
    ).toBe("Check the wrong side of the piece.");
  });

  it("does not infer reverse single crochet from ordinary fabric-side wording", () => {
    const source =
      "Sık iğnelerin ters yüzü dışarı bakıyor, düz yüzü içeride kalıyor.";

    expect(
      normalizeTranslationStyle(
        source,
        "The wrong side of the single crochet stitches faces outward, while the right side remains on the inside.",
        "en",
      ),
    ).toBe(
      "The wrong side of the single crochet stitches faces outward, while the right side remains on the inside.",
    );
  });

  it("supports the shorter wrong-side/right-side wording in reverse single crochet context", () => {
    const source =
      "Ters sık iğne örerken ters yüz dışarıda, düz yüz içeride kalıyor.";

    expect(
      normalizeTranslationStyle(
        source,
        "The wrong side faces outward and the right side remains on the inside.",
        "en",
      ),
    ).toBe(
      "The back of the stitches faces outward and the front of the stitches remains on the inside.",
    );
  });

  it.each([
    ["12 sıra 66x", "12 round 66sc", "12 rounds, 66 sc"],
    ["3 sıra 78x", "3 round 78sc", "3 rounds, 78 sc"],
    [
      "Sihirli halka içine 6x",
      "Into the magic ring 6sc",
      "6sc into the magic ring",
    ],
  ])(
    "uses source counts to normalize crochet instruction phrasing: %s",
    (source, translated, expected) => {
      expect(normalizeTranslationStyle(source, translated, "en")).toBe(
        expected,
      );
    },
  );

  it("normalizes a combined chain-and-skip round", () => {
    expect(
      normalizeTranslationStyle(
        "24) 15x, 2 zincir 2x atla, 9x, 2 zincir 2x atla, 38x (zincirlerle oluşturduğumuz boşluklara daha sonra gözleri takacağız)",
        "24) 15sc, 2 chain skip 2sc, 9sc, 2 chain skip 2sc, 38sc (the spaces created with the chains, we will attach the eyes later)",
        "en",
      ),
    ).toBe(
      "24) 15sc, ch 2, skip 2 sts, 9sc, ch 2, skip 2 sts, 38sc (we will insert the eyes into these chain spaces later)",
    );
  });

  it("normalizes a combined chain-space round without changing its equation", () => {
    expect(
      normalizeTranslationStyle(
        "25) 15x, zincir içine 2x, 9x, zincir içine 2x, 38x = 66x",
        "25) 15sc, into the chain 2sc, 9sc, into the chain 2sc, 38sc = 66sc",
        "en",
      ),
    ).toBe(
      "25) 15sc, 2sc into the chain space, 9sc, 2sc into the chain space, 38sc = 66sc",
    );
  });

  it.each([
    [
      "(zincirlerle oluşturduğumuz boşluklara daha sonra gözleri takacağız)",
      "(the spaces created with the chains, we will attach the eyes later)",
      "(we will insert the eyes into these chain spaces later)",
    ],
    [
      "Bu sıradan sonra gözleri boşluklara yerleştirebiliriz.",
      "After this row, we can place the eyes in the gaps.",
      "After this round, we can insert the eyes into the gaps.",
    ],
  ])("normalizes amigurumi eye insertion wording", (source, input, expected) => {
    expect(normalizeTranslationStyle(source, input, "en")).toBe(expected);
  });

  it("prefers Using for a crochet-hook instruction intro", () => {
    expect(
      normalizeTranslationStyle(
        "2.00 mm tığ ile örüyoruz.",
        "With a 2.00 mm crochet hook, work as follows.",
        "en",
      ),
    ).toBe("Using a 2.00 mm crochet hook, work as follows.");
  });

  it("normalizes the reusable stitch-marker instruction", () => {
    expect(
      normalizeTranslationStyle(
        "Burası başlangıç noktamız olacak; işaretleyicimizi buraya takıyoruz.",
        "This will be our starting point; we attach the marker here.",
        "en",
      ),
    ).toBe(
      "This will be the beginning of the round; place a stitch marker here.",
    );
  });

  it("normalizes only the marker clause in a mixed magic-ring instruction", () => {
    expect(
      normalizeTranslationStyle(
        "Sihirli halka içine 6x — başlangıç noktamız burası olacak işaretleyiciyi buraya takıyoruz.",
        "Into the magic ring 6sc — This will be our starting point; we attach the marker here.",
        "en",
      ),
    ).toBe(
      "6sc into the magic ring — This will be the beginning of the round; place a stitch marker here.",
    );
  });

  it("keeps approved compact stitch notation unchanged", () => {
    expect(
      normalizeTranslationStyle(
        "6x, 1v, 1e, 66x",
        "6sc, 1inc, 1dec, 66sc",
        "en",
      ),
    ).toBe("6sc, 1inc, 1dec, 66sc");
  });

  it.each([
    ["12-23) 12 sıra 66x", "12-23) 12 rounds, 66 sc"],
    ["28-30) 3 sıra 78x", "28-30) 3 rounds, 78 sc"],
  ])("keeps the approved round-count style unchanged", (source, approved) => {
    expect(normalizeTranslationStyle(source, approved, "en")).toBe(approved);
  });

});
