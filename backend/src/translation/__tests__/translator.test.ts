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
      [{ id: "mixed-placeholder", text: "6x örüyoruz" }],
      "en",
      { provider },
    );

    expect(result).toMatchObject({ valid: false });
    expect(result?.translated).toContain("__XQZZZZQX__");
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
      "rows above the eye",
    ]);
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
          text: "6x örüyoruz",
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
    expect(provider.protectedTexts).toEqual(["zincir", "atla"]);
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
    ["en", "24) 25sc, ch 1, skip 1 sts, 10sc, ch 1, skip 1 sts, 29sc"],
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
      expect(seen).toEqual(["zincir", "atla", "zincir", "atla"]);
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
      [{ id: "mixed", text: "20x örüyoruz" }],
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
  it.each([
    ["12 sıra 66x", "12 rounds, 66 sc"],
    ["3 sıra 78x", "3 rounds, 78 sc"],
    ["28-30) 3 sıra 78x", "28-30) 3 rounds, 78 sc"],
    ["Sihirli halka içine 6x", "6sc into the magic ring"],
    ["2 zincir 2x atla", "ch 2, skip 2 sts"],
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
      "After this round, we can insert the eyes into the gaps.",
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
