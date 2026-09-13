import { describe, expect, it } from "vitest";
import type {
  ProviderReadiness,
  TranslationProvider,
  TranslationProviderResult,
} from "../providers/provider.js";
import { translateBlocks } from "../translator.js";

class StubProvider implements TranslationProvider {
  readonly name = "stub";
  readonly model = "stub-model";

  constructor(private readonly result: TranslationProviderResult) {}

  async translate(): Promise<TranslationProviderResult> {
    return this.result;
  }

  async checkReadiness(): Promise<ProviderReadiness> {
    return { ok: true, provider: this.name, model: this.model };
  }
}

class InspectingProvider implements TranslationProvider {
  readonly name = "inspecting-stub";
  readonly model = "stub-model";
  protectedTexts: string[] = [];
  requests: Parameters<TranslationProvider["translate"]>[0][] = [];

  async translate(request: Parameters<TranslationProvider["translate"]>[0]) {
    this.requests.push(request);
    this.protectedTexts.push(...request.blocks.map(({ text }) => text));
    return {
      translations: request.blocks.map(({ id, text }) => ({
        id,
        translated: text,
      })),
    };
  }

  async checkReadiness(): Promise<ProviderReadiness> {
    return { ok: true, provider: this.name, model: this.model };
  }
}

class HookBoundaryProvider extends InspectingProvider {
  override async translate(
    request: Parameters<TranslationProvider["translate"]>[0],
  ) {
    this.requests.push(request);
    this.protectedTexts.push(...request.blocks.map(({ text }) => text));
    return {
      translations: request.blocks.map(({ id, text }) => ({
        id,
        translated:
          text === "tığ"
            ? "mm crochet hook"
            : text === "ile örüyoruz."
              ? "work as follows."
              : text === "sıra örüyoruz."
                ? "rounds."
                : text,
      })),
    };
  }
}

describe("translateBlocks provider boundary", () => {
  it("rejects a reserved placeholder introduced by mixed prose output", async () => {
    const provider = new StubProvider({
      translations: [{ id: "span-0", translated: "__XQZZZZQX__" }],
    });

    const [result] = await translateBlocks(
      [{ id: "mixed-placeholder", text: "6x sonra duruyoruz" }],
      "en",
      { provider },
    );

    expect(result).toMatchObject({ valid: false });
    expect(result?.translated).toBe("");
    expect(result?.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "RESERVED_PLACEHOLDER_LEAK" }),
      ]),
    );
  });

  it.each(["__XQZZZZQX__", "crochet __XQZZZZQX__"])(
    "rejects reserved placeholder syntax in natural-language provider output: %s",
    async (translated) => {
      const provider = new StubProvider({
        translations: [{ id: "natural-placeholder", translated }],
      });

      const [result] = await translateBlocks(
        [{ id: "natural-placeholder", text: "Normal Türkçe metin." }],
        "en",
        { provider },
      );

      expect(result).toMatchObject({ valid: false });
      expect(result?.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "RESERVED_PLACEHOLDER_LEAK" }),
        ]),
      );
    },
  );

  it("never exposes a corrupted immutable restoration to final output", async () => {
    const provider = new StubProvider({
      translations: [
        {
          id: "corrupted-immutable",
          translated: "Using a crochet hook, work as follows.",
        },
      ],
    });

    const [result] = await translateBlocks(
      [
        {
          id: "corrupted-immutable",
          text: "2.20 mm tığ ile örüyoruz.",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.valid).toBe(false);
    expect(result?.translated).toBe("");
    expect(result?.translated).not.toMatch(/__XQ[A-Z]{4}QX__/u);
    expect(result?.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "MISSING_PROTECTED_NOTATION",
        }),
      ]),
    );

    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "RESERVED_PLACEHOLDER_LEAK",
    );
    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "NUMBER_MISMATCH",
    );
    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "LOST_PATTERN_NOTATION",
    );
  });

  it("keeps prose-only segments on the full-sentence provider path", async () => {
    const provider = new InspectingProvider();
    await translateBlocks(
      [{ id: "prose", text: "İpi arkada uzun bırakıyoruz." }],
      "en",
      { provider },
    );
    expect(provider.requests).toHaveLength(1);
    expect(provider.protectedTexts).toEqual(["İpi arkada uzun bırakıyoruz."]);
  });

  it("sends only prose spans for independent mixed translation units", async () => {
    const provider = new InspectingProvider();

    await translateBlocks(
      [
        { id: "one", text: "x örüyoruz" },
        { id: "two", text: "v örüyoruz" },
      ],
      "en",
      { provider },
    );

    expect(provider.protectedTexts).toEqual(["örüyoruz", "örüyoruz"]);
    expect(provider.protectedTexts.join(" ")).not.toContain("__XQ");
  });

  it.each([
    "12x - 6v",
    "12x / 6v",
    "12x; 6v",
    "x - v",
    "x: v",
    "x/dc",
  ])(
    "never calls the provider for a mixed segment with no natural-language span: %s",
    async (text) => {
      // Regression: an abbreviations-legend row like "x - dc" contains a
      // notation token (making the segment "mixed", not "pattern_only")
      // but no actual prose to translate. Calling the provider with an
      // empty blocks array previously produced an
      // UNEXPECTED_RETURNED_BLOCK_ID error (observed in production as a
      // hallucinated "__placeholder__" id) instead of translating
      // deterministically.
      const provider = new InspectingProvider();

      const [result] = await translateBlocks([{ id: "row", text }], "en", {
        provider,
      });

      expect(provider.requests).toHaveLength(0);
      expect(
        result?.errors.map(({ code }) => code),
      ).not.toContain("UNEXPECTED_RETURNED_BLOCK_ID");
      expect(result?.errors).toEqual([]);
    },
  );

  it("sends recognized natural-language shorthand as target-language meaning", async () => {
    const provider = new InspectingProvider();

    await translateBlocks(
      [
        {
          id: "one",
          text: "4x uzunluğunda, aralarında 9x kalacak şekilde, gözden 4 sıra üzerinden",
        },
      ],
      "en",
      { provider },
    );

    expect(provider.protectedTexts).toEqual([
      "stitches long",
      "stitches apart",
      "rounds above the eye",
    ]);
  });

  it("keeps round, loop, stitch, and numeric tokens out of provider prose in long mixed instructions", async () => {
    const provider = new InspectingProvider();

    const source =
      "7. sırada Flo’dan ördüğümüz sık iğnelerin Blo’sundan ipimizi sabitliyoruz. 56 zincir çekip geriye dönüyoruz, zincir üzerine ikinci zincirden 55x örüyoruz. Sıradaki sık iğneye cc, yeniden 56 zincir çekip aynı şekilde sıra sonuna kadar devam ediyoruz. Sıra sonuna geldiğimizde 1 zincir çekip ipimizi kesiyoruz.";

    const [result] = await translateBlocks(
      [{ id: "nested-round-mixed", text: source }],
      "en",
      { provider },
    );

    expect(
      provider.protectedTexts.some((text) =>
        /__XQ[A-Z]{4}QX__|\b(?:Flo|FLO|Blo|BLO|cc)\b|\b(?:56|55|7|1)\b/u.test(text),
      ),
    ).toBe(false);

    expect(result?.translated).not.toMatch(/__XQ[A-Z]{4}QX__/u);
    expect(result?.translated).toContain(
      "Attach the yarn to the BLO of the single crochet stitches worked in the FLO of Round 7.",
    );
    expect(result?.translated).toContain(
      "Starting from the second chain, work 55sc along the chain.",
    );
    expect(result?.translated).toContain(
      "SL.ST into the next single crochet",
    );
    expect(result?.translated).toContain(
      "then ch 56 again",
    );
    expect(result?.translated).toContain(
      "At the end of the round, ch 1 and cut the yarn.",
    );
    expect(result?.translated).not.toContain("round 1 chain");
    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "MISSING_PROTECTED_NOTATION",
    );
    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "RESERVED_PLACEHOLDER_LEAK",
    );
    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "ROUND_REFERENCE_MISMATCH",
    );
    expect(result?.valid).toBe(true);
  });

  it("keeps comma-separated skip counts out of single-crochet notation in a mixed sequence", async () => {
    const provider = new InspectingProvider();

    const source =
      "7x, 9 zincir, 10x atla (kol boşluğu oluşturuyoruz), 14x, 9 zincir, 10x atla (kol boşluğu), 7x";

    const [result] = await translateBlocks(
      [{ id: "mixed-chain-skip-sequence", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated.match(/\bsc\b|\d+sc\b/gu)).toHaveLength(3);
    expect(result?.translated.match(/skip 10 sts/gu)).toHaveLength(2);
    expect(result?.translated).not.toContain("skip 10sc");

    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "LOST_PATTERN_NOTATION",
    );
    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "NUMBER_MISMATCH",
    );
    expect(result?.valid).toBe(true);
  });

  it("keeps FLO/BLO source variants out of provider prose spans", async () => {
    const provider = new InspectingProvider();

    const results = await translateBlocks(
      [
        { id: "mixed-blo-title", text: "Blo’dan 32x" },
        { id: "mixed-flo-plain", text: "flodan 24x" },
        { id: "mixed-blo-suffix", text: "blo’sundan 16x" },
      ],
      "en",
      { provider },
    );

    expect(
      provider.protectedTexts.some((text) => /\b(?:FLO|BLO|Flo|Blo|flo|blo)\b/u.test(text)),
    ).toBe(false);

    for (const result of results) {
      expect(result.errors.map(({ code }) => code)).not.toContain(
        "INTERNAL_MIXED_LEXER_ERROR",
      );
    }
  });

  it("handles the live flodan, blo suffix, and lowercase cc combination safely", async () => {
    const provider = new InspectingProvider();

    const [result] = await translateBlocks(
      [
        {
          id: "live-hair-regression",
          text:
            "12) 11. sırada flodan ördüğümüz sık iğnelerin blo’sundan ipimizi sabitliyoruz ve devam ediyoruz. 66 zincir çekip geriye dönüyoruz, zincir üzerine ikinci zincirden itibaren 25x, 40cc, 1x atla sıradaki ilmeğe cc, cc… bu şekilde sıra sonuna kadar devam ediyoruz. Sıra sonuna geldiğimizde,\n1 zincir çekip ipimizi kesiyoruz.",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "INTERNAL_MIXED_LEXER_ERROR",
    );

    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "LOST_PATTERN_NOTATION",
    );

    expect(result?.translated).not.toMatch(/\b(?:FLO|BLO)(?=\p{L})/u);

    expect(
      provider.protectedTexts.some((text) =>
        /\b(?:FLO|BLO|Flo|Blo|flo|blo|cc)\b/u.test(text),
      ),
    ).toBe(false);
  });

  it("normalizes the live conditional FLO/BLO instruction through the full translation pipeline", async () => {
    const provider = new InspectingProvider();

    const [result] = await translateBlocks(
      [
        {
          id: "conditional-loop-regression",
          text:
            "41) Bu sırayı Flo’dan örüyoruz (çapraz ya da düz sık iğne tekniği ile örenler, Blo’dan örecekler), 6x",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.errors).toEqual([]);
    expect(result?.translated).toBe(
      "41) Work in FLO. If using crossed or regular single crochet, work in BLO instead. 6sc",
    );

    expect(result?.translated).not.toMatch(/FLO\s+work\s+from/iu);
    expect(result?.translated).not.toMatch(/BLO\s+will\s+work\s+from/iu);
  });

  it("uses short provider-local IDs for mixed spans", async () => {
    const provider = new InspectingProvider();
    const longInternalId =
      "page-PBd6snl89KvV7WPJ-block-1-segment-1";

    const [result] = await translateBlocks(
      [
        {
          id: longInternalId,
          text: "6x sonra duruyoruz",
        },
      ],
      "en",
      { provider },
    );

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.blocks.map(({ id }) => id)).toEqual([
      "span-0",
    ]);
    expect(provider.requests[0]?.userPrompt).not.toContain(longInternalId);

    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "MISSING_RETURNED_BLOCK_ID",
    );
    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "UNEXPECTED_RETURNED_BLOCK_ID",
    );
  });

  it("normalizes reverse single crochet side terminology through the full translation pipeline", async () => {
    const source =
      "Ters sık iğne tekniğinde, sık iğnelerin ters yüzü dışarı bakacak şekilde içeriden örüyoruz ve düz yüzü içeride kalıyor.";

    const provider: TranslationProvider = {
      name: "reverse-sc-stub",
      model: "stub-model",

      async translate(request) {
        return {
          translations: request.blocks.map(({ id }) => ({
            id,
            translated:
              "In the reverse single crochet technique, the wrong side of the single crochet stitches faces outward as you work from the inside, while the right side of the single crochet stitches remains on the inside.",
          })),
        };
      },

      async checkReadiness() {
        return {
          ok: true,
          provider: "reverse-sc-stub",
          model: "stub-model",
        };
      },
    };

    const [result] = await translateBlocks(
      [{ id: "reverse-sc-terminology-regression", text: source }],
      "en",
      { provider },
    );

    expect(result?.errors).toEqual([]);
    expect(result?.translated).toBe(
      "In the reverse single crochet technique, the back of the single crochet stitches faces outward as you work from the inside, while the front of the single crochet stitches remains on the inside.",
    );

    expect(result?.translated).not.toMatch(/\bwrong side\b/iu);
    expect(result?.translated).not.toMatch(/\bright side\b/iu);
  });

  it("normalizes the live hook and yarn intro through the full translation pipeline", async () => {
    const provider: TranslationProvider = {
      name: "hook-intro-stub",
      model: "stub-model",

      async translate(request) {
        return {
          translations: request.blocks.map(({ id, text }) => ({
            id,
            translated: text
              .replace(/\bsiyah\b/giu, "black")
              .replace(/\bsimli\b/giu, "glitter"),
          })),
        };
      },

      async checkReadiness() {
        return {
          ok: true,
          provider: "hook-intro-stub",
          model: "stub-model",
        };
      },
    };

    const [result] = await translateBlocks(
      [
        {
          id: "hook-yarn-intro-regression",
          text:
            "2.20 numara tığ, siyah ip (Catania 110) ile örüyoruz.",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.errors).toEqual([]);
    expect(result?.translated).toBe(
      "Using a 2.20 mm crochet hook and black Catania 110 yarn, work as follows.",
    );
  });

  it("normalizes a hook intro with the yarn brand after ile through the full pipeline", async () => {
    const provider = new InspectingProvider();

    const [result] = await translateBlocks(
      [
        {
          id: "alternate-hook-yarn-intro",
          text:
            "2.20 numara tığ, siyah ip ile (catania 110) örüyoruz.",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "Using a 2.20 mm crochet hook and siyah yarn (catania 110), work as follows.",
    );

    const codes = result?.errors.map(({ code }) => code) ?? [];
    expect(codes).not.toContain("MEASUREMENT_INTEGRITY_MISMATCH");
    expect(codes).not.toContain("NUMBER_MISMATCH");
    expect(result?.valid).toBe(true);
  });

  it("does not introduce numeric mismatches for written Turkish chain counts", async () => {
    const provider = new InspectingProvider();

    const [result] = await translateBlocks(
      [
        {
          id: "live-pumpkin-regression",
          text:
            "Bal kabağı; 2.00 numara tığ, simli ip ile örüyoruz.\n" +
            "✦ Sıra sonlarında iki zincir çekip bir üst sıraya geçiyoruz.\n" +
            "✦ Bütün sıraları Blo’dan örüyoruz.\n" +
            "1) 10 zincir çekip geriye dönüyoruz, zincir üzerine üçüncü zincirden itibaren 8hdc\n" +
            "2-16) 15 sıra 8hdc, iki ucu birleştirmek için ipimizi uzun kesiyoruz.",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "NUMBER_MISMATCH",
    );

    expect(
      provider.protectedTexts.some((text) => text.includes("two chains")),
    ).toBe(true);
    expect(
      provider.protectedTexts.some((text) => text.includes("2 chains")),
    ).toBe(false);
  });

  it("keeps contextual x counts out of crochet notation in the full translator path", async () => {
    const provider = new InspectingProvider();

    const [result] = await translateBlocks(
      [
        {
          id: "contextual-x-live",
          text:
            "✦ Kulak - Üst kirpikten 4x sayıyoruz. " +
            "Burun için 4x üzerinden, sonra 2x üzerinden devam ediyoruz. " +
            "Önlük için 16x’ in üzerinden devam ediyoruz.",
        },
      ],
      "en",
      { provider },
    );

    const providerText = provider.protectedTexts.join(" ");

    expect(providerText).toContain("count");
    expect(providerText).toContain("over");
    expect(providerText).toContain("stitches");

    expect(providerText).not.toContain("x sayıyoruz");
    expect(providerText).not.toContain("x üzerinden");
    expect(providerText).toContain("over stitches");
    expect(result?.translated).toContain("over 16 stitches");
    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "LOST_PATTERN_NOTATION",
    );

    expect(result?.translated).not.toContain("4sc");
    expect(result?.translated).not.toContain("2sc");
    expect(result?.translated).not.toContain("4x");
    expect(result?.translated).not.toContain("2x");
  });

  it("reports a missing returned block", async () => {
    const results = await translateBlocks(
      [
        { id: "one", text: "6x örüyoruz" },
        { id: "two", text: "v örüyoruz" },
      ],
      "en",
      {
        provider: new StubProvider({
          translations: [{ id: "one", translated: "6sc" }],
        }),
      },
    );

    expect(results[1]?.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MISSING_RETURNED_BLOCK_ID" }),
      ]),
    );
  });

  it("reports duplicate returned block IDs", async () => {
    const provider: TranslationProvider = {
      name: "duplicate-span",
      model: "stub-model",
      async translate(request) {
        const span = request.blocks[0];
        return {
          translations: span
            ? [
                { id: span.id, translated: "work" },
                { id: span.id, translated: "work" },
              ]
            : [],
        };
      },
      async checkReadiness() {
        return { ok: true, provider: "duplicate-span", model: "stub-model" };
      },
    };
    const results = await translateBlocks(
      [{ id: "one", text: "6x örüyoruz" }],
      "en",
      { provider },
    );

    expect(results[0]?.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DUPLICATE_RETURNED_BLOCK_ID" }),
      ]),
    );
  });

  it("runs deterministic validation after prose-span reconstruction", async () => {
    const provider: TranslationProvider = {
      name: "span-stub",
      model: "stub-model",
      async translate(request) {
        return {
          translations: request.blocks.map(({ id }) => ({
            id,
            translated: "work",
          })),
        };
      },
      async checkReadiness() {
        return { ok: true, provider: "span-stub", model: "stub-model" };
      },
    };
    const results = await translateBlocks(
      [{ id: "one", text: "6x, v örüyoruz" }],
      "en",
      { provider },
    );

    expect(results[0]).toMatchObject({
      translated: "6sc, inc work",
      valid: true,
      errors: [],
    });
  });

  it.each([
    ["en", "26) 20sc, 6inc, 10sc, 6inc, 24sc = 78sc"],
    ["es", "26) 20pb, 6aum, 10pb, 6aum, 24pb = 78pb"],
  ] as const)(
    "bypasses the provider for a pattern-only %s segment",
    async (language, expected) => {
      const provider = new InspectingProvider();
      const [result] = await translateBlocks(
        [{ id: "pattern", text: "26) 20x, 6v, 10x, 6v, 24x = 78x" }],
        language,
        { provider },
      );

      expect(provider.protectedTexts).toHaveLength(0);
      expect(result).toMatchObject({
        translated: expected,
        valid: true,
        errors: [],
      });
    },
  );

  it("batches only mixed natural-language spans in one provider call", async () => {
    const provider = new InspectingProvider();
    await translateBlocks(
      [{ id: "mixed", text: "24) 25x, 1 zincir, 1x atla, 10x" }],
      "en",
      { provider },
    );

    expect(provider.requests).toHaveLength(1);
    expect(provider.protectedTexts).toEqual(["ch", "skip", "sts"]);
    expect(provider.protectedTexts.join(" ")).not.toContain("24)");
    expect(provider.requests[0]?.userPrompt).toContain("proseContext");
  });

  it.each([
    ["2.00 no tığ ile örüyoruz.", "2.00 mm crochet hook."],
    ["2.5 mm tığ ile örüyoruz.", "2.5 mm crochet hook."],
    ["3.00 mm tığ kullanıyoruz.", "3.00 mm crochet hook."],
  ] as const)(
    "keeps one decimal through the applicable protected provider path: %s",
    async (source, expected) => {
      const seen: string[] = [];
      const prompts: string[] = [];
      const decimal = source.match(/\d+(?:[.,]\d+)?/u)?.[0] ?? "";
      const provider: TranslationProvider = {
        name: "decimal-span",
        model: "stub-model",
        async translate(request) {
          seen.push(...request.blocks.map(({ text }) => text));
          prompts.push(request.userPrompt);
          return {
            translations: request.blocks.map(({ id, text }) => ({
              id,
              translated: text.includes("__XQ")
                ? `${text.match(/__XQ[A-Z]{4}QX__/u)?.[0]} crochet hook.`
                : `${decimal} ${
                text.startsWith("no ")
                  ? "crochet without a hook."
                  : "mm crochet hook."
              }`,
            })),
          };
        },
        async checkReadiness() {
          return { ok: true, provider: "decimal-span", model: "stub-model" };
        },
      };
      const [result] = await translateBlocks(
        [{ id: "decimal", text: source }],
        "en",
        { provider },
      );
      expect(seen).toHaveLength(1);
      expect(seen[0]).not.toContain(decimal);
      expect(prompts.join(" ")).not.toContain(decimal);
      expect(result).toMatchObject({ translated: expected, valid: true });
      expect(result?.translated.split(decimal)).toHaveLength(2);
      expect(result?.errors).toEqual([]);
    },
  );

  it.each([
    ["en", "12-23) 12 rounds, 66 sc"],
    ["es", "12-23) 12 vueltas 66pb"],
  ] as const)(
    "reconstructs the Segment 13 numeric range safely in %s",
    async (language, expected) => {
      const provider: TranslationProvider = {
        name: "span-dictionary",
        model: "stub-model",
        async translate(request) {
          return {
            translations: request.blocks.map(({ id }) => ({
              id,
              translated: language === "en" ? "rows" : "vueltas",
            })),
          };
        },
        async checkReadiness() {
          return {
            ok: true,
            provider: "span-dictionary",
            model: "stub-model",
          };
        },
      };
      const [result] = await translateBlocks(
        [{ id: "segment-13", text: "12-23) 12 sıra 66x" }],
        language,
        { provider },
      );
      expect(result).toMatchObject({ translated: expected, valid: true });
      expect(result?.translated).not.toContain("1266");
      expect(result?.errors).toEqual([]);
    },
  );

  it.each([
    ["en", "24) 25sc, ch 1, skip 1 st, 10sc, ch 1, skip 1 st, 29sc"],
    ["es", "24) 25pb, 1 cad, saltar 1pb, 10pb, 1 cad, saltar 1pb, 29pb"],
  ] as const)(
    "reconstructs the Segment 14 mixed pattern by span ID in %s",
    async (language, expected) => {
      const seen: string[] = [];
      const prompts: string[] = [];
      const provider: TranslationProvider = {
        name: "reverse-span-dictionary",
        model: "stub-model",
        async translate(request) {
          seen.push(...request.blocks.map(({ text }) => text));
          prompts.push(request.userPrompt);
          return {
            translations: request.blocks
              .map(({ id, text }) => ({
                id,
                translated:
                  text === "zincir"
                    ? language === "en"
                      ? "ch"
                      : "cad"
                    : language === "en"
                      ? "skip"
                      : "saltar",
              }))
              .reverse(),
          };
        },
        async checkReadiness() {
          return {
            ok: true,
            provider: "reverse-span-dictionary",
            model: "stub-model",
          };
        },
      };
      const [result] = await translateBlocks(
        [
          {
            id: "segment-14",
            text: "24) 25x, 1 zincir, 1x atla, 10x, 1 zincir, 1x atla, 29x",
          },
        ],
        language,
        { provider },
      );
      expect(result).toMatchObject({ translated: expected, valid: true });
      expect(result?.errors).toEqual([]);
      expect(seen).toEqual(
        language === "en"
          ? ["ch", "skip", "sts", "ch", "skip", "sts"]
          : ["zincir", "atla", "zincir", "atla"],
      );
      expect(seen.join(" ")).not.toMatch(/24|25|1x|10x|29x/u);
      expect(prompts.join(" ")).not.toMatch(/24|25|1x|10x|29x/u);
    },
  );

  it("does not let a mixed-span provider remove a numeric literal", async () => {
    const provider: TranslationProvider = {
      name: "numeric-corruptor",
      model: "stub-model",
      async translate(request) {
        return {
          translations: request.blocks.map(({ id }) => ({
            id,
            translated: "work",
          })),
        };
      },
      async checkReadiness() {
        return { ok: true, provider: "numeric-corruptor", model: "stub-model" };
      },
    };

    const [result] = await translateBlocks(
      [{ id: "mixed", text: "20x sonra duruyoruz" }],
      "en",
      { provider },
    );
    expect(result).toMatchObject({ translated: "20sc work", valid: true });
    expect(result?.errors).toEqual([]);
  });

  it("applies style normalization after deterministic notation validation", async () => {
    const provider = new InspectingProvider();
    const results = await translateBlocks(
      [{ id: "one", text: "55 zn çekiyoruz. 2 zn çekiyoruz." }],
      "en",
      { provider },
    );

    expect(results[0]).toMatchObject({
      translated: "Ch 55. Ch 2.",
      valid: true,
      errors: [],
    });
  });

  it("keeps source-aware style normalization behind complete span mapping", async () => {
    const provider: TranslationProvider = {
      name: "missing-span",
      model: "stub-model",
      async translate() {
        return { translations: [] };
      },
      async checkReadiness() {
        return { ok: true, provider: "missing-span", model: "stub-model" };
      },
    };
    const results = await translateBlocks(
      [{ id: "one", text: "1. 6x ile sh oluşturuyoruz." }],
      "es",
      { provider },
    );

    expect(results[0]).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([
        expect.objectContaining({
          code: "MISSING_RETURNED_BLOCK_ID",
          message: expect.stringContaining("Text span 1"),
        }),
      ]),
    });
  });

  it("segments a long notation-heavy Canva block and reconstructs one passing result", async () => {
    const provider = new InspectingProvider();
    const source = Array.from(
      { length: 18 },
      (_, index) => `${index + 1}) (6x, v) x 6. FLO örüyoruz.`,
    ).join("\n");

    const results = await translateBlocks(
      [{ id: "canva-block", text: source }],
      "en",
      {
        provider,
      },
    );

    expect(provider.protectedTexts.length).toBeGreaterThan(1);
    for (const proseSpan of provider.protectedTexts)
      expect(proseSpan).not.toMatch(/__XQ|\d|[()=*,]/u);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "canva-block",
      valid: true,
      errors: [],
    });
    expect((results[0]?.translated.match(/\n/gu) ?? []).length).toBe(17);
  });

  it("avoids every provider call for a long pattern-only fixture", async () => {
    const provider = new InspectingProvider();
    const source = Array.from(
      { length: 18 },
      (_, index) => `${index + 1}) 20x, 6v, 10x, 6v, 24x = 78x`,
    ).join("\n");

    const [result] = await translateBlocks(
      [{ id: "pattern-family", text: source }],
      "en",
      { provider },
    );

    expect(provider.protectedTexts).toHaveLength(0);
    expect(result).toMatchObject({ valid: true, errors: [] });
    expect(result?.translated).toContain(
      "18) 20sc, 6inc, 10sc, 6inc, 24sc = 78sc",
    );
  });

  it("propagates one corrupted segment as a BLOCK for the whole Canva block", async () => {
    let call = 0;
    const provider: TranslationProvider = {
      name: "corrupting-stub",
      model: "stub-model",
      async translate(request) {
        call += 1;
        return {
          translations:
            call === 2
              ? []
              : request.blocks.map(({ id, text }) => ({
                  id,
                  translated: text,
                })),
        };
      },
      async checkReadiness() {
        return { ok: true, provider: "corrupting-stub", model: "stub-model" };
      },
    };
    const source = Array.from(
      { length: 18 },
      (_, index) => `${index + 1}) (6x, v) x 6. FLO örüyoruz.`,
    ).join("\n");

    const [result] = await translateBlocks(
      [{ id: "canva-block", text: source }],
      "en",
      {
        provider,
      },
    );

    expect(result?.valid).toBe(false);
    expect(result?.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "MISSING_RETURNED_BLOCK_ID",
          message: expect.stringContaining("Segment 2"),
        }),
      ]),
    );
  });

  it("preserves slip-stitch notation across Canva formatting-unit boundaries", async () => {
    const provider = new InspectingProvider();
    const source = "1x atla, sıradaki sık iğneye cc";

    const [result] = await translateBlocks(
      [
        {
          id: "formatted-slip-stitch",
          text: source,
          formattingRegions: [
            {
              id: "fmt-0",
              start: 0,
              end: "1x atla, ".length,
            },
            {
              id: "fmt-1",
              start: "1x atla, ".length,
              end: source.length,
            },
          ],
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toContain("1sc");
    expect(result?.translated).toContain("SL.ST");
    expect(result?.translated).not.toMatch(/\bsl\s+st\b/iu);
    expect(result?.valid).toBe(true);
    expect(result?.errors).toEqual([]);
  });

  it("does not retain fragment-level semantic errors after the reconstructed block validates", async () => {
    const provider = new InspectingProvider();
    const source =
      "13) 7. sırada Flo’dan ördüğümüz sık iğnelerin, Blo’sundan ipimizi sabitliyoruz. 56 zincir çekip geriye dönüyoruz, zincir üzerine ikinci zincirden 55x örüyoruz.";

    const split = source.indexOf("56 zincir");

    const [result] = await translateBlocks(
      [
        {
          id: "formatted-nested-round",
          text: source,
          formattingRegions: [
            {
              id: "fmt-0",
              start: 0,
              end: split,
            },
            {
              id: "fmt-1",
              start: split,
              end: source.length,
            },
          ],
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "Attach the yarn to the BLO of the single crochet stitches worked in the FLO of Round 7.",
    );
    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "ROUND_REFERENCE_MISMATCH",
    );
    expect(result?.translated).not.toMatch(/__XQ[A-Z]{4}QX__/u);
  });

  it("returns projected formatting regions for mixed notation and prose", async () => {
    const provider = new StubProvider({
      translations: [
        {
          id: "mixed-format::format:1::segment:0",
          translated: "crochet",
        },
      ],
    });

    const [result] = await translateBlocks(
      [
        {
          id: "mixed-format",
          text: "6x örüyoruz",
          formattingRegions: [
            { id: "fmt-pattern", start: 0, end: 3 },
            { id: "fmt-prose", start: 3, end: 11 },
          ],
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toBe("6sc crochet");
    expect(result?.valid).toBe(true);
    expect(result?.errors).toEqual([]);

    expect(result?.targetFormattingRegions).toEqual([
      { id: "fmt-pattern", start: 0, end: 4 },
      { id: "fmt-prose", start: 4, end: 11 },
    ]);
  });

  it("preserves real Canva-style formatting units across translated headings and prose", async () => {
    const provider: TranslationProvider = {
      name: "formatting-unit-stub",
      model: "stub-model",

      async translate(request) {
        return {
          translations: request.blocks.map(({ id, text }) => ({
            id,
            translated:
              text === "Kulak"
                ? "Ear"
                : text === "Kaş" || text === "✦ Kaş"
                  ? text.startsWith("✦")
                    ? "✦ Eyebrow"
                    : "Eyebrow"
                  : text === "Üst kirpikten count"
                    ? "from the upper eyelash count"
                    : text,
          })),
        };
      },

      async checkReadiness() {
        return {
          ok: true,
          provider: "formatting-unit-stub",
          model: "stub-model",
        };
      },
    };

    const source =
      "✦ Kulak - Üst kirpikten 4x sayıyoruz.\n✦ Kaş - 5x uzunluğunda.";

    const [result] = await translateBlocks(
      [
        {
          id: "real-format",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: 0, end: 2 },
            { id: "fmt-1", start: 2, end: 7 },
            { id: "fmt-2", start: 7, end: 8 },
            { id: "fmt-3", start: 8, end: 38 },
            { id: "fmt-4", start: 38, end: 43 },
            { id: "fmt-5", start: 43, end: source.length },
          ],
        },
      ],
      "en",
      { provider },
    );

    expect(result?.valid).toBe(true);
    expect(result?.errors).toEqual([]);

    expect(result?.translated).toBe(
      "✦ Ear - from the upper eyelash count 4 stitches.\n✦ Eyebrow - 5 stitches long.",
    );

    expect(result?.targetFormattingRegions).toEqual([
      { id: "fmt-0", start: 0, end: 2 },
      { id: "fmt-1", start: 2, end: 5 },
      { id: "fmt-2", start: 5, end: 6 },
      { id: "fmt-3", start: 6, end: 49 },
      { id: "fmt-4", start: 49, end: 58 },
      { id: "fmt-5", start: 58, end: 77 },
    ]);
  });

  it.each([
    ["2.20 tığ ile örüyoruz.", 4],
    ["2.20 mm tığ ile örüyoruz.", 9],
  ] as const)(
    "uses atomic translation when formatting bisects the hook expression in %s",
    async (source, boundary) => {
      const provider = new HookBoundaryProvider();

      const [result] = await translateBlocks(
        [
          {
            id: "bisected-hook",
            text: source,
            formattingRegions: [
              { id: "fmt-0", start: 0, end: boundary },
              { id: "fmt-1", start: boundary, end: source.length },
            ],
          },
        ],
        "en",
        { provider },
      );

      expect(provider.requests).toHaveLength(1);
      expect(provider.protectedTexts).toEqual([
        "Using a __XQAAAAQX__ crochet hook, work as follows.",
      ]);
      expect(result).toMatchObject({
        valid: true,
        translated: "Using a 2.20 mm crochet hook, work as follows.",
        errors: [],
      });
    },
  );

  it("keeps formatting-unit translation for a boundary after the hook expression", async () => {
    const provider = new HookBoundaryProvider();
    const source = "2.20 tığ ile örüyoruz.";
    const boundary = "2.20 tığ".length;

    const [result] = await translateBlocks(
      [
        {
          id: "safe-hook-boundary",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: 0, end: boundary },
            { id: "fmt-1", start: boundary, end: source.length },
          ],
        },
      ],
      "en",
      { provider },
    );

    expect(provider.protectedTexts).toEqual(["tığ", "ile örüyoruz."]);
    expect(result).toMatchObject({
      valid: true,
      translated: "2.20 mm crochet hook work as follows.",
      errors: [],
    });
    expect(result?.targetFormattingRegions).toHaveLength(2);
  });

  it("does not use hook fallback for an arbitrary bare decimal", async () => {
    const provider = new HookBoundaryProvider();
    const source = "2.20 sıra örüyoruz.";

    await translateBlocks(
      [
        {
          id: "non-hook-decimal",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: 0, end: 4 },
            { id: "fmt-1", start: 4, end: source.length },
          ],
        },
      ],
      "en",
      { provider },
    );

    expect(provider.requests.flatMap(({ blocks }) => blocks.map(({ id }) => id)))
      .toContain("non-hook-decimal::format:1::segment:0");
  });

  it("maps formatting regions across a digit/notation-adjacent style boundary that needs real translation", async () => {
    // Regression: a formatting boundary immediately after a number or
    // notation token (e.g. bolding just "12" in "12x artırma") is
    // ordinary Canva styling, not a split natural-language word. It must
    // not fall back to the deterministic-only projection path, which
    // cannot handle a unit that genuinely needs the provider ("artırma").
    const provider = new InspectingProvider();
    const source = "12x artırma";

    const [result] = await translateBlocks(
      [
        {
          id: "digit-boundary",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: 0, end: 2 },
            { id: "fmt-1", start: 2, end: source.length },
          ],
        },
      ],
      "en",
      { provider },
    );

    expect(result?.valid).toBe(true);
    expect(result?.errors).toEqual([]);
    expect(result?.targetFormattingRegions).toEqual([
      { id: "fmt-0", start: 0, end: 2 },
      { id: "fmt-1", start: 2, end: result?.translated.length },
    ]);
  });

  it.each([
    ["55cm", "55 cm"],
    ["2.20mm", "2.20 mm"],
    ["6. sıranın FLO’sundan", "the FLO of Round 6"],
  ] as const)(
    "keeps full-source formatting aligned with rendered immutable output for %s",
    async (source, expectedTranslation) => {
      const provider = new InspectingProvider();

      const [result] = await translateBlocks(
        [
          {
            id: "rendered-formatting",
            text: source,
            formattingRegions: [
              { id: "fmt-0", start: 0, end: source.length },
            ],
          },
        ],
        "en",
        { provider },
      );

      expect(result?.valid).toBe(true);
      expect(result?.errors).toEqual([]);
      expect(result?.translated).toBe(expectedTranslation);
      expect(result?.targetFormattingRegions).toEqual([
        {
          id: "fmt-0",
          start: 0,
          end: expectedTranslation.length,
        },
      ]);
      expect(result?.targetFormattingRegions?.[0]?.end).toBe(
        result?.translated.length,
      );
      expect(provider.protectedTexts).toHaveLength(0);
    },
  );

    it("returns projected formatting regions for deterministic notation translation", async () => {
    const provider = new InspectingProvider();

    const [result] = await translateBlocks(
      [
        {
          id: "formatted-pattern",
          text: "6x, v, 4x",
          formattingRegions: [
            { id: "fmt-0", start: 0, end: 4 },
            { id: "fmt-red", start: 4, end: 5 },
            { id: "fmt-2", start: 5, end: 9 },
          ],
        },
      ],
      "en",
      { provider },
    );

    expect(provider.protectedTexts).toHaveLength(0);

    expect(result?.translated).toBe("6sc, inc, 4sc");
    expect(result?.targetFormattingRegions).toEqual([
      { id: "fmt-0", start: 0, end: 5 },
      { id: "fmt-red", start: 5, end: 8 },
      { id: "fmt-2", start: 8, end: 13 },
    ]);
  });

  it("blocks an oversized unit when no safe structural boundary exists", async () => {
    const provider = new InspectingProvider();
    const source = "x".repeat(600);

    const [result] = await translateBlocks(
      [{ id: "unsplittable", text: source }],
      "en",
      { provider },
    );

    expect(provider.protectedTexts).toHaveLength(0);
    expect(result?.valid).toBe(false);
    expect(result?.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNSAFE_SEGMENTATION_BOUNDARY" }),
      ]),
    );
  });
});

describe("crochet instruction phrasing", () => {

  it("normalizes reference-image embroidery phrasing through the full pipeline", async () => {
    const provider: TranslationProvider = {
      name: "page4-embroidery-stub",
      model: "stub-model",
      async translate(request) {
        return {
          translations: request.blocks.map(({ id }) => ({
            id,
            translated:
              "We can embroider the eyelashes by referring to the image.",
          })),
        };
      },
      async checkReadiness() {
        return {
          ok: true,
          provider: "page4-embroidery-stub",
          model: "stub-model",
        };
      },
    };

    const [result] = await translateBlocks(
      [
        {
          id: "page4-eyelashes",
          text: "Kirpikleri görsele bakarak işleyebiliriz.",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "Embroider the eyelashes following the reference image.",
    );
    expect(result?.valid).toBe(true);
  });

  it("normalizes directional ear placement through the full pipeline", async () => {
    const provider: TranslationProvider = {
      name: "page4-ear-stub",
      model: "stub-model",
      async translate(request) {
        return {
          translations: request.blocks.map(({ id, text }) => ({
            id,
            translated:
              text === "Count"
                ? "Count"
                : text === "stitches from the end of the eyelashes. Work"
                  ? "stitches from the end of the eyelashes. Crochet"
                  : text === "sc"
                    ? "sc"
                    : text ===
                        "sc from top to bottom. Work the other ear in the same way"
                      ? "sc from top to bottom. Crochet the other ear in the same way"
                      : text === "from bottom to top."
                        ? "from bottom to top."
                        : text,
          })),
        };
      },
      async checkReadiness() {
        return {
          ok: true,
          provider: "page4-ear-stub",
          model: "stub-model",
        };
      },
    };

    const [result] = await translateBlocks(
      [
        {
          id: "page4-ear",
          text:
            "Kirpik bitiminden 4x sayıyoruz, 1x, 3dc, 1x yukarıdan aşağı doğru örüyoruz. Diğer kulağı da aynı şekilde aşağıdan yukarı doğru örüyoruz.",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "Count 4 stitches from the end of the eyelashes. Work 1sc, 3dc, 1sc from top to bottom. Work the other ear in the same way, from bottom to top.",
    );
    expect(result?.valid).toBe(true);
  });


  it("normalizes the Page 5 chain-turn foundation instruction through the full pipeline", async () => {
    const provider: TranslationProvider = {
      name: "page5-foundation-stub",
      model: "stub-model",
      async translate(request) {
        return {
          translations: request.blocks.map(({ id, text }) => ({
            id,
            translated: text,
          })),
        };
      },
      async checkReadiness() {
        return {
          ok: true,
          provider: "page5-foundation-stub",
          model: "stub-model",
        };
      },
    };

    const [result] = await translateBlocks(
      [
        {
          id: "page5-foundation",
          text:
            "1) 4 zincir dön, ikinci zincirden itibaren 2x, aynı ilmek içine 3x, (zincirin diğer tarafından devam ediyoruz), 1x, 1v = 8x   Başlangıç noktamız burası olacak. İşaretleyiciyi buraya takıyoruz.",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "1) Ch 4 and turn. Starting from the second chain, 2sc, 3sc in the same stitch (continue along the other side of the chain), 1sc, 1inc = 8sc. This will be the beginning of the round; place a stitch marker here.",
    );
    expect(result?.valid).toBe(true);
  });

  it("normalizes the Page 6 chain-turn foundation through the full pipeline", async () => {
    const provider: TranslationProvider = {
      name: "page6-foundation-stub",
      model: "stub-model",
      async translate(request) {
        return {
          translations: request.blocks.map(({ id, text }) => ({
            id,
            translated: text,
          })),
        };
      },
      async checkReadiness() {
        return {
          ok: true,
          provider: "page6-foundation-stub",
          model: "stub-model",
        };
      },
    };

    const source =
      "1) 8 zincir çekip geriye dönüyoruz. Zincir üzerine ikinci zincirden itibaren 1v, 5x, aynı zincir içine 4x, (zincirin diğer tarafından devam ediyoruz), 5x, 1v = 18x   Başlangıç noktamız burası olacak. İşaretleyiciyi buraya takıyoruz.";

    const [result] = await translateBlocks(
      [{ id: "page6-foundation", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "1) Ch 8 and turn. Starting from the second chain, 1inc, 5sc, 4sc in the same chain (continue along the other side of the chain), 5sc, 1inc = 18sc. This will be the beginning of the round; place a stitch marker here.",
    );
    expect(result?.valid).toBe(true);
  });

  it("normalizes the Page 11 finishing hair-strand instruction through the full pipeline", async () => {
    const provider: TranslationProvider = {
      name: "page11-finishing-hair-stub",
      model: "stub-model",
      async translate(request) {
        return {
          translations: request.blocks.map(({ id, text }) => ({
            id,
            translated: text,
          })),
        };
      },
      async checkReadiness() {
        return {
          ok: true,
          provider: "page11-finishing-hair-stub",
          model: "stub-model",
        };
      },
    };

    const [result] = await translateBlocks(
      [
        {
          id: "page11-finishing-hair",
          text:
            "✦ 46 zincir çekip geriye dönüyoruz, zincir üzerine ikinci zincirden itibaren 45x, 1x atla, sıradaki sık iğneye cc... bu şekilde sıra sonuna kadar devam ediyoruz. Sıra sonuna geldiğimizde 1 zincir çekip dikiş için ipimizi uzun kesiyoruz.",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "✦ Ch 46 and turn. Starting from the second chain, 45sc, skip 1sc, SL.ST into the next stitch. Continue in this way to the end of the round. At the end of the round, ch 1 and cut the yarn, leaving a long tail for sewing.",
    );
    expect(result?.valid).toBe(true);
    expect(result?.errors).toEqual([]);
  });

  it("normalizes the Page 11 total-bangs sentence through the full pipeline", async () => {
    const provider: TranslationProvider = {
      name: "page11-total-bangs-stub",
      model: "stub-model",
      async translate(request) {
        return {
          translations: request.blocks.map(({ id, text }) => ({
            id,
            translated: text,
          })),
        };
      },
      async checkReadiness() {
        return {
          ok: true,
          provider: "page11-total-bangs-stub",
          model: "stub-model",
        };
      },
    };

    const [result] = await translateBlocks(
      [
        {
          id: "page11-total-bangs",
          text: "Toplamda 7 tane kahkülümüz olacak.",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "We will have 7 bangs in total.",
    );
    expect(result?.valid).toBe(true);
    expect(result?.errors).toEqual([]);
  });

  it("normalizes the repeated Page 11 hair-strand instruction through the full pipeline", async () => {
    const provider: TranslationProvider = {
      name: "page11-repeated-hair-stub",
      model: "stub-model",
      async translate(request) {
        return {
          translations: request.blocks.map(({ id, text }) => ({
            id,
            translated: text,
          })),
        };
      },
      async checkReadiness() {
        return {
          ok: true,
          provider: "page11-repeated-hair-stub",
          model: "stub-model",
        };
      },
    };

    const [result] = await translateBlocks(
      [
        {
          id: "page11-repeated-hair",
          text:
            "(21 zincir çekip geriye dönüyoruz, zincir üzerine ikinci zincirden itibaren 20x, 1x atla, sıradaki sık iğneye cc)*7",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "(Ch 21 and turn. Starting from the second chain, 20sc, skip 1sc, SL.ST into the next stitch)*7",
    );
    expect(result?.valid).toBe(true);
    expect(result?.errors).toEqual([]);
  });

  it("normalizes the Page 11 long-hair to bangs instruction through the full pipeline", async () => {
    const provider: TranslationProvider = {
      name: "page11-long-hair-stub",
      model: "stub-model",
      async translate(request) {
        return {
          translations: request.blocks.map(({ id, text }) => ({
            id,
            translated: text,
          })),
        };
      },
      async checkReadiness() {
        return {
          ok: true,
          provider: "page11-long-hair-stub",
          model: "stub-model",
        };
      },
    };

    const [result] = await translateBlocks(
      [
        {
          id: "page11-long-hair",
          text:
            "12) (46 zincir çekip geriye dönüyoruz, zincir üzerine ikinci zincirden itibaren 45x, 1x atla sıradaki sık iğneye cc)*3, 3 tane uzun saç teli ördükten sonra kahkülleri öreceğiz.",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "12) (Ch 46 and turn. Starting from the second chain, 45sc, skip 1sc, SL.ST into the next stitch)*3. After making 3 long hair strands, work the bangs.",
    );

    expect(result?.valid).toBe(true);
    expect(result?.errors).toEqual([]);
  });

  it("normalizes the complete Page 11 wig block through the full pipeline", async () => {
    const provider: TranslationProvider = {
      name: "page11-wig-block-stub",
      model: "stub-model",
      async translate(request) {
        return {
          translations: request.blocks.map(({ id, text }) => ({
            id,
            translated: text,
          })),
        };
      },
      async checkReadiness() {
        return {
          ok: true,
          provider: "page11-wig-block-stub",
          model: "stub-model",
        };
      },
    };

    const [result] = await translateBlocks(
      [
        {
          id: "page11-wig-block",
          text:
            "✦ 2.20 numara tığ, Mor renk (catania 240) ip ile örüyoruz.\n1) Sihirli halka içine 6x , Başlangıç noktamız burası olacak. İşaretleyiciyi buraya takıyoruz.\n2) 6v = 12x\n3) (1x, 1v)*6 = 18x\n4) (2x, 1v)*6 = 24x\n5) (3x, 1v)*6 = 30x\n6) (4x, 1v)*6 = 36x\n7) FLO ‘dan (5x, 1v)*6 = 42x\n8) (6x, 1v)*6 = 48x\n9)  (7x, 1v)*6 = 54x\n10) (8x, 1v)*6 = 60x\n11) 60x örüyoruz ipimizi kesmeden saç telleri ile devam ediyoruz.",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "✦ Using a 2.20 mm crochet hook and purple yarn (catania 240), work as follows.\n1) 6sc into the magic ring. This will be the beginning of the round; place a stitch marker here.\n2) 6inc = 12sc\n3) (1sc, 1inc)*6 = 18sc\n4) (2sc, 1inc)*6 = 24sc\n5) (3sc, 1inc)*6 = 30sc\n6) (4sc, 1inc)*6 = 36sc\n7) In FLO, (5sc, 1inc)*6 = 42sc\n8) (6sc, 1inc)*6 = 48sc\n9)  (7sc, 1inc)*6 = 54sc\n10) (8sc, 1inc)*6 = 60sc\n11) 60sc. Without cutting the yarn, continue with the hair strands.",
    );
    expect(result?.valid).toBe(true);
    expect(result?.errors).toEqual([]);
  });

  it("normalizes the Page 11 branded-color hook intro through the full pipeline", async () => {
    const provider: TranslationProvider = {
      name: "page11-hook-intro-stub",
      model: "stub-model",
      async translate(request) {
        return {
          translations: request.blocks.map(({ id, text }) => ({
            id,
            translated: text,
          })),
        };
      },
      async checkReadiness() {
        return {
          ok: true,
          provider: "page11-hook-intro-stub",
          model: "stub-model",
        };
      },
    };

    const [result] = await translateBlocks(
      [
        {
          id: "page11-hook-intro",
          text:
            "✦ 2.20 numara tığ, Mor renk (catania 240) ip ile örüyoruz.",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "✦ Using a 2.20 mm crochet hook and purple yarn (catania 240), work as follows.",
    );
    expect(result?.valid).toBe(true);
    expect(result?.errors).toEqual([]);
  });

  it("normalizes Page 9 arm-joining terminology through the full pipeline", async () => {
    const provider: TranslationProvider = {
      name: "page9-arm-joining-stub",
      model: "stub-model",
      async translate(request) {
        return {
          translations: request.blocks.map(({ id, text }) => ({
            id,
            translated: text,
          })),
        };
      },
      async checkReadiness() {
        return {
          ok: true,
          provider: "page9-arm-joining-stub",
          model: "stub-model",
        };
      },
    };

    const results = await translateBlocks(
      [
        {
          id: "page9-heading",
          text: "⊱KOL BIRLEŞTIRME⊰",
        },
        {
          id: "page9-continuation",
          text:
            "15-29) 15 sıra 42x, İpimizi kesmeden kol birleştirme ile devam ediyoruz.",
        },
      ],
      "en",
      { provider },
    );

    expect(results[0]?.translated).toBe("⊱ARM JOINING⊰");
    expect(results[0]?.valid).toBe(true);

    expect(results[1]?.translated).toBe(
      "15-29) 15 rounds, 42sc. Without cutting the yarn, continue by joining the arms.",
    );
    expect(results[1]?.valid).toBe(true);
  });

  it("normalizes Page 8 leg and body instructions through the full pipeline", async () => {
    const provider: TranslationProvider = {
      name: "page8-leg-body-stub",
      model: "stub-model",
      async translate(request) {
        return {
          translations: request.blocks.map(({ id, text }) => ({
            id,
            translated: text,
          })),
        };
      },
      async checkReadiness() {
        return {
          ok: true,
          provider: "page8-leg-body-stub",
          model: "stub-model",
        };
      },
    };

    const results = await translateBlocks(
      [
        {
          id: "page8-cut-yarn",
          text:
            "✦ Ekru renk ip ile; (Turuncu ipimizi kesiyoruz.)\n52) 24x, 1 zincir çekip ipimizi kesiyoruz.",
        },
        {
          id: "page8-second-leg",
          text:
            "✦ İkinci bacakta da ilk 51 sırayı aynı şekilde örüyoruz.\n52) 26x\n53) 12x örüyoruz, ipimizi kesmeden gövde ile devam ediyoruz.",
        },
        {
          id: "page8-alignment",
          text:
            "✦ Bende her iki bacağın bitiş noktası bacağın iç kısmının ortasına denk geldi. Sizde denk gelmiyorsa 1-2 sık iğne eksik ya da fazla örerek orta noktaya gelin.",
        },
        {
          id: "page8-join",
          text:
            "✦ İkinci bacaktan 3 zincir ile bacakların arka tarafı bize dönük olacak şekilde ilk bacak ile birleştiriyoruz.",
        },
        {
          id: "page8-body-round",
          text:
            "1) 26x(ilk bacak), 3x (zincir üstü), 26x (ikinci bacak), 3x (zincir üstü) ilmek belirleyiciyi buraya takıyoruz. Başlangıç noktamız burası olacak = 58x",
        },
      ],
      "en",
      { provider },
    );

    expect(results.map((result) => result.translated)).toEqual([
      "✦ With ecru yarn: (Cut the orange yarn.)\n52) 24sc. Ch 1 and cut the yarn.",
      "✦ On the second leg, work the first 51 rounds in the same way.\n52) 26sc\n53) Work 12sc, then continue with the body without cutting the yarn.",
      "✦ For me, the finishing point of both legs aligned with the center of the inner side of each leg. If yours does not align, work 1-2 fewer or additional single crochet stitches to reach the center.",
      "✦ From the second leg, ch 3 and join to the first leg with the backs of the legs facing you.",
      "1) 26sc (first leg), 3sc (along the chain), 26sc (second leg), 3sc (along the chain) = 58sc. This will be the beginning of the round; place a stitch marker here.",
    ]);

    for (const result of results) {
      expect(result.valid).toBe(true);
    }
  });

  it("normalizes Page 7 leg-stuffing guidance through the full pipeline", async () => {
    const provider: TranslationProvider = {
      name: "page7-leg-stuffing-stub",
      model: "stub-model",
      async translate(request) {
        return {
          translations: request.blocks.map(({ id, text }) => ({
            id,
            translated: text,
          })),
        };
      },
      async checkReadiness() {
        return {
          ok: true,
          provider: "page7-leg-stuffing-stub",
          model: "stub-model",
        };
      },
    };

    const [result] = await translateBlocks(
      [
        {
          id: "page7-leg-stuffing",
          text:
            "✦ Bacakları örerken 6-7 sırada bir dolum yapalım. Doldururken görselde görüldüğü gibi örgünün dönmemesine dikkat edelim. (Dolum yaptıkça elimizle örgüyü sürekli düzeltirsek, örgümüz dönmez ve bacaklar çok muntazam olur.)",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "✦ While crocheting the legs, add stuffing every 6-7 rounds. While stuffing, make sure the work does not twist, as shown in the image. (If you keep straightening the work with your hands as you stuff, it will not twist and the legs will look much neater.)",
    );
    expect(result?.valid).toBe(true);
  });

  it("normalizes Page 6 yarn-color phrasing through the full pipeline", async () => {
    const provider: TranslationProvider = {
      name: "page6-yarn-colors-stub",
      model: "stub-model",
      async translate(request) {
        return {
          translations: request.blocks.map(({ id, text }) => ({
            id,
            translated: text,
          })),
        };
      },
      async checkReadiness() {
        return {
          ok: true,
          provider: "page6-yarn-colors-stub",
          model: "stub-model",
        };
      },
    };

    const source =
      "✦ Turuncu ipimize (catania 411) geçiyoruz. Renk geçişlerinde bir önceki ipi kesmeden, içeride beklemeye alıyoruz.\n✦ Ekru renk ip ile;\n✦ Turuncu ip ile;";

    const [result] = await translateBlocks(
      [{ id: "page6-yarn-colors", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "✦ Switch to orange yarn (catania 411). When changing colors, do not cut the previous yarn; leave it inside until needed again.",
    );
    expect(result?.translated).toContain("✦ With ecru yarn:");
    expect(result?.translated).toContain("✦ With orange yarn:");
    expect(result?.errors).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SEMANTIC_ANCHOR_MISSING",
        }),
      ]),
    );
    expect(result?.valid).toBe(true);
  });

  it("normalizes Page 5 arm phrasing through the full pipeline", async () => {
    const provider: TranslationProvider = {
      name: "page5-arm-stub",
      model: "stub-model",
      async translate(request) {
        return {
          translations: request.blocks.map(({ id, text }) => ({
            id,
            translated: text,
          })),
        };
      },
      async checkReadiness() {
        return {
          ok: true,
          provider: "page5-arm-stub",
          model: "stub-model",
        };
      },
    };

    const [result] = await translateBlocks(
      [
        {
          id: "page5-arm",
          text:
            "2) 1v, 2x, 2v, 2x, 1v = 12x\n3-5) 3 sıra 12x\n6) Aynı ilmek içine 3tr, 11x\n7) M(aynı anda üç ilmeği birlikte kesmek), 11x\n8) 1e, 4x, 1e, 4x = 10x\n9) 10x\n10) 1v, 4x, 1v, 4x = 12x\n11-35) 25 sıra 12x bir zincir çekip ipimizi kesiyoruz.",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "6) 3tr in the same stitch, 11sc",
    );
    expect(result?.translated).toContain(
      "7) M (decrease 3 stitches together), 11sc",
    );
    expect(result?.translated).toContain(
      "11-35) 25 rounds, 12sc. Ch 1 and cut the yarn.",
    );
    expect(result?.valid).toBe(true);
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
  ])(
    "preserves every value while normalizing a complete instruction: %s",
    async (source, expected) => {
      const provider = new InspectingProvider();

      const [result] = await translateBlocks(
        [{ id: "complete-crochet-instruction", text: source }],
        "en",
        { provider },
      );

      expect(result).toMatchObject({
        translated: expected,
        valid: true,
        errors: [],
      });
      expect(result?.translated.match(/\d+/gu)).toEqual(source.match(/\d+/gu));
      expect(result?.translated).not.toContain("__XQ");
    },
  );

  it("normalizes buttonhole chain-turn instructions through the full pipeline", async () => {
    const provider = new InspectingProvider();

    const source = "42x - 5 zincir (düğme iliği) dön";

    const [result] = await translateBlocks(
      [{ id: "generic-buttonhole-turn", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "42sc, ch 5 (buttonhole) and turn",
    );

    expect(result?.translated).not.toContain("5 chain");
    expect(result?.translated).not.toContain("buttonhole) turn");

    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "LOST_PATTERN_NOTATION",
    );
    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "NUMBER_MISMATCH",
    );

    expect(result?.valid).toBe(true);
  });

  it("normalizes crocheted-piece inside-out phrasing through the full pipeline", async () => {
    const provider = new InspectingProvider();
    const source =
      "Ördüğümüz tabanın ters yüzünü çeviriyoruz. " +
      "(Sık iğnelerin ters yüzü dışarıda, düz yüzü içeride kalacak)";

    const [result] = await translateBlocks(
      [{ id: "generic-inside-out-crochet", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "Turn the crocheted base inside out. " +
      "(The back of the single crochet stitches should face outward, and the front should face inward)",
    );

    expect(result?.translated).not.toContain(
      "Turn the back of the base",
    );

    const codes = result?.errors.map(({ code }) => code) ?? [];
    expect(codes).not.toContain("PARENTHESES_MISMATCH");
    expect(codes).not.toContain("NUMBER_MISMATCH");
    expect(result?.valid).toBe(true);
  });

  it("normalizes yarn start and round-end joining through the full pipeline", async () => {
    const provider = new InspectingProvider();
    const source =
      "Siyah ip (catania 110) ile başlıyoruz. " +
      "Sıra sonlarında cc ile birleştirip, 1 zincir çekip bir üst sıraya geçiyoruz.";

    const [result] = await translateBlocks(
      [{ id: "generic-yarn-start-round-end", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "Start with black yarn (catania 110).",
    );
    expect(result?.translated).toContain(
      "At the end of each round, join with SL.ST, ch 1, and continue to the next round.",
    );

    expect(result?.translated).not.toContain(
      "Black yarn (catania 110) we begin with",
    );
    expect(result?.translated).not.toContain(
      "SL.ST join with",
    );

    const codes = result?.errors.map(({ code }) => code) ?? [];
    expect(codes).not.toContain("LOST_PATTERN_NOTATION");
    expect(codes).not.toContain("NUMBER_MISMATCH");
    expect(codes).not.toContain("ROUND_REFERENCE_MISMATCH");
    expect(result?.valid).toBe(true);
  });

  it("normalizes leg-relative yarn attachment through the full pipeline", async () => {
    const provider = new InspectingProvider();
    const source =
      "Birinci bacağın bittiği yerin yanındaki ilk sık iğneden ipimizi sabitliyoruz.";

    const [result] = await translateBlocks(
      [{ id: "generic-leg-relative-attachment", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "Attach the yarn to the first single crochet next to where the first leg ends.",
    );

    expect(result?.translated).not.toContain("We secure the yarn");

    const codes = result?.errors.map(({ code }) => code) ?? [];
    expect(codes).not.toContain("LOST_PATTERN_NOTATION");
    expect(codes).not.toContain("NUMBER_MISMATCH");
    expect(result?.valid).toBe(true);
  });

  it("normalizes starting-point joining and next-round continuation through the full pipeline", async () => {
    const provider = new InspectingProvider();
    const source =
      "Görselde görüldüğü gibi başlangıç noktamıza cc ile birleştiriyoruz. " +
      "1 zincir çekip, bir üst sıradan devam ediyoruz.";

    const [result] = await translateBlocks(
      [{ id: "generic-starting-point-join", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "Join to the starting point with SL.ST as shown in the image.",
    );
    expect(result?.translated).toContain(
      "Ch 1 and continue with the next round.",
    );

    expect(result?.translated).not.toContain("SL.ST we join");
    expect(result?.translated).not.toContain("1 we chain");

    const codes = result?.errors.map(({ code }) => code) ?? [];
    expect(codes).not.toContain("LOST_PATTERN_NOTATION");
    expect(codes).not.toContain("NUMBER_MISMATCH");
    expect(codes).not.toContain("ROUND_REFERENCE_MISMATCH");
    expect(result?.valid).toBe(true);
  });

  it("normalizes generic chain-position and finishing instructions through the full pipeline", async () => {
    const provider = new InspectingProvider();
    const source =
      "6 zincir atlayıp (düğme iliği oluşturuyoruz), yedinci zincirden itibaren 49x örüyoruz. " +
      "1 zincir çekip ipimizi dikiş için uzun kesiyoruz. " +
      "1 zincir çekip ördüğümüz parçanın iki ucunu, görselde görüldüğü gibi cc ile birleştiriyoruz. " +
      "1 zincir çekip bir üst sıradan devam ediyoruz.";

    const [result] = await translateBlocks(
      [{ id: "generic-chain-position-finishing", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "Skip 6 chains (to form a buttonhole), then work 49sc starting from the seventh chain",
    );
    expect(result?.translated).not.toContain(
      "Skip 6 chains and (",
    );
    expect(result?.translated).toContain(
      "Ch 1 and cut the yarn, leaving a long tail for sewing",
    );
    expect(result?.translated).toContain(
      "Ch 1 and join the two ends of the piece with SL.ST as shown in the image",
    );
    expect(result?.translated).toContain(
      "Ch 1 and continue with the next round",
    );

    const codes = result?.errors.map(({ code }) => code) ?? [];
    expect(codes).not.toContain("LOST_PATTERN_NOTATION");
    expect(codes).not.toContain("NUMBER_MISMATCH");
    expect(result?.valid).toBe(true);
  });

  it("normalizes chain-and-continue phrasing through the full pipeline", async () => {
    const provider = new InspectingProvider();
    const source =
      "Siyah ipimizi görselde görüldüğü gibi sabitliyoruz. " +
      "2 zincir çekip devam ediyoruz. " +
      "(1dc, 1dcv)*10 = 30dc";

    const [result] = await translateBlocks(
      [{ id: "generic-chain-and-continue", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain("Ch 2 and continue.");
    expect(result?.translated).toContain("(1dc, 1dc-inc)*10 = 30dc");
    expect(result?.translated).not.toContain("2 Chain and continue");

    const codes = result?.errors.map(({ code }) => code) ?? [];
    expect(codes).not.toContain("LOST_PATTERN_NOTATION");
    expect(codes).not.toContain("NUMBER_MISMATCH");
    expect(result?.valid).toBe(true);
  });

  it("normalizes embedded skip and next-stitch prose through the full pipeline", async () => {
    const provider = new InspectingProvider();
    const source =
      "Görselde görüldüğü gibi, ilk parçanın bittiği yerden 1cc atlıyoruz. " +
      "İkinci cc’nin BLO’sundan ipimizi sabitliyoruz.\n" +
      "1 zincir, sıradaki sık iğneye 1x yaparak yakanın bütün çevresini dönüyoruz.";

    const [result] = await translateBlocks(
      [{ id: "generic-embedded-crochet-prose", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "Skip 1SL.ST from ilk parçanın bittiği yer.",
    );
    expect(result?.translated).toContain(
      "Attach the yarn to the BLO of the second SL.ST.",
    );
    expect(result?.translated).toContain(
      "Ch 1 and work 1sc in the next single crochet while yakanın bütün çevresini dönüyoruz.",
    );

    expect(result?.translated).not.toContain("yerden Skip");
    expect(result?.translated).not.toContain("SL.ST we skip");
    expect(result?.translated).not.toContain(
      "in the next single crochet yaparak",
    );

    const codes = result?.errors.map(({ code }) => code) ?? [];
    expect(codes).not.toContain("LOST_PATTERN_NOTATION");
    expect(codes).not.toContain("NUMBER_MISMATCH");
    expect(codes).not.toContain("ROUND_REFERENCE_MISMATCH");
    expect(result?.valid).toBe(true);
  });

  it("preserves the sentence boundary after a numbered stitch-count instruction", async () => {
    const provider = new InspectingProvider();
    const source =
      "1) 45x örüyoruz. Başlangıç noktamıza cc ile birleştiriyoruz.";

    const [result] = await translateBlocks(
      [{ id: "numbered-stitch-work-boundary", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "1) Work 45sc. Join to the starting point with SL.ST.",
    );

    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("normalizes a standalone stitch-count work instruction through the full pipeline", async () => {
    const provider = new InspectingProvider();
    const source = "21x örüyoruz.";

    const [result] = await translateBlocks(
      [{ id: "generic-standalone-stitch-work", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toBe("Work 21sc.");

    const codes = result?.errors.map(({ code }) => code) ?? [];
    expect(codes).not.toContain("LOST_PATTERN_NOTATION");
    expect(codes).not.toContain("NUMBER_MISMATCH");
    expect(codes).not.toContain("ROUND_REFERENCE_MISMATCH");
    expect(result?.valid).toBe(true);
  });

  it("normalizes generic skip, ordinal-loop, and referenced-stitch phrasing through the full pipeline", async () => {
    const provider = new InspectingProvider();
    const source =
      "3cc atlıyoruz.\n" +
      "İkinci cc’nin BLO’sundan ipimizi sabitliyoruz.\n" +
      "2 zincir, sıradaki sık iğneye 1x yaparak devam ediyoruz.\n" +
      "iki parça arasındaki cc üzerine yine cc yapıyoruz.";

    const [result] = await translateBlocks(
      [{ id: "generic-page16-phrasing", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain("Skip 3SL.ST.");
    expect(result?.translated).toContain(
      "Attach the yarn to the BLO of the second SL.ST.",
    );
    expect(result?.translated).toContain(
      "Ch 2 and work 1sc in the next single crochet while devam ediyoruz.",
    );
    expect(result?.translated).toContain(
      "Work another SL.ST into the SL.ST between the two pieces.",
    );

    expect(result?.translated).not.toContain("SL.ST we skip");
    expect(result?.translated).not.toMatch(
      /second SL\.ST.*BLO.*secure/iu,
    );
    expect(result?.translated).not.toContain("2 chain");
    expect(result?.translated).not.toContain(
      "SL.ST on top again SL.ST we make",
    );

    const codes = result?.errors.map(({ code }) => code) ?? [];
    expect(codes).not.toContain("LOST_PATTERN_NOTATION");
    expect(codes).not.toContain("NUMBER_MISMATCH");
    expect(codes).not.toContain("ROUND_REFERENCE_MISMATCH");
    expect(result?.valid).toBe(true);
  });

  it("normalizes generic slip-stitch and next-stitch phrasing through the full pipeline", async () => {
    const provider = new InspectingProvider();
    const source =
      "18. sırada BLO’dan ördüğümüz sık iğnelerin FLO’sundan, yeşil ipimizi sabitliyoruz.\n" +
      "(3 zincir, sıradaki sık iğneye 1x)*12\n" +
      "12cc (ilmek kaydırma) yapıyoruz.\n" +
      "İlmek kaydırmaların BLO’sundan 9x örüyoruz.";

    const [result] = await translateBlocks(
      [{ id: "generic-slip-stitch-phrasing", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "Attach the green yarn to the FLO of the single crochet stitches worked in the BLO of Round 18.",
    );
    expect(result?.translated).toContain(
      "(ch 3, 1sc in the next single crochet)*12",
    );
    expect(result?.translated).toContain(
      "Work 12SL.ST (slip stitches).",
    );
    expect(result?.translated).toContain(
      "Work 9sc in the BLO of the slip stitches.",
    );

    expect(result?.translated).not.toMatch(
      /in Round 18.*BLO.*FLO/iu,
    );
    expect(result?.translated).not.toMatch(
      /\b3 chain\b/iu,
    );
    expect(result?.translated).not.toContain(
      "into the next single crochet 1sc",
    );
    expect(result?.translated).not.toMatch(
      /12SL\.ST.*we work/iu,
    );
    expect(result?.translated).not.toMatch(
      /of the slip stitches BLO from/iu,
    );

    const codes = result?.errors.map(({ code }) => code) ?? [];
    expect(codes).not.toContain("LOST_PATTERN_NOTATION");
    expect(codes).not.toContain("NUMBER_MISMATCH");
    expect(codes).not.toContain("ROUND_REFERENCE_MISMATCH");
    expect(result?.valid).toBe(true);
  });

  it("normalizes generic round-end, chain-cut, and loop-attachment instructions through the full pipeline", async () => {
    const provider = new InspectingProvider();
    const source =
      "12. sıranın sonunda 4 zincir (düğme iliği) dön.\n" +
      "3 zincir, dön\n" +
      "120dc, 2 zincir çekip ipimizi kesiyoruz.\n" +
      "18. sırada BLO’dan ördüğümüz sık iğnelerin FLO’sundan siyah ipimizi sabitliyoruz.";

    const [result] = await translateBlocks(
      [{ id: "generic-finishing-phrasing", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "At the end of Round 12, ch 4 (buttonhole) and turn.",
    );
    expect(result?.translated).toContain("Ch 3 and turn");
    expect(result?.translated).toContain(
      "120dc, ch 2 and cut the yarn",
    );
    expect(result?.translated).toContain(
      "Attach the black yarn to the FLO of the single crochet stitches worked in the BLO of Round 18.",
    );

    expect(result?.translated).not.toMatch(/Round 12 at the end/iu);
    expect(result?.translated).not.toMatch(/\b3 chain,? turn\b/iu);
    expect(result?.translated).not.toMatch(/\bWe chain\b/iu);
    expect(result?.translated).not.toContain(
      "Attach the black yarn to the BLO of the single crochet stitches worked in the FLO of Round 18.",
    );

    const codes = result?.errors.map(({ code }) => code) ?? [];
    expect(codes).not.toContain("LOST_PATTERN_NOTATION");
    expect(codes).not.toContain("NUMBER_MISMATCH");
    expect(result?.valid).toBe(true);
  });

  it("normalizes generic chain-position instructions through the full pipeline", async () => {
    const provider = new InspectingProvider();

    const source =
      "12 zincir çekip geriye dönüyoruz. 4 zincir atlıyoruz. 3. zincirden itibaren 18x. zincir üzerine 5x";

    const [result] = await translateBlocks(
      [{ id: "generic-chain-position", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain("Ch 12 and turn.");
    expect(result?.translated).toContain("skip 4 chains");
    expect(result?.translated).toContain(
      "Starting from the 3rd chain, work 18sc",
    );
    expect(result?.translated).toContain("work 5sc along the chain");

    expect(result?.translated).not.toMatch(/\b\d+from\b/u);
    expect(result?.translated).not.toMatch(/\b\d+\s+skip\s+chains\b/iu);
    expect(result?.translated).not.toMatch(/\bonto the chain\b/iu);

    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "LOST_PATTERN_NOTATION",
    );
    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "NUMBER_MISMATCH",
    );

    expect(result?.valid).toBe(true);
  });

  it.each([
    ["12 sıra 66x", "12 rounds, 66 sc"],
    ["3 sıra 78x", "3 rounds, 78 sc"],
    ["28-30) 3 sıra 78x", "28-30) 3 rounds, 78 sc"],
    ["Sihirli halka içine 6x", "6sc into the magic ring"],
    ["2 zincir 2x atla", "ch 2, skip 2 sts"],
    ["9 zincir, 10x atla", "ch 9, skip 10 sts"],
    ["zincir içine 2x", "2sc into the chain space"],
    [
      "2.00 mm tığ ile örüyoruz.",
      "Using a 2.00 mm crochet hook, work as follows.",
    ],
  ])("normalizes %s through the full pipeline", async (source, expected) => {
    const provider = new InspectingProvider();

    const [result] = await translateBlocks(
      [{ id: "crochet-phrasing", text: source }],
      "en",
      { provider },
    );

    expect(result).toMatchObject({
      translated: expected,
      valid: true,
      errors: [],
    });
    expect(result?.translated).not.toContain("__XQ");
    expect(result?.translated.match(/\d+(?:[.,]\d+)?/gu)).toEqual(
      source.match(/\d+(?:[.,]\d+)?/gu),
    );
  });

  it.each([
    [
      "24) 15x, 2 zincir 2x atla, 9x, 2 zincir 2x atla, 38x (zincirlerle oluşturduğumuz boşluklara daha sonra gözleri takacağız)",
      "24) 15sc, ch 2, skip 2 sts, 9sc, ch 2, skip 2 sts, 38sc (we will insert the eyes into these chain spaces later)",
    ],
    [
      "25) 15x, zincir içine 2x, 9x, zincir içine 2x, 38x = 66x",
      "25) 15sc, 2sc into the chain space, 9sc, 2sc into the chain space, 38sc = 66sc",
    ],
  ])(
    "normalizes a complete Salem-style round without changing its numeric sequence",
    async (source, expected) => {
      const provider = new InspectingProvider();

      const [result] = await translateBlocks(
        [{ id: "salem-round", text: source }],
        "en",
        { provider },
      );

      expect(result).toMatchObject({
        translated: expected,
        valid: true,
        errors: [],
      });
      expect(result?.translated.match(/\d+(?:[.,]\d+)?/gu)).toEqual(
        source.match(/\d+(?:[.,]\d+)?/gu),
      );
      expect(result?.translated).not.toContain("__XQ");
    },
  );

  it.each([
    [
      "(zincirlerle oluşturduğumuz boşluklara daha sonra gözleri takacağız)",
      "(the spaces created with the chains, we will attach the eyes later)",
      "(we will insert the eyes into these chain spaces later)",
    ],
    [
      "Bu sıradan sonra gözleri boşluklara yerleştirebiliriz.",
      "After this row, we can place the eyes in the gaps.",
      "After this round, we can insert the eyes into the chain spaces.",
    ],
  ])(
    "uses insert for eye placement in amigurumi context",
    async (source, providerTranslation, expected) => {
      const provider: TranslationProvider = {
        name: "eye-placement-stub",
        model: "stub-model",
        async translate(request) {
          return {
            translations: request.blocks.map(({ id }) => ({
              id,
              translated: providerTranslation.replace(/^\(|\)$/gu, ""),
            })),
          };
        },
        async checkReadiness() {
          return {
            ok: true,
            provider: "eye-placement-stub",
            model: "stub-model",
          };
        },
      };

      const [result] = await translateBlocks(
        [{ id: "eye-placement", text: source }],
        "en",
        { provider },
      );

      expect(result?.translated).toBe(expected);
      expect(result?.valid).toBe(true);
    },
  );

  it("normalizes the reusable stitch-marker sentence", async () => {
    const provider = new StubProvider({
      translations: [
        {
          id: "stitch-marker",
          translated:
            "This will be our starting point; we attach the marker here.",
        },
      ],
    });

    const [result] = await translateBlocks(
      [
        {
          id: "stitch-marker",
          text:
            "Burası başlangıç noktamız olacak; işaretleyicimizi buraya takıyoruz.",
        },
      ],
      "en",
      { provider },
    );

    expect(result).toMatchObject({
      translated:
        "This will be the beginning of the round; place a stitch marker here.",
      valid: true,
      errors: [],
    });
  });

  it("preserves the magic-ring instruction before a marker clause", async () => {
    const provider = new InspectingProvider();
    const source =
      "Sihirli halka içine 6x — başlangıç noktamız burası olacak işaretleyiciyi buraya takıyoruz.";

    const [result] = await translateBlocks(
      [{ id: "mixed-magic-ring-marker", text: source }],
      "en",
      { provider },
    );

    expect(result).toMatchObject({
      translated:
        "6sc into the magic ring — This will be the beginning of the round; place a stitch marker here.",
      valid: true,
      errors: [],
    });
    expect(result?.translated.match(/6/gu)).toHaveLength(1);
    expect(result?.translated.match(/sc/gu)).toHaveLength(1);
    expect(result?.translated).toContain("6sc into the magic ring");
    expect(result?.translated).not.toContain("__XQ");
  });

  it("keeps compact stitch notation through the full pipeline", async () => {
    const provider = new InspectingProvider();

    const [result] = await translateBlocks(
      [{ id: "compact-notation", text: "6x, 1v, 1e, 66x" }],
      "en",
      { provider },
    );

    expect(provider.requests).toHaveLength(0);
    expect(result).toMatchObject({
      translated: "6sc, 1inc, 1dec, 66sc",
      valid: true,
      errors: [],
    });
  });
});

describe("materials translation profile", () => {
  it("gives the provider natural English materials-list and quantity agreement guidance", async () => {
    const provider = new InspectingProvider();

    await translateBlocks(
      [
        {
          id: "materials-list",
          text: "1 adet siyah düğme\n2 adet Catania TR263 ten rengi ip",
        },
      ],
      "en",
      { provider, contentKind: "materials" },
    );

    const systemPrompt = provider.requests[0]?.systemPrompt ?? "";
    expect(systemPrompt).toContain("Materials-list preferences:");
    expect(systemPrompt).toContain("1 button");
    expect(systemPrompt).toContain("2 buttons");
    expect(systemPrompt).toContain("1 skein");
    expect(systemPrompt).toContain("2 skeins");
    expect(systemPrompt).toContain("2 metal buttons for the pants");
    expect(systemPrompt).toContain("Preserve product and brand names");
    expect(systemPrompt).toContain("line structure exactly");
    expect(systemPrompt).toContain(
      "Materials quantity grammar identifies a quantity",
    );

    const userPrompt = JSON.parse(provider.requests[0]?.userPrompt ?? "{}") as {
      blocks?: { text: string }[];
      materialQuantityGrammar?: {
        blockId: string;
        protectedTokenIndex: number;
        agreement: "singular" | "plural";
      }[];
    };
    expect(userPrompt.materialQuantityGrammar).toEqual([
      {
        blockId: "materials-list",
        protectedTokenIndex: 1,
        agreement: "singular",
      },
      {
        blockId: "materials-list",
        protectedTokenIndex: 2,
        agreement: "plural",
      },
    ]);
    expect(userPrompt.blocks?.[0]?.text).not.toMatch(/\b(?:1|2)\b/u);
    const protectedBlockTokens =
      userPrompt.blocks?.[0]?.text.match(/__XQ[A-Z]{4}QX__/gu) ?? [];
    const promptTokens =
      `${provider.requests[0]?.systemPrompt ?? ""}${provider.requests[0]?.userPrompt ?? ""}`.match(
        /__XQ[A-Z]{4}QX__/gu,
      ) ?? [];
    expect(promptTokens).toEqual(protectedBlockTokens);
  });

  it("restores every protected value in a Salem-style materials block without leaking placeholders", async () => {
    class SalemMaterialsProvider extends InspectingProvider {
      override async translate(
        request: Parameters<TranslationProvider["translate"]>[0],
      ) {
        this.requests.push(request);
        this.protectedTexts.push(...request.blocks.map(({ text }) => text));
        const placeholders =
          request.blocks[0]?.text.match(/__XQ[A-Z]{4}QX__/gu) ?? [];
        if (placeholders.length !== 18) {
          throw new Error(`Expected 18 protected tokens, got ${placeholders.length}.`);
        }
        const p = placeholders;
        return {
          translations: [
            {
              id: request.blocks[0]?.id ?? "materials",
              translated: [
                `${p[0]} skeins of Catania ${p[1]} - skin color`,
                `${p[2]} skein of Catania ${p[3]} - black`,
                `${p[4]} skein of Catania ${p[5]} - lilac`,
                `${p[6]} skein of Catania ${p[7]} - white`,
                `${p[8]} skein of Catania ${p[9]} - orange`,
                `${p[10]} skein of Catania ${p[11]} - brown`,
                `${p[12]} skeins of Catania ${p[13]} - green`,
                `${p[14]} eyes`,
                `${p[15]} electrical wire`,
                `${p[16]} large black button`,
                `${p[17]} small black buttons`,
              ].join("\n"),
            },
          ],
        };
      }
    }

    const provider = new SalemMaterialsProvider();
    const source = [
      "2 adet Catania TR263 - ten rengi",
      "1 adet Catania 110 - siyah",
      "1 adet Catania 226 - lila",
      "1 adet Catania 106 - beyaz",
      "1 adet Catania 411 - turuncu",
      "1 adet Catania 240 - kahverengi",
      "2 adet Catania 2456 - yeşil",
      "12mm Göz",
      "2.5mm Elektrik Teli",
      "1 adet büyük siyah düğme",
      "2 adet küçük siyah düğme",
    ].join("\n");

    const [result] = await translateBlocks(
      [{ id: "salem-materials", text: source }],
      "en",
      { provider, contentKind: "materials" },
    );

    expect(result).toMatchObject({ valid: true, errors: [] });
    expect(result?.translated).toContain("2 skeins");
    expect(result?.translated).toContain("1 skein");
    expect(result?.translated).toContain("1 large black button");
    expect(result?.translated).toContain("2 small black buttons");
    for (const model of ["TR263", "110", "226", "106", "411", "240", "2456"]) {
      expect(result?.translated).toContain(model);
    }
    expect(result?.translated).toContain("12 mm safety eyes");
    expect(result?.translated).toContain("2.5 mm electrical wire");
    expect(result?.translated).not.toMatch(/__XQ[^\s]*?QX__/u);
    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "MISSING_PROTECTED_NOTATION",
    );

    const protectedTokenCount =
      provider.protectedTexts[0]?.match(/__XQ[A-Z]{4}QX__/gu)?.length ?? 0;
    const promptTokenCount =
      `${provider.requests[0]?.systemPrompt ?? ""}${provider.requests[0]?.userPrompt ?? ""}`.match(
        /__XQ[A-Z]{4}QX__/gu,
      )?.length ?? 0;
    expect(promptTokenCount).toBe(protectedTokenCount);
  });

  it.each([
    ["12mm Göz", "12 mm safety eyes"],
    ["12 mm Göz", "12 mm safety eyes"],
    ["10mm Göz", "10 mm safety eyes"],
  ])(
    "normalizes a materials safety-eye entry deterministically: %s",
    async (source, expected) => {
      const provider = new InspectingProvider();

      const [result] = await translateBlocks(
        [{ id: "safety-eyes", text: source }],
        "en",
        { provider, contentKind: "materials" },
      );

      expect(provider.protectedTexts).toHaveLength(1);
      expect(provider.protectedTexts[0]).toContain("safety eyes");
      expect(provider.protectedTexts[0]).not.toMatch(/\bgöz\b/iu);
      expect(result).toMatchObject({
        translated: expected,
        valid: true,
        errors: [],
      });
      expect(result?.translated).not.toContain("__XQ");
    },
  );

  it("does not rewrite göz outside the materials profile", async () => {
    const provider = new InspectingProvider();

    const [result] = await translateBlocks(
      [{ id: "pattern-eye", text: "12mm Göz" }],
      "en",
      { provider, contentKind: "pattern" },
    );

    expect(provider.protectedTexts[0]).toMatch(/\bGöz\b/u);
    expect(provider.protectedTexts[0]).not.toContain("safety eyes");
    expect(result?.translated).not.toContain("safety eyes");
  });

  it("leaves an existing metallic-yarn strand entry unchanged", async () => {
    const provider = new InspectingProvider();

    const [result] = await translateBlocks(
      [{ id: "metallic-yarn", text: "Metallic yarn (9 strands)" }],
      "en",
      { provider, contentKind: "materials" },
    );

    expect(result?.translated).toBe("Metallic yarn (9 strands)");
  });

  it("translates materials prose without treating parentheses or crochet-like words as immutable pattern content", async () => {
    const provider = new InspectingProvider();

    const [result] = await translateBlocks(
      [
        {
          id: "materials",
          text: "2.5mm Elektrik Teli (kol, gövde)",
        },
      ],
      "en",
      {
        provider,
        contentKind: "materials",
      },
    );

    expect(provider.requests).toHaveLength(1);

    const sent = provider.protectedTexts[0] ?? "";

    expect(sent).toContain("(");
    expect(sent).toContain("kol, gövde");
    expect(sent).toContain("__XQ");
    expect(sent).not.toContain("2.5");

    expect(result?.errors).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INTERNAL_MIXED_LEXER_ERROR" }),
      ]),
    );
  });
});

describe("materials translation profile with Canva formatting regions", () => {
  it("keeps decorative bullet regions deterministic and translates only material prose regions", async () => {
    const provider = new InspectingProvider();

    const source =
      "✦ 2 adet Catania TR263\n    Ten rengi\n" +
      "✦ 55cm gri renk süet ip\n" +
      "✦ 2.5mm Elektrik Teli (kol, gövde)";

    const firstBullet = 0;
    const firstProse = 1;
    const secondBullet = source.indexOf("✦", firstProse);
    const secondProse = secondBullet + 1;
    const thirdBullet = source.indexOf("✦", secondProse);
    const thirdProse = thirdBullet + 1;

    const [result] = await translateBlocks(
      [
        {
          id: "formatted-materials",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: firstBullet, end: firstProse },
            { id: "fmt-1", start: firstProse, end: secondBullet },
            { id: "fmt-2", start: secondBullet, end: secondProse },
            { id: "fmt-3", start: secondProse, end: thirdBullet },
            { id: "fmt-4", start: thirdBullet, end: thirdProse },
            { id: "fmt-5", start: thirdProse, end: source.length },
          ],
        },
      ],
      "en",
      {
        provider,
        contentKind: "materials",
      },
    );

    expect(provider.protectedTexts).toHaveLength(3);

    for (const sent of provider.protectedTexts) {
      expect(sent).not.toBe("✦");
    }

    expect(provider.protectedTexts.join("\n")).not.toContain("TR263");
    expect(provider.protectedTexts.join("\n")).not.toContain("55");
    expect(provider.protectedTexts.join("\n")).not.toContain("2.5");

    expect(provider.protectedTexts.join("\n")).toContain("(kol, gövde)");

    expect(result?.valid).toBe(true);
    expect(result?.errors).toEqual([]);
    expect(result?.targetFormattingRegions).toHaveLength(6);
  });
});
