import { describe, expect, it, vi } from "vitest";
import type {
  ProviderReadiness,
  TranslationProvider,
  TranslationProviderResult,
} from "../providers/provider.js";
import { translateBlocks } from "../translator.js";
import { validateTranslation } from "../validator.js";
import { reservedPlaceholder } from "../notation/immutable.js";
import { extractSourceAtomicNaturalLanguageSpans } from "../natural_language/atomic_spans.js";
import { normalizeTranslationStyle } from "../natural_language/style_normalizer.js";

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

// Mimics a real (imperfect) LLM translation provider: unlike
// InspectingProvider (a pure echo, which can never expose an
// output-splicing bug because it never restructures anything), this
// stub returns a plausible mistranslation for the unnormalized Turkish
// round-first loop-attachment clause -- structurally similar to what a
// live OpenAI call actually produced for this construction (duplicated
// semantic content, no shared sentence/period boundary with the
// source). It exists to catch a regression where that raw clause is
// ever allowed to reach a translation provider again instead of being
// resolved deterministically beforehand. Every other block/span is
// echoed back unchanged, exactly like InspectingProvider.
class DuplicateOpeningProvider extends InspectingProvider {
  override async translate(
    request: Parameters<TranslationProvider["translate"]>[0],
  ) {
    this.requests.push(request);
    this.protectedTexts.push(...request.blocks.map(({ text }) => text));
    return {
      translations: request.blocks.map(({ id, text }) => {
        if (/sabitliyoruz/iu.test(text) && /sıra(?:da|nın)/iu.test(text)) {
          return {
            id,
            translated:
              "As shown in the image in Round 5 FLO single crochets worked from BLO we secure our green yarn through",
          };
        }
        return { id, translated: text };
      }),
    };
  }
}

// Sibling trap for the referenced-loop stitch-count family (Page 24 lines
// 23/26): "N. sırada FLO'dan ördüğümüz sık iğnelerin BLO'sundan Nx örüp
// devam ediyoruz, Mx[ = Tx]". Unlike DuplicateOpeningProvider (yarn
// attachment), this construction works stitches directly, so a realistic
// mistranslation both reverses which loop is which AND duplicates the
// round/loop mention -- structurally close to what a real LLM produces
// when it reinterprets the clause instead of receiving it pre-resolved.
class RestructuredStitchCountProvider extends InspectingProvider {
  override async translate(
    request: Parameters<TranslationProvider["translate"]>[0],
  ) {
    this.requests.push(request);
    this.protectedTexts.push(...request.blocks.map(({ text }) => text));
    return {
      translations: request.blocks.map(({ id, text }) => {
        if (
          /devam\s+ediyoruz/iu.test(text) &&
          /sıra(?:da|nın)/iu.test(text)
        ) {
          return {
            id,
            translated:
              "in Round 22 BLO of the single crochets we worked from FLO from the 24sc we work and continue",
          };
        }
        return { id, translated: text };
      }),
    };
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

// Phase 2 trap for the atomic-span provider-bypass fix: unlike every trap
// above, this one does not gate its corruption on any Turkish trigger text
// -- it corrupts (duplicates) whatever it is asked to translate,
// unconditionally, whether that text is Turkish or already-English prose.
// It exists specifically to catch a regression of the diagnosed bug: an
// already-deterministically-resolved clause (e.g. the nested round/FLO/BLO
// attachment family) being fragmented by `lexMixedSegment` and handed back
// to the provider for a pointless, corruption-prone re-translation. If the
// provider is ever invoked for a segment that should have been fully
// bypassed, this trap guarantees the corruption is visible in the result
// rather than silently surviving an echo.
class UnconditionalCorruptingProvider extends InspectingProvider {
  override async translate(
    request: Parameters<TranslationProvider["translate"]>[0],
  ) {
    this.requests.push(request);
    this.protectedTexts.push(...request.blocks.map(({ text }) => text));
    return {
      translations: request.blocks.map(({ id, text }) => ({
        id,
        translated: `${text} ${text}`,
      })),
    };
  }
}

class EmptyTranslationProvider extends InspectingProvider {
  override async translate(
    request: Parameters<TranslationProvider["translate"]>[0],
  ) {
    this.requests.push(request);
    this.protectedTexts.push(...request.blocks.map(({ text }) => text));

    return {
      translations: request.blocks.map(({ id }) => ({
        id,
        translated: "",
      })),
    };
  }
}

// Second-leg "same rounds" instruction without the optional "da" particle
// ("İkinci bacakta ilk N sırayı..." rather than "İkinci bacakta da ilk N
// sırayı..."). A real (imperfect) LLM call can still emit a
// singular/plural agreement mistake ("47 round" instead of "47 rounds")
// even on the already-normalized English sentence handed to the
// provider. Every other block is echoed back unchanged, like
// InspectingProvider.
class SecondLegSingularRoundProvider extends InspectingProvider {
  override async translate(
    request: Parameters<TranslationProvider["translate"]>[0],
  ) {
    this.requests.push(request);
    this.protectedTexts.push(...request.blocks.map(({ text }) => text));
    return {
      translations: request.blocks.map(({ id, text }) => ({
        id,
        translated: /work the first 47 rounds in the same way/iu.test(text)
          ? text.replace("47 rounds", "47 round")
          : text,
      })),
    };
  }
}

class IsolatedSiraProvider extends InspectingProvider {
  exposedIsolatedSira = false;

  override async translate(
    request: Parameters<TranslationProvider["translate"]>[0],
  ) {
    this.requests.push(request);
    this.protectedTexts.push(...request.blocks.map(({ text }) => text));
    return {
      translations: request.blocks.map(({ id, text }) => {
        if (text.trim().toLocaleLowerCase("tr-TR") === "sıra") {
          this.exposedIsolatedSira = true;
          return { id, translated: "round" };
        }
        return { id, translated: text };
      }),
    };
  }
}

class RealBlock3Provider extends InspectingProvider {
  exposedIsolatedSira = false;
  exposedTurkishYarnCut = false;

  override async translate(
    request: Parameters<TranslationProvider["translate"]>[0],
  ) {
    this.requests.push(request);
    this.protectedTexts.push(...request.blocks.map(({ text }) => text));
    return {
      translations: request.blocks.map(({ id, text }) => {
        if (text.trim().toLocaleLowerCase("tr-TR") === "sıra") {
          this.exposedIsolatedSira = true;
        }
        if (/ipimizi\s+kesiyoruz/iu.test(text)) {
          this.exposedTurkishYarnCut = true;
        }
        if (
          /bu\s+sıradan\s+sonra\s+kol\s+ve\s+gövdeye\s+teli\s+takabilirsiniz[.]/iu.test(
            text,
          )
        ) {
          return {
            id,
            translated:
              `${text.trimStart().startsWith("✦") ? "✦ " : ""}` +
              "After this round, you can attach the wire to the arm and body.",
          };
        }
        return { id, translated: text };
      }),
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
    // Since Task 20B a fully deterministic hook intro never reaches the
    // provider, so this safety check uses an intro whose yarn description
    // ("pamuk") is not a mapped colour and therefore keeps the provider path.
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
          text: "2 numara tığ, pamuk ip (Catania) ile örüyoruz.",
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

  it("bypasses the provider for a fully resolved around-edge slip-stitch finishing instruction", async () => {
    const provider = new InspectingProvider();

    const source =
      "30) Görselde görüldüğü gibi dışa kıvırmak için ördüğümüz " +
      "kısmın çevresini simli ip ile 1 zincir, sıradaki sık iğneye cc, " +
      "yaparak dönüyoruz. Tüm çevreyi ördükten sonra 1 zincir çekip " +
      "ipimizi kesiyoruz.";

    const [result] = await translateBlocks(
      [{ id: "around-edge-slip-stitch-finishing", text: source }],
      "en",
      { provider },
    );

    expect(provider.requests).toHaveLength(0);
    expect(result?.translated).toBe(
      "30) As shown in the image, work around the edge of the section crocheted to fold outward with metallic yarn, making ch 1 and sl st into the next single crochet as you go. After working around the entire edge, ch 1 and cut the yarn.",
    );
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("keeps the around-edge slip-stitch finishing instruction deterministic across Canva formatting boundaries", async () => {
    const provider = new InspectingProvider();

    const source =
      "30) Görselde görüldüğü gibi dışa kıvırmak için ördüğümüz " +
      "kısmın çevresini simli ip ile 1 zincir, sıradaki sık iğneye cc, " +
      "yaparak dönüyoruz. Tüm çevreyi ördükten sonra 1 zincir çekip " +
      "ipimizi kesiyoruz.";

    const markerEnd = source.indexOf("Görselde");
    const innerBoundary = source.indexOf("sıradaki") + 4;

    const [result] = await translateBlocks(
      [
        {
          id: "formatted-around-edge-slip-stitch-finishing",
          text: source,
          formattingRegions: [
            { id: "fmt-marker", start: 0, end: markerEnd },
            { id: "fmt-body-a", start: markerEnd, end: innerBoundary },
            { id: "fmt-body-b", start: innerBoundary, end: source.length },
          ],
        },
      ],
      "en",
      { provider },
    );

    expect(provider.requests).toHaveLength(0);
    expect(result?.translated).toBe(
      "30) As shown in the image, work around the edge of the section crocheted to fold outward with metallic yarn, making ch 1 and sl st into the next single crochet as you go. After working around the entire edge, ch 1 and cut the yarn.",
    );
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
    expect(result?.targetFormattingRegions).toBeDefined();
  });

  it("preserves the marker and body formatting boundary for the around-edge finishing instruction", async () => {
    const provider = new InspectingProvider();

    const source =
      "30) Görselde görüldüğü gibi dışa kıvırmak için ördüğümüz " +
      "kısmın çevresini simli ip ile 1 zincir, sıradaki sık iğneye cc, " +
      "yaparak dönüyoruz. Tüm çevreyi ördükten sonra 1 zincir çekip " +
      "ipimizi kesiyoruz.";

    const bodyStart = source.indexOf("Görselde");

    const [result] = await translateBlocks(
      [
        {
          id: "around-edge-marker-body-formatting",
          text: source,
          formattingRegions: [
            { id: "fmt-marker", start: 0, end: bodyStart },
            { id: "fmt-body", start: bodyStart, end: source.length },
          ],
        },
      ],
      "en",
      { provider },
    );

    const translated = result?.translated ?? "";
    const translatedBodyStart = translated.indexOf("As shown in the image");

    expect(translated).toBe(
      "30) As shown in the image, work around the edge of the section crocheted to fold outward with metallic yarn, making ch 1 and sl st into the next single crochet as you go. After working around the entire edge, ch 1 and cut the yarn.",
    );

    expect(result?.targetFormattingRegions).toEqual([
      {
        id: "fmt-marker",
        start: 0,
        end: translatedBodyStart,
      },
      {
        id: "fmt-body",
        start: translatedBodyStart,
        end: translated.length,
      },
    ]);

    expect(result?.formattingProjection).not.toBe("atomic_collapse");
    expect(provider.requests).toHaveLength(0);
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
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
      "sl st into the next single crochet",
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
      "Using a 2.20 mm crochet hook and black yarn (catania 110), work as follows.",
    );
    expect(provider.requests).toHaveLength(0);

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
    // "6x örüyoruz" is fully deterministic since Task 23C ("Work" is carried),
    // so the fixture keeps one provider span with real prose.
    const results = await translateBlocks(
      [{ id: "one", text: "6x sonra duruyoruz" }],
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
    // Since Task 23H the "ch N, skip M st" words are carried: the original
    // line needs no provider at all...
    const pure = new InspectingProvider();
    const [pureResult] = await translateBlocks(
      [{ id: "mixed", text: "24) 25x, 1 zincir, 1x atla, 10x" }],
      "en",
      { provider: pure },
    );
    expect(pureResult?.translated).toBe("24) 25sc, ch 1, skip 1 st, 10sc");
    expect(pure.requests).toHaveLength(0);

    // ...so prose on both sides keeps several provider spans to batch.
    const provider = new InspectingProvider();
    await translateBlocks(
      [{ id: "mixed", text: "24) Kenarı dikip, 25x, 1 zincir, 1x atla, 10x, sonra ipimizi kesiyoruz." }],
      "en",
      { provider },
    );

    expect(provider.requests).toHaveLength(1);
    expect(provider.protectedTexts).toEqual(["Kenarı dikip", "sonra ipimizi kesiyoruz."]);
    expect(provider.protectedTexts.join(" ")).not.toContain("24)");
    expect(provider.protectedTexts.join(" ")).not.toMatch(/\d|\bch\b|skip|\bst\b/u);
    expect(provider.requests[0]?.userPrompt).toContain("proseContext");
  });

  it.each([
    ["2.00 no tığ ile örüyoruz.", "Using a 2.00 mm crochet hook, work as follows."],
    ["2.5 mm tığ ile örüyoruz.", "Using a 2.5 mm crochet hook, work as follows."],
    ["3.00 mm tığ kullanıyoruz.", "Use a 3.00 mm crochet hook."],
  ] as const)(
    // Task 20B: these intros are fully deterministic and never reach the provider.
    "keeps one decimal in a fully deterministic hook intro without the provider: %s",
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
      expect(seen).toHaveLength(0);
      expect(prompts).toHaveLength(0);
      expect(result).toMatchObject({ translated: expected, valid: true });
      expect(result?.translated.split(decimal)).toHaveLength(2);
      expect(result?.errors).toEqual([]);
    },
  );

  it.each([
    ["en", "12-23) 66sc for 12 rounds"],
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
      // Since Task 23H the English "ch N, skip M st" words are carried, so the
      // English line needs no provider; Spanish still reconstructs by span ID.
      expect(seen).toEqual(
        language === "en"
          ? []
          : ["zincir", "atla", "zincir", "atla"],
      );
      expect(seen.join(" ")).not.toMatch(/24|25|1x|10x|29x/u);
      if (language === "en") return;

      const parsedPrompts = prompts.map((prompt) =>
        JSON.parse(prompt) as {
          proseContext?: string;
          spans?: Array<{ id: string; text: string }>;
        },
      );

      expect(
        parsedPrompts.flatMap(({ spans }) => spans ?? []).map(({ text }) => text).join(" "),
      ).not.toMatch(/24|25|1x|10x|29x/u);

      expect(
        parsedPrompts.map(({ proseContext }) => proseContext ?? "").join(" "),
      ).toMatch(/25|1x|10x|29x/u);
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

  it("keeps a deterministically resolved chain-turn/slip-stitch continuation atomic when real Canva formatting bisects it inside a mixed-prose block", async () => {
    const provider = new InspectingProvider();

    const freeProse =
      "Peruğun ters tarafını çeviriyoruz. ";

    const continuation =
      "20 zincir çekip dönüyoruz, zincir üzerine üçüncü zincirden itibaren 18hdc, " +
      "1x atla sıradaki ilmeğe cc, tekrar sıradaki sık iğneye cc yapıyoruz. " +
      "Bu şekilde sıra sonuna kadar devam ediyoruz. " +
      "Sıra sonuna geldiğimizde 3 zincir çekiyoruz.";

    const source = freeProse + continuation;

    // Intentionally bisect the deterministic continuation just like a Canva
    // style boundary can do in the live design.
    const boundary = source.indexOf("tekrar sıradaki") + 8;

    const [result] = await translateBlocks(
      [
        {
          id: "formatted-page11-continuation-with-prose",
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

    expect(result?.translated).toContain("Ch 20 and turn.");
    expect(result?.translated).toContain(
      "Starting from the third chain, work 18hdc",
    );
    expect(result?.translated).toContain("skip 1sc");
    expect(result?.translated).toContain("sl st into the next stitch");
    expect(result?.translated).toContain(
      "sl st into the following single crochet",
    );
    expect(result?.translated).toContain(
      "Continue in this way to the end of the round.",
    );
    expect(result?.translated).toContain("At the end of the round, ch 3.");

    expect(result?.translated).not.toContain("tekrar");
    expect(result?.translated).not.toContain(
      "into the single crochet in the previous round",
    );

    // Free prose may still require the provider, but the deterministic
    // continuation itself must never be exposed to it.
    expect(provider.requests.length).toBeGreaterThan(0);

    const providerText = provider.protectedTexts.join(" ");
    expect(providerText).not.toMatch(/20\s+zincir/iu);
    expect(providerText).not.toMatch(/tekrar\s+sıradaki/iu);
    expect(providerText).not.toMatch(/sıra\s+sonuna\s+geldiğimizde/iu);

    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("uses atomic translation when formatting bisects a referenced-loop attachment", async () => {
    const provider = new InspectingProvider();
    const source =
      "Görselde görüldüğü gibi yeşil ipimizi, 9. sırada BLO’dan ördüğümüz sık iğnelerin FLO’sundan " +
      "(tabanın ters yüzünü çevirdiğimiz için flo’lar iç kısımda kaldı) sabitliyoruz, 32x.";

    const boundary = source.indexOf("BLO") + 2;

    const [result] = await translateBlocks(
      [
        {
          id: "formatted-referenced-loop-attachment",
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

    expect(result?.translated).toContain(
      "Attach the green yarn to the FLO of the single crochet stitches worked in the BLO of Round 9 as shown in the image",
    );
    expect(result?.translated).toContain(
      "(because the base was turned inside out, the FLO loops remained on the inside), then work 32sc.",
    );

    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("uses atomic translation when formatting bisects referenced surface slip-stitch work", async () => {
    const provider = new InspectingProvider();
    const source =
      "Görselde görüldüğü gibi, 9. sırada BLO’dan ördüğümüz sık iğnelerin üzerine yeşil ipimiz ile ilmek kaydırma yapıyoruz.";

    const boundary = source.indexOf("yeşil") + 2;

    const [result] = await translateBlocks(
      [
        {
          id: "formatted-referenced-surface-work",
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

    expect(result?.translated).toBe(
      "Using green yarn, work slip stitches over the single crochet stitches worked in the BLO of Round 9 as shown in the image.",
    );

    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
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
    expect(result?.translated).toContain("sl st");
    expect(result?.translated).not.toContain("SL.ST");
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

      // Task 20B: the whole intro is deterministic, so the bisected hook
      // expression is rendered atomically without any provider call.
      expect(provider.requests).toHaveLength(0);
      expect(provider.protectedTexts).toEqual([]);
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
      "✦ Ch 46 and turn. Starting from the second chain, 45sc, skip 1sc, sl st into the next stitch. Continue in this way to the end of the round. At the end of the round, ch 1 and cut the yarn, leaving a long tail for sewing.",
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
      "(Ch 21 and turn. Starting from the second chain, 20sc, skip 1sc, sl st into the next stitch)*7",
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
      "12) (Ch 46 and turn. Starting from the second chain, 45sc, skip 1sc, sl st into the next stitch)*3. After making 3 long hair strands, work the bangs.",
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

  it("canonicalizes the hook intro and warns about literal ambiguous notation in the formatted full block", async () => {
    const provider = new InspectingProvider();
    const sourceParts = [
      "✦ ",
      "2.20 numara tığ, Açık gri (Gazzal Giza 2456) ip ile örüyoruz.\n",
      "1) ",
      "Sihirli halka içine 6x , Başlangıç noktamız burası olacak. İşaretleyiciyi buraya takıyoruz.\n",
      "2)",
      " 6v = 12x\n",
      "3) ",
      "(1x, 1v)",
      "*6 ",
      "= 18x\n",
      "4) ",
      "(2x, 1v)",
      "*6 ",
      "= 24x\n",
      "5) ",
      "FLO’dan (3x, 1v)",
      "*6",
      " = 30x\n",
      "6) ",
      "(4x, 1v)",
      "*6 ",
      "= 36x\n",
      "7) ",
      "(5x, 1v)",
      "*6 ",
      "= 42x\n",
      "8) ",
      "FLO’dan (6x, 1v)",
      "*6 ",
      "= 48x\n",
      "9) ",
      "(7x, 1v)",
      "*6 ",
      "= 54x\n",
      "10) ",
      "(8x, 1v)",
      "*6 ",
      "= 60x\n",
      "11) ",
      "FLO’ dan (9x, 1v)",
      "*66x ",
      "\n",
      "12) ",
      "66x örüyoruz ipimizi kesmeden saç telleri ile devam ediyoruz.",
    ];
    const source = sourceParts.join("");
    let cursor = 0;
    const formattingRegions = sourceParts.map((text, index) => {
      const start = cursor;
      cursor += text.length;
      return { id: `fmt-${index}`, start, end: cursor };
    });

    const [result] = await translateBlocks(
      [
        {
          id: "formatted-hook-and-ambiguous-repetition",
          text: source,
          formattingRegions,
        },
      ],
      "en",
      { provider },
    );

    const expectedIntro =
      "✦ Using a 2.20 mm crochet hook and light gray yarn (Gazzal Giza 2456), work as follows.";
    expect(result?.translated.split("\n")[0]).toBe(expectedIntro);
    expect(result?.translated).toContain(
      "11) In FLO, (9sc, 1inc)*66sc \n12) 66sc.",
    );
    expect(result?.translated).not.toContain("(9sc, 1inc)*6 = 66sc");
    expect(result?.errors).toEqual([]);
    expect(result?.warnings.map(({ code }) => code)).toEqual([
      "AMBIGUOUS_REPETITION_NOTATION",
    ]);
    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "MEASUREMENT_INTEGRITY_MISMATCH",
    );
    expect(result?.valid).toBe(true);
    expect(result?.targetFormattingRegions).toHaveLength(sourceParts.length);
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
      expect(result?.valid).toBe(true);
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
      "At the end of each round, join with sl st, ch 1, and continue to the next round.",
    );

    expect(result?.translated).not.toContain(
      "Black yarn (catania 110) we begin with",
    );
    expect(result?.translated).not.toContain(
      "sl st join with",
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
      "Join to the starting point with sl st as shown in the image.",
    );
    expect(result?.translated).toContain(
      "Ch 1 and continue with the next round.",
    );

    expect(result?.translated).not.toContain("sl st we join");
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
      "Ch 1 and join the two ends of the piece with sl st as shown in the image",
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
      "Skip 1sl st from ilk parçanın bittiği yer.",
    );
    expect(result?.translated).toContain(
      "Attach the yarn to the BLO of the second sl st.",
    );
    expect(result?.translated).toContain(
      "Ch 1 and work 1sc in the next single crochet while yakanın bütün çevresini dönüyoruz.",
    );

    expect(result?.translated).not.toContain("yerden Skip");
    expect(result?.translated).not.toContain("sl st we skip");
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
      "1) Work 45sc. Join to the starting point with sl st.",
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

    expect(result?.translated).toContain("Skip 3sl st.");
    expect(result?.translated).toContain(
      "Attach the yarn to the BLO of the second sl st.",
    );
    expect(result?.translated).toContain(
      "Ch 2 and work 1sc in the next single crochet while devam ediyoruz.",
    );
    expect(result?.translated).toContain(
      "Work another sl st into the sl st between the two pieces.",
    );

    expect(result?.translated).not.toContain("sl st we skip");
    expect(result?.translated).not.toMatch(
      /second SL\.ST.*BLO.*secure/iu,
    );
    expect(result?.translated).not.toContain("2 chain");
    expect(result?.translated).not.toContain(
      "sl st on top again sl st we make",
    );

    const codes = result?.errors.map(({ code }) => code) ?? [];
    expect(codes).not.toContain("LOST_PATTERN_NOTATION");
    expect(codes).not.toContain("NUMBER_MISMATCH");
    expect(codes).not.toContain("ROUND_REFERENCE_MISMATCH");
    expect(result?.valid).toBe(true);
  });

  it("normalizes referenced-loop attachment and surface slip stitches through the full pipeline", async () => {
    const provider = new InspectingProvider();
    const source =
      "Görselde görüldüğü gibi yeşil ipimizi, 9. sırada BLO’dan ördüğümüz sık iğnelerin FLO’sundan " +
      "(tabanın ters yüzünü çevirdiğimiz için flo’lar iç kısımda kaldı) sabitliyoruz, 32x. " +
      "Yine bütün sıra sonlarında cc ile birleştirip, 1 zincir çekip bir üst sıraya geçiyoruz.\n" +
      "Görselde görüldüğü gibi, 9. sırada BLO’dan ördüğümüz sık iğnelerin üzerine yeşil ipimiz ile ilmek kaydırma yapıyoruz.";

    const [result] = await translateBlocks(
      [{ id: "generic-referenced-loop-surface-work", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "Attach the green yarn to the FLO of the single crochet stitches worked in the BLO of Round 9 as shown in the image",
    );
    expect(result?.translated).toContain(
      "(because the base was turned inside out, the FLO loops remained on the inside), then work 32sc.",
    );
    expect(result?.translated).toContain(
      "At the end of each round, join with sl st, ch 1, and continue to the next round.",
    );
    expect(result?.translated).toContain(
      "Using green yarn, work slip stitches over the single crochet stitches worked in the BLO of Round 9 as shown in the image.",
    );

    expect(result?.translated).not.toContain("Again, all At the end");
    expect(result?.translated).not.toContain("we secure");
    expect(result?.translated).not.toContain("we made from");

    const codes = result?.errors.map(({ code }) => code) ?? [];
    expect(codes).not.toContain("PARENTHESES_MISMATCH");
    expect(codes).not.toContain("LOST_PATTERN_NOTATION");
    expect(codes).not.toContain("NUMBER_MISMATCH");
    expect(codes).not.toContain("ROUND_REFERENCE_MISMATCH");
    expect(result?.valid).toBe(true);
  });

  // Reproduces the exact live Canva source text for these two blocks
  // (captured from a real translated page), verbatim. This is the actual
  // input that reached the backend and failed to normalize live even
  // though the hand-typed fixtures above (identical Turkish content,
  // but tidied spacing/casing) passed. It differs from the fixtures in
  // two ways real authored text varies: a stray space before an
  // apostrophe-attached suffix ("flo’ lar" instead of "flo’lar"), and the
  // "ile" postposition suffixed directly onto its noun ("ipimizle")
  // instead of written as a separate word ("ipimiz ile").
  it("normalizes referenced-loop attachment and surface slip stitches from real Canva source text with authoring variance", async () => {
    const provider = new InspectingProvider();
    const block1 =
      "10) Görselde görüldüğü gibi yeşil ipimizi, 9. sırada Blo’dan ördüğümüz sık iğnelerin Flo’sundan (tabanın ters yüzünü çevirdiğimiz için flo’ lar iç kısımda kaldı) sabitliyoruz, 32x. Yine bütün sıra sonlarında cc ile birleştirip, 1 zincir çekip bir üst sıraya geçiyoruz.";
    const block3 =
      "✦ Görselde görüldüğü gibi, 9. sırada Blo’dan ördüğümüz sık iğnelerin üzerine yeşil ipimizle ilmek kaydırma yapıyoruz.";

    const [attachResult, slipStitchResult] = await translateBlocks(
      [
        { id: "live-page22-block1", text: block1 },
        { id: "live-page22-block3", text: block3 },
      ],
      "en",
      { provider },
    );

    expect(attachResult?.translated).toContain(
      "Attach the green yarn to the FLO of the single crochet stitches worked in the BLO of Round 9 as shown in the image",
    );
    expect(attachResult?.translated).toContain(
      "(because the base was turned inside out, the FLO loops remained on the inside), then work 32sc.",
    );
    expect(attachResult?.translated).toContain(
      "At the end of each round, join with sl st, ch 1, and continue to the next round.",
    );
    expect(attachResult?.translated).not.toContain("we secure");
    expect(attachResult?.valid).toBe(true);

    expect(slipStitchResult?.translated).toBe(
      "✦ Using green yarn, work slip stitches over the single crochet stitches worked in the BLO of Round 9 as shown in the image.",
    );
    expect(slipStitchResult?.valid).toBe(true);
  });

  it("keeps an image-referenced round-first loop attachment atomic across formatting boundaries", async () => {
    const provider = new InspectingProvider();
    const source =
      "✦ Görselde görüldüğü gibi 5. sırada FLO’dan ördüğümüz sık iğnelerin BLO’sundan yeşil ipimizi sabitliyoruz. " +
      "(1 zincir, sıradaki sık iğneye cc)*32, 1 zincir çekip ipimizi kesiyoruz.";

    const boundary = source.indexOf("BLO") + 2;

    const [result] = await translateBlocks(
      [
        {
          id: "formatted-round-first-image-loop-attachment",
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

    expect(result?.translated).toContain(
      "Attach the green yarn to the BLO of the single crochet stitches worked in the FLO of Round 5 as shown in the image.",
    );
    expect(result?.translated).toContain(
      "(ch 1, sl st into the next single crochet)*32",
    );

    expect(
      result?.translated.match(/Round 5/gu) ?? [],
    ).toHaveLength(1);

    expect(
      result?.translated.match(/\bFLO\b/gu) ?? [],
    ).toHaveLength(1);

    expect(
      result?.translated.match(/\bBLO\b/gu) ?? [],
    ).toHaveLength(1);

    expect(result?.translated).not.toContain("we secure");
    expect(result?.translated).not.toContain("fasten off");

    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  // LIVE REGRESSION: reproduces the actual reported Canva bug, where the
  // deterministic semantic opening was emitted once and then a
  // provider-derived rendering of the same relation was appended a
  // second time. InspectingProvider (a pure echo) cannot expose this --
  // it never restructures the sentence, so any "cut the provider output
  // at its first period" splice happens to land correctly by accident.
  // DuplicateOpeningProvider stands in for a real LLM call that does not
  // preserve that structure. This test fails before the fix (the
  // unnormalized clause reaches the provider and its garbled output gets
  // spliced onto the deterministic opening) and passes after it (the
  // clause is fully resolved before any provider call, so the trap
  // provider is never invoked for it).
  it("does not duplicate the semantic opening when a real provider restructures the round-first loop attachment (live regression)", async () => {
    const provider = new DuplicateOpeningProvider();
    const source =
      "✦ Görselde görüldüğü gibi 5. sırada Flo’dan ördüğümüz sık iğnelerin Blo’sundan yeşil ipimizi sabitliyoruz. " +
      "(1 zincir, sıradaki sık iğneye cc)*32, 1 zincir çekip ipimizi kesiyoruz.";

    const [result] = await translateBlocks(
      [
        {
          id: "live-round-first-loop-attachment",
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

    expect(result?.translated).toContain(
      "Attach the green yarn to the BLO of the single crochet stitches worked in the FLO of Round 5 as shown in the image.",
    );
    expect(result?.translated).toContain(
      "(ch 1, sl st into the next single crochet)*32",
    );
    expect(result?.translated).toContain("cut the yarn");

    expect(result?.translated.match(/Round 5/gu) ?? []).toHaveLength(1);
    expect(result?.translated.match(/\bFLO\b/gu) ?? []).toHaveLength(1);
    expect(result?.translated.match(/\bBLO\b/gu) ?? []).toHaveLength(1);
    expect(
      result?.translated.match(/as shown in the image/gu) ?? [],
    ).toHaveLength(1);

    expect(result?.translated).not.toContain("we secure");
    expect(result?.translated).not.toContain("fasten off");

    const codes = result?.errors.map(({ code }) => code) ?? [];
    expect(codes).not.toContain("NUMBER_MISMATCH");
    expect(codes).not.toContain("ROUND_REFERENCE_MISMATCH");
    expect(codes).not.toContain("LOST_PATTERN_NOTATION");
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);

    // The unnormalized Turkish clause must never reach a translation
    // provider at all -- it is fully resolved deterministically first.
    for (const request of provider.requests) {
      for (const block of request.blocks) {
        expect(block.text).not.toMatch(/sabitliyoruz/iu);
      }
    }
  });

  // LIVE REGRESSION: reproduces the actual reported Canva bug for the
  // second-leg "same rounds" instruction when the source omits the
  // optional "da" particle: "İkinci bacakta ilk 47 sırayı aynı şekilde
  // örüyoruz." (real PDF text) instead of the already-supported
  // "İkinci bacakta da ilk N sırayı..." form. Before the fix, neither the
  // pre-provider normalizer nor the post-provider style-normalizer
  // regex matched the "no da" form, so a plausible LLM number-agreement
  // mistake ("47 round" instead of "47 rounds") survived untouched to
  // the final response. SecondLegSingularRoundProvider stands in for
  // that real, imperfect LLM call. This test fails before the fix and
  // passes after it, proving the complete pipeline -- not just the
  // normalizer or style-normalizer helper in isolation -- repairs the
  // exact production failure.
  it("repairs the second-leg repeated-round instruction end-to-end when the source omits the optional \"da\" particle (live regression)", async () => {
    const provider = new SecondLegSingularRoundProvider();
    const source = "✦ İkinci bacakta ilk 47 sırayı aynı şekilde örüyoruz.";

    const [result] = await translateBlocks(
      [{ id: "live-second-leg-no-da", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "✦ On the second leg, work the first 47 rounds in the same way.",
    );
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  // LIVE REGRESSION: reproduces the reported "39-47) 9 rounds, 29 sc" bug
  // end-to-end. The bare "N sıra Mx" round-count family is now
  // canonicalized (both pre-provider in normalizer.ts and post-provider
  // in style_normalizer.ts) as compact "Msc for N round(s)" rather than
  // "N rounds, Msc" with a stray space. This deliberately reorders the
  // two source numbers, so validator.ts's NUMBER_MISMATCH check carries a
  // matching, narrowly-scoped exception (comparableSourceNumbersWithBareRoundCountSwap)
  // -- this test also proves the result stays valid:true, not just that
  // the text is correct.
  it("canonicalizes the bare round-count family to compact 'Msc for N rounds' end-to-end (live regression)", async () => {
    const provider = new InspectingProvider();

    const [result] = await translateBlocks(
      [{ id: "live-round-count-swap", text: "39-47) 9 sıra 29x" }],
      "en",
      { provider },
    );

    expect(result?.translated).toBe("39-47) 29sc for 9 rounds");
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("validates the persisted 9-line/8-line Block 3 through atomic formatting reconstruction", async () => {
    const provider = new RealBlock3Provider();
    const source =
      "✦ Bu sıradan sonra kol ve \n" +
      "gövdeye teli takabilirsiniz.\n" +
      "4) (7x, 1e)*6 = 48x\n" +
      "5) 3x, 1e, (6x, 1e)*5, 3x = 42x\n" +
      "6) (5x, 1e)*6 = 36x\n" +
      "7) 2x, 1e, (4x, 1e)*5, 2x = 30x\n" +
      "8) (3x, 1e)*6 = 24x\n" +
      "9) 1x, 1e, (2x, 1e)*5, 1x = 18x\n" +
      "10-15) 6 sıra 18x --- ipimizi kesiyoruz. ";
    const expected =
      "✦ After this round, you can attach the wire to the arm and body.\n" +
      "4) (7sc, 1dec)*6 = 48sc\n" +
      "5) 3sc, 1dec, (6sc, 1dec)*5, 3sc = 42sc\n" +
      "6) (5sc, 1dec)*6 = 36sc\n" +
      "7) 2sc, 1dec, (4sc, 1dec)*5, 2sc = 30sc\n" +
      "8) (3sc, 1dec)*6 = 24sc\n" +
      "9) 1sc, 1dec, (2sc, 1dec)*5, 1sc = 18sc\n" +
      "10-15) 18sc for 6 rounds — cut the yarn. ";
    const introEnd = source.indexOf("4)");
    const formattingBoundary = source.lastIndexOf("18x");

    const [result] = await translateBlocks(
      [
        {
          id: "persisted-page-9-block-3",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: 0, end: introEnd },
            { id: "fmt-1", start: introEnd, end: formattingBoundary },
            {
              id: "fmt-2",
              start: formattingBoundary,
              end: source.length,
            },
          ],
        },
      ],
      "en",
      { provider },
    );

    expect(source.split("\n")).toHaveLength(9);
    expect(result?.translated.split("\n")).toHaveLength(8);
    expect(provider.exposedIsolatedSira).toBe(false);
    expect(provider.exposedTurkishYarnCut).toBe(false);
    expect(result?.translated).toBe(expected);
    expect(result?.valid).toBe(true);
    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "NUMBER_MISMATCH",
    );
    expect(result?.formattingProjection).toBe("atomic_collapse");
    expect(result?.targetFormattingRegions?.at(-1)).toEqual({
      id: "fmt-2",
      start: expected.length,
      end: expected.length,
    });
  });

  it("preserves semantic styles when a bare round-count line reorders across a real Canva formatting boundary", async () => {
    const provider = new IsolatedSiraProvider();
    const source =
      "2-11) 10 sıra 64x\n" +
      "12) (14x,1e)*4 = 60x\n" +
      "13) 60x\n" +
      "14) (13x, 1e)*4 = 56x\n" +
      "15) 56x\n" +
      "16) (12x, 1e)*4 = 52x\n" +
      "17) 52x\n" +
      "18) (11x,1e)*4 = 48x\n" +
      "19-33) 15 sıra 48x";
    const formattingBoundary = source.indexOf("64x");

    const [result] = await translateBlocks(
      [
        {
          id: "real-multiline-round-count-formatting",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: 0, end: formattingBoundary },
            {
              id: "fmt-1",
              start: formattingBoundary,
              end: source.length,
            },
          ],
        },
      ],
      "en",
      { provider },
    );

    expect(provider.exposedIsolatedSira).toBe(false);
    expect(result?.translated).toBe(
      "2-11) 64sc for 10 rounds\n" +
        "12) (14sc,1dec)*4 = 60sc\n" +
        "13) 60sc\n" +
        "14) (13sc, 1dec)*4 = 56sc\n" +
        "15) 56sc\n" +
        "16) (12sc, 1dec)*4 = 52sc\n" +
        "17) 52sc\n" +
        "18) (11sc,1dec)*4 = 48sc\n" +
        "19-33) 48sc for 15 rounds",
    );
    expect(result?.valid).toBe(true);
    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "NUMBER_MISMATCH",
    );
    const translated = result?.translated ?? "";
    const translatedFirstLineEnd = translated.indexOf("\n");
    const stitchStart = translated.indexOf("64sc");
    const stitchEnd = stitchStart + "64sc".length;

    expect(result?.targetFormattingRegions).toEqual([
      { id: "fmt-0", start: 0, end: stitchStart },
      { id: "fmt-1", start: stitchStart, end: stitchEnd },
      { id: "fmt-0", start: stitchEnd, end: translatedFirstLineEnd },
      {
        id: "fmt-1",
        start: translatedFirstLineEnd,
        end: translated.length,
      },
    ]);

    expect(result?.formattingProjection).not.toBe("atomic_collapse");
  });

  it("preserves reordered semantic styles inside an atomic span surrounded by ordinary text", async () => {
    const provider = new IsolatedSiraProvider();
    const source = "Header\n2-11) 10 sıra 64x\nFooter";
    const atomicStart = source.indexOf("2-11)");
    const stitchStart = source.indexOf("64x");

    const [result] = await translateBlocks(
      [
        {
          id: "absorbed-atomic-style",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: 0, end: atomicStart },
            { id: "fmt-1", start: atomicStart, end: atomicStart + 6 },
            { id: "fmt-2", start: atomicStart + 6, end: stitchStart },
            { id: "fmt-3", start: stitchStart, end: source.length },
          ],
        },
      ],
      "en",
      { provider },
    );

    expect(provider.exposedIsolatedSira).toBe(false);
    expect(result?.translated).toBe("Header\n2-11) 64sc for 10 rounds\nFooter");
    const translatedAtomicStart = result?.translated.indexOf("2-11)") ?? -1;
    const translatedAtomicEnd = result?.translated.indexOf("\nFooter") ?? -1;
    const translated = result?.translated ?? "";
    const translatedStitchStart = translated.indexOf("64sc");
    const translatedStitchEnd =
      translatedStitchStart + "64sc".length;

    expect(result?.targetFormattingRegions).toEqual([
      { id: "fmt-0", start: 0, end: translatedAtomicStart },
      {
        id: "fmt-1",
        start: translatedAtomicStart,
        end: translatedStitchStart,
      },
      {
        id: "fmt-3",
        start: translatedStitchStart,
        end: translatedStitchEnd,
      },
      {
        id: "fmt-2",
        start: translatedStitchEnd,
        end: translatedAtomicEnd,
      },
      {
        id: "fmt-3",
        start: translatedAtomicEnd,
        end: translated.length,
      },
    ]);

    expect(
      result?.targetFormattingRegions?.some(
        ({ start, end }) => start === end,
      ),
    ).toBe(false);

    expect(result?.formattingProjection).not.toBe("atomic_collapse");
    expect(result?.valid).toBe(true);
  });

  // LIVE REGRESSION: reproduces the reported "48) Work 24sc., ch 1 and cut
  // the yarn." bug end-to-end. The standalone "Nx örüyoruz" rule
  // previously always appended a period, even when the source clause
  // continues past a comma into a chain-and-cut instruction, producing a
  // stray period before the continuation.
  it("does not insert a stray period before a comma-joined chain-and-cut continuation end-to-end (live regression)", async () => {
    const provider = new InspectingProvider();

    const [result] = await translateBlocks(
      [
        {
          id: "live-chain-cut-punctuation",
          text: "48) 24x örüyoruz, 1 zincir çekip ipimizi kesiyoruz.",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toBe("48) Work 24sc, ch 1 and cut the yarn.");
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  // Page 24 sibling of the live regression above: the referenced-loop
  // relation appears mid-instruction as a stitch-count action ("work N in
  // the referenced loop, then continue with M") rather than yarn
  // attachment. RestructuredStitchCountProvider stands in for a real LLM
  // call that both reverses the FLO/BLO relationship and duplicates the
  // round mention. This test fails before the fix (the unnormalized
  // clause reaches the provider and its garbled, reversed output survives)
  // and passes after it (the clause is fully resolved before any provider
  // call, so the trap provider is never invoked for it).
  it("does not reverse or duplicate the referenced-loop relation when a real provider restructures the stitch-count family (Page 24 live regression, Round 22)", async () => {
    const provider = new RestructuredStitchCountProvider();
    const source =
      "22. sırada Flo’dan ördüğümüz sık iğnelerin Blo’sundan 24x örüp devam ediyoruz, 12x";

    const [result] = await translateBlocks(
      [{ id: "live-referenced-loop-stitch-count", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "In Round 22, work 24sc in the BLO of the single crochet stitches worked in the FLO, then continue with 12sc",
    );

    expect(result?.translated.match(/Round 22/gu) ?? []).toHaveLength(1);
    expect(result?.translated.match(/\bFLO\b/gu) ?? []).toHaveLength(1);
    expect(result?.translated.match(/\bBLO\b/gu) ?? []).toHaveLength(1);

    expect(result?.translated).not.toContain("we worked from FLO");
    expect(result?.translated).not.toContain("BLO of the single crochets we worked");

    const codes = result?.errors.map(({ code }) => code) ?? [];
    expect(codes).not.toContain("NUMBER_MISMATCH");
    expect(codes).not.toContain("ROUND_REFERENCE_MISMATCH");
    expect(codes).not.toContain("LOST_PATTERN_NOTATION");
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);

    for (const request of provider.requests) {
      for (const block of request.blocks) {
        expect(block.text).not.toMatch(/devam\s+ediyoruz/iu);
      }
    }
  });

  it("does not reverse or duplicate the referenced-loop relation when a real provider restructures the stitch-count family (Page 24 live regression, Round 25 with total)", async () => {
    const provider = new RestructuredStitchCountProvider();
    const source =
      "25. sırada Flo’dan ördüğümüz sık iğnelerin Blo’sundan 48x örüyoruz devam ediyoruz, 12x = 60x";

    const [result] = await translateBlocks(
      [{ id: "live-referenced-loop-stitch-count-total", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "In Round 25, work 48sc in the BLO of the single crochet stitches worked in the FLO, then continue with 12sc = 60sc",
    );

    expect(result?.translated.match(/Round 25/gu) ?? []).toHaveLength(1);
    expect(result?.translated.match(/\bFLO\b/gu) ?? []).toHaveLength(1);
    expect(result?.translated.match(/\bBLO\b/gu) ?? []).toHaveLength(1);

    const codes = result?.errors.map(({ code }) => code) ?? [];
    expect(codes).not.toContain("NUMBER_MISMATCH");
    expect(codes).not.toContain("ROUND_REFERENCE_MISMATCH");
    expect(codes).not.toContain("LOST_PATTERN_NOTATION");
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  // Page 25 line 53: same round-first loop-attachment family as Page 23,
  // but in the opposite direction (worked loop = BLO, attachment/current
  // loop = FLO) and followed by a repeated parenthesized action plus the
  // round-end finishing clause. Exercises the existing DuplicateOpeningProvider
  // trap against this direction, plus the new sentence-boundary fix, in one
  // full-pipeline pass.
  it("preserves the Round 27 BLO-worked/FLO-attachment relation and produces a clean sentence boundary (Page 25 live regression)", async () => {
    const provider = new DuplicateOpeningProvider();
    const source =
      "Görselde görüldüğü gibi 27. sırada Blo’dan ördüğümüz sık iğnelerin Flo’sundan turuncu ipimizi sabitliyoruz. " +
      "(1 zincir, sıradaki sık iğneye cc)*60, sıra sonuna geldiğimizde 1 zincir çekip ipimizi kesiyoruz.";

    const [result] = await translateBlocks(
      [{ id: "live-round-27-loop-attachment", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "Attach the orange yarn to the FLO of the single crochet stitches worked in the BLO of Round 27 as shown in the image.",
    );
    expect(result?.translated).toContain(
      "(ch 1, sl st into the next single crochet)*60.",
    );
    expect(result?.translated).toContain(
      "At the end of the round, ch 1 and cut the yarn",
    );

    expect(result?.translated.match(/Round 27/gu) ?? []).toHaveLength(1);
    expect(result?.translated.match(/\bFLO\b/gu) ?? []).toHaveLength(1);
    expect(result?.translated.match(/\bBLO\b/gu) ?? []).toHaveLength(1);
    expect(
      result?.translated.match(/as shown in the image/gu) ?? [],
    ).toHaveLength(1);

    expect(result?.translated).not.toContain("we secure");
    expect(result?.translated).not.toContain("fasten off");
    // No awkward comma-then-capital sentence boundary before the finishing
    // clause.
    expect(result?.translated).not.toContain(", At the end of the round");

    const codes = result?.errors.map(({ code }) => code) ?? [];
    expect(codes).not.toContain("NUMBER_MISMATCH");
    expect(codes).not.toContain("ROUND_REFERENCE_MISMATCH");
    expect(codes).not.toContain("LOST_PATTERN_NOTATION");
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  // Page 25 line 52 (optional full-pipeline regression): the singular
  // skip-count fix and the new chain/skip/work/continue instruction family,
  // through the full pipeline with a real (non-echo) provider.
  it("produces natural singular skip phrasing and no mechanical \"we continue\" through the full pipeline (Page 25 line 52)", async () => {
    const provider = new InspectingProvider();
    const source =
      "2 zincir, 1x atla, sıradaki sık iğneye 1x, bu şekilde sıra sonuna kadar devam ediyoruz. " +
      "Sıra sonuna geldiğimizde 1 zincir çekip ipimizi kesiyoruz.";

    const [result] = await translateBlocks(
      [{ id: "live-round-end-skip-work-continue", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).not.toContain("1 sts");
    expect(result?.translated).not.toContain(", we continue");
    expect(result?.translated).not.toContain(", At the end of the round");
    expect(result?.translated).toContain(
      "Continue in this way to the end of the round.",
    );
    expect(result?.translated).toContain(
      "At the end of the round, ch 1 and cut the yarn",
    );

    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("preserves real Canva formatting regions for a round-first loop attachment with repeated slip stitches and round-end finishing", async () => {
    const provider = new InspectingProvider();

    const source =
      "53) Görselde görüldüğü gibi 27. sırada Blo’dan ördüğümüz sık iğnelerin Flo’sundan turuncu ipimizi sabitliyoruz. " +
      "(1 zincir, sıradaki sık iğneye cc)*60, sıra sonuna geldiğimizde \n" +
      "1 zincir çekip ipimizi kesiyoruz.";

    const [result] = await translateBlocks(
      [
        {
          id: "real-page-25-line-53-formatting",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: 0, end: 4 },
            { id: "fmt-1", start: 4, end: 146 },
            { id: "fmt-2", start: 146, end: 149 },
            { id: "fmt-3", start: 149, end: 210 },
          ],
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "53) Attach the orange yarn to the FLO of the single crochet stitches worked in the BLO of Round 27 as shown in the image. " +
        "(ch 1, sl st into the next single crochet)*60. At the end of the round, ch 1 and cut the yarn.",
    );

    expect(result?.valid).toBe(true);
    expect(result?.errors).toEqual([]);

    expect(result?.targetFormattingRegions).toBeDefined();
    expect(result?.targetFormattingRegions).toHaveLength(4);
    expect(result?.targetFormattingRegions?.map(({ id }) => id)).toEqual([
      "fmt-0",
      "fmt-1",
      "fmt-2",
      "fmt-3",
    ]);

    expect(result?.targetFormattingRegions?.[0]).toEqual({
      id: "fmt-0",
      start: 0,
      end: 4,
    });

    expect(
      result?.targetFormattingRegions?.every(
        ({ start, end }) =>
          Number.isInteger(start) &&
          Number.isInteger(end) &&
          start >= 0 &&
          end >= start &&
          end <= (result?.translated.length ?? 0),
      ),
    ).toBe(true);

    for (
      let index = 1;
      index < (result?.targetFormattingRegions?.length ?? 0);
      index += 1
    ) {
      expect(result?.targetFormattingRegions?.[index]?.start).toBe(
        result?.targetFormattingRegions?.[index - 1]?.end,
      );
    }

    expect(
      result?.targetFormattingRegions?.at(-1)?.end,
    ).toBe(result?.translated.length);
  });

  it("normalizes an image-referenced round-first loop attachment through the full pipeline", async () => {
    const provider = new InspectingProvider();
    const source =
      "Görselde görüldüğü gibi 5. sırada FLO’dan ördüğümüz sık iğnelerin BLO’sundan yeşil ipimizi sabitliyoruz.";

    const [result] = await translateBlocks(
      [{ id: "generic-image-referenced-loop-attachment", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "Attach the green yarn to the BLO of the single crochet stitches worked in the FLO of Round 5 as shown in the image.",
    );

    expect(result?.translated).not.toContain("fasten off");
    expect(result?.translated).not.toContain("we secure");

    const codes = result?.errors.map(({ code }) => code) ?? [];
    expect(codes).not.toContain("LOST_PATTERN_NOTATION");
    expect(codes).not.toContain("ROUND_REFERENCE_MISMATCH");
    expect(codes).not.toContain("NUMBER_MISMATCH");
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
      "Work 12sl st (slip stitches).",
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

  // The bare round-count family (e.g. "12 sıra 66x") is deliberately
  // canonicalized as "66sc for 12 rounds", which reorders the source's
  // numeric sequence. validator.ts carries a narrow, source-aware exception
  // for exactly this swap, so these cases are asserted separately from the
  // generic pipeline block above: they check the exact translated text,
  // that validation still passes with no NUMBER_MISMATCH, and that the same
  // numeric values survive translation as a set (order is expected to
  // differ). Every other case keeps the strict source-order assertion above.
  it.each([
    ["12 sıra 66x", "66sc for 12 rounds"],
    ["3 sıra 78x", "78sc for 3 rounds"],
    ["28-30) 3 sıra 78x", "28-30) 78sc for 3 rounds"],
  ])(
    "normalizes bare round-count %s through the full pipeline with an intentional numeric reorder",
    async (source, expected) => {
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
      expect(result?.errors.map(({ code }) => code)).not.toContain(
        "NUMBER_MISMATCH",
      );

      const sourceNumbers = source.match(/\d+(?:[.,]\d+)?/gu) ?? [];
      const translatedNumbers =
        result?.translated.match(/\d+(?:[.,]\d+)?/gu) ?? [];
      expect(translatedNumbers).toHaveLength(sourceNumbers.length);
      expect(new Set(translatedNumbers)).toEqual(new Set(sourceNumbers));
    },
  );

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

  // ==========================================================================
  // Phase 2: atomic full-span provider bypass (Page 11 live regression,
  // Rounds 8 and 11) -- see round_references.ts / atomic_spans.ts / translator.ts.
  // ==========================================================================

  it.each([
    [
      "11. sırada FLO’dan ördüğümüz sık iğnelerin, BLO’sundan ipimizi sabitliyoruz.",
      "Attach the yarn to the BLO of the single crochet stitches worked in the FLO of Round 11.",
    ],
    [
      "8. sırada Flo’dan ördüğümüz sık iğnelerin Blo’sundan ipimizi sabitliyoruz.",
      "Attach the yarn to the BLO of the single crochet stitches worked in the FLO of Round 8.",
    ],
    [
      // Mixed Flo/FLO/Blo/blo source casing, reversed loop direction.
      "8. sırada BLO’dan ördüğümüz sık iğnelerin flo’dan ipimizi sabitliyoruz.",
      "Attach the yarn to the FLO of the single crochet stitches worked in the BLO of Round 8.",
    ],
  ])(
    "bypasses the provider entirely for a segment fully covered by the nested round/FLO-BLO atomic family and keeps the canonical deterministic output (Page 11 live regression): %s",
    async (source, expected) => {
      const provider = new UnconditionalCorruptingProvider();

      const [result] = await translateBlocks(
        [{ id: "page11-round-flo-blo", text: source }],
        "en",
        { provider },
      );

      // The strongest possible proof the provider was skipped: even though
      // this trap unconditionally corrupts (duplicates) anything it
      // receives, the output is exactly the canonical deterministic string
      // -- not a duplicated/garbled one.
      expect(result?.translated).toBe(expected);
      expect(provider.requests).toHaveLength(0);

      const codes = result?.errors.map(({ code }) => code) ?? [];
      expect(codes).not.toContain("ROUND_REFERENCE_MISMATCH");
      expect(result?.errors).toEqual([]);
      expect(result?.valid).toBe(true);
    },
  );

  it("still calls the provider (does not bypass) when a segment mixes the atomic round/FLO-BLO clause with unrelated non-atomic prose, and the reconstructed output is still correct (partial coverage must not blindly bypass unrelated prose)", async () => {
    const provider = new InspectingProvider();
    // The atomic span here covers only the leading clause (through "sık
    // iğneye 4x"); "birazcık daha ekleyelim" is ordinary prose the atomic
    // registry does not recognize, so the segment as a whole is not fully
    // covered and must still go through the provider.
    const source =
      "11. sırada FLO’dan ördüğümüz sık iğnelerin, BLO’sundan ipimizi sabitliyoruz. Sonra biraz daha örüyoruz.";

    const [result] = await translateBlocks(
      [{ id: "page11-partial-coverage", text: source }],
      "en",
      { provider },
    );

    expect(provider.requests.length).toBeGreaterThan(0);
    expect(result?.translated).toContain(
      "Attach the yarn to the BLO of the single crochet stitches worked in the FLO of Round 11.",
    );
    const codes = result?.errors.map(({ code }) => code) ?? [];
    expect(codes).not.toContain("ROUND_REFERENCE_MISMATCH");
    expect(result?.valid).toBe(true);
  });

  it("still BLOCKs a wrong round number even when the atomic bypass applies to the source (the bypass renders the source's own round number, so a mismatched target is a provider-independent structural check)", () => {
    // The bypass path only ever renders the round number *the source
    // itself contains* -- there is no way for the deterministic renderer to
    // produce a wrong number. The existing negative-case matrix in
    // round_references.test.ts ("rejects a lost or malformed round-loop
    // relation") already proves a mismatched round number, a reversed
    // FLO/BLO relation, and a missing round number all still BLOCK; this is
    // a direct pipeline-level sanity check against a StubProvider forcing a
    // deliberately wrong result for a source segment this bypass does *not*
    // fully cover (a bare loop clause with no round token), so the
    // validator -- not the bypass -- is what's under test here.
    const source = "6. sıranın FLO’sundan örüyoruz.";
    const wrongRound = "Work into the FLO of Round 7.";
    const reversedLoop = "Work into the BLO of Round 6.";
    const missingRound = "Work into the FLO.";

    expect(
      validateTranslation(source, wrongRound, "en").errors,
    ).toContainEqual(expect.objectContaining({ code: "ROUND_REFERENCE_MISMATCH" }));
    expect(
      validateTranslation(source, reversedLoop, "en").errors,
    ).toContainEqual(expect.objectContaining({ code: "ROUND_REFERENCE_MISMATCH" }));
    expect(
      validateTranslation(source, missingRound, "en").errors,
    ).toContainEqual(expect.objectContaining({ code: "ROUND_REFERENCE_MISMATCH" }));
  });

  it("bypasses the provider for a different, unrelated atomic round/FLO-BLO family (stitch-count variant, Round 33) -- proves the bypass is based on atomic full-span coverage, not fixture matching", async () => {
    const provider = new UnconditionalCorruptingProvider();
    const source =
      "33. sırada FLO’dan ördüğümüz sık iğnelerin BLO’sundan 20x örüp devam ediyoruz, 10x";

    const [result] = await translateBlocks(
      [{ id: "generic-atomic-round-33", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "In Round 33, work 20sc in the BLO of the single crochet stitches worked in the FLO, then continue with 10sc",
    );
    expect(provider.requests).toHaveLength(0);
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  // ==========================================================================
  // Phase 2 follow-up fix: atomic *structural* coverage alone must not imply
  // it is safe to bypass the provider -- only the conjunction with confirmed
  // *deterministic target-language resolution* does. A real Vitest run
  // surfaced that the first version of this bypass regressed the
  // pre-existing Spanish bare round-count translation (Segment 13: see the
  // "reconstructs the Segment 13 numeric range safely" test above), because
  // it treated the raw Turkish source being an atomic span as sufficient
  // justification for skipping the provider even when no deterministic
  // renderer for the requested target language exists for that source
  // family. See `isDeterministicallyResolvedForTargetLanguage` in
  // translator.ts.
  // ==========================================================================

  it("does NOT bypass the provider for the bare round-count atomic family when translating into Spanish, because no deterministic Spanish renderer exists for it -- atomic coverage alone must not imply bypass (Failure 1 regression guard)", async () => {
    const provider: TranslationProvider = {
      name: "bare-round-count-es",
      model: "stub",
      async checkReadiness() {
        return { ok: true, provider: this.name, model: this.model };
      },
      async translate(request) {
        return {
          translations: request.blocks.map(({ id }) => ({
            id,
            translated: "vueltas",
          })),
        };
      },
    };

    const [result] = await translateBlocks(
      [{ id: "segment-13-es-regression", text: "12-23) 12 sıra 66x" }],
      "es",
      { provider },
    );

    // The deterministic Turkish "sıra" -> Spanish "vueltas" swap can only
    // happen if the provider (or an equivalent deterministic resolution
    // step) actually runs against this source; a wrongly-bypassed segment
    // would leave the untranslated Turkish word "sıra" in the output.
    expect(result?.translated).toBe("12-23) 12 vueltas 66pb");
    expect(result?.translated).not.toContain("sıra");
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("still bypasses the provider for the SAME bare round-count atomic family when translating into English, where a deterministic renderer does exist -- proves the fix is about resolution capability, not a blanket disabling of the bypass", async () => {
    const provider = new UnconditionalCorruptingProvider();

    const [result] = await translateBlocks(
      [{ id: "segment-13-en-unaffected", text: "12-23) 12 sıra 66x" }],
      "en",
      { provider },
    );

    expect(result?.translated).toBe("12-23) 66sc for 12 rounds");
    expect(provider.requests).toHaveLength(0);
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("does NOT bypass the provider for the nested round/FLO-BLO atomic family when translating into Spanish either, for the same reason -- the deterministic renderer for this family is also English-only (proves atomic full-span coverage alone is insufficient whenever target-language resolution is incomplete, independent of which atomic family is involved)", async () => {
    const provider = new InspectingProvider();
    const source =
      "11. sırada FLO\u2019dan ördüğümüz sık iğnelerin, BLO\u2019sundan ipimizi sabitliyoruz.";

    await translateBlocks(
      [{ id: "page11-es-regression", text: source }],
      "es",
      { provider },
    );

    // The point isn't what a stub echo provider produces (it cannot
    // perform a real translation) -- it's that the raw, unresolved Turkish
    // clause was actually handed to the provider at all, proving this
    // segment was not silently bypassed the way the atomic full-span
    // bypass alone would have done pre-fix.
    expect(provider.requests.length).toBeGreaterThan(0);
    expect(provider.protectedTexts.join(" ")).toMatch(/sabitliyoruz/iu);
  });

  // ==========================================================================
  // Phase 2: generic continuation normalization (Page 11 live regression --
  // chain/skip/slip-stitch continuation). See normalizer.ts.
  // ==========================================================================

  it("keeps the saved live Block 14 'sırdaki' continuation deterministic while allowing unrelated wig prose to use the provider", async () => {
    const provider = new InspectingProvider();

    const source =
      "14) Peruğun ters tarafını çeviriyoruz (sık iğnelerin düz tarafı içeride kalacak, ters tarafı dışarıya gelecek. " +
      "Bu şekilde ters çevirdiğimizde peruk kafaya daha muntazam bir şekilde yerleşiyor). " +
      "11. sırada FLO’dan ördüğümüz sık iğnelerin, BLO’sundan ipimizi sabitliyoruz. " +
      "20 zincir çekip dönüyoruz, zincir üzerine üçüncü zincirden itibaren 18hdc, " +
      "1x atla sıradaki ilmeğe cc, tekrar sırdaki sık iğneye cc yapıyoruz. " +
      "Bu şekilde sıra sonuna kadar devam ediyoruz. " +
      "Sıra sonuna geldiğimizde 3 zincir çekiyoruz.";

    const [result] = await translateBlocks(
      [{ id: "page11-live-block14-sirdaki", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "Attach the yarn to the BLO of the single crochet stitches worked in the FLO of Round 11.",
    );
    expect(result?.translated).toContain("Ch 20 and turn.");
    expect(result?.translated).toContain("work 18hdc");
    expect(result?.translated).toContain("skip 1sc");
    expect(result?.translated).toContain("sl st into the next stitch");
    expect(result?.translated).toContain(
      "then sl st into the following single crochet",
    );
    expect(result?.translated).toContain(
      "Continue in this way to the end of the round.",
    );
    expect(result?.translated).toContain("At the end of the round, ch 3.");

    expect(result?.translated).not.toContain("sırdaki");
    expect(result?.translated).not.toContain(
      "into the single crochet in the next round",
    );

    expect(provider.requests.length).toBeGreaterThan(0);

    const providerText = provider.protectedTexts.join(" ");
    expect(providerText).not.toMatch(/tekrar\s+sırdaki/iu);
    expect(providerText).not.toMatch(/20\s+zincir/iu);
    expect(providerText).not.toMatch(/11\.\s*sıra/iu);

    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("does not bypass the provider for the 'sırdaki' continuation family in Spanish", async () => {
    const provider = new InspectingProvider();

    const source =
      "20 zincir çekip dönüyoruz, zincir üzerine üçüncü zincirden itibaren 18hdc, " +
      "1x atla sıradaki ilmeğe cc, tekrar sırdaki sık iğneye cc yapıyoruz. " +
      "Bu şekilde sıra sonuna kadar devam ediyoruz. " +
      "Sıra sonuna geldiğimizde 3 zincir çekiyoruz.";

    await translateBlocks(
      [{ id: "page11-sirdaki-es-regression", text: source }],
      "es",
      { provider },
    );

    expect(provider.requests.length).toBeGreaterThan(0);
  });

  it("produces crochet-native English for the chain/skip/slip-stitch continuation family, preserving exact numbers and compact notation (Page 11 live regression)", async () => {
    const provider = new UnconditionalCorruptingProvider();
    const source =
      "20 zincir çekip dönüyoruz, zincir üzerine üçüncü zincirden itibaren 18hdc, " +
      "1x atla sıradaki ilmeğe cc, tekrar sıradaki sık iğneye cc yapıyoruz. " +
      "Bu şekilde sıra sonuna kadar devam ediyoruz. " +
      "Sıra sonuna geldiğimizde 3 zincir çekiyoruz.";

    const [result] = await translateBlocks(
      [{ id: "page11-continuation", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain("Ch 20 and turn.");
    expect(result?.translated).toContain("work 18hdc");
    expect(result?.translated).toContain("skip 1sc");
    expect(result?.translated).toContain("sl st into the next stitch");
    expect(result?.translated).toContain("sl st into the following single crochet");
    expect(result?.translated).toContain(
      "Continue in this way to the end of the round.",
    );
    expect(result?.translated).toContain("At the end of the round, ch 3.");

    // Exact numbers preserved. "18" and "1" are immediately followed by a
    // compact stitch abbreviation ("18hdc", "1sc") with no intervening
    // space, so there is no word boundary between the digits and the
    // following letters -- `\b18\b` and `\b1\b` can never match "18hdc" /
    // "1sc" (both "8"/"h" and "1"/"s" are `\w` characters). Assert those two
    // via the actual compact notation instead of a word-boundary regex.
    // "20" and "3" are each followed by a non-word character (a space, a
    // period) in this output, so the word-boundary form still applies to
    // them.
    expect(result?.translated).toMatch(/\b20\b/u);
    expect(result?.translated).toContain("18hdc");
    expect(result?.translated).toContain("1sc");
    expect(result?.translated).toMatch(/\b3\b/u);

    // Compact notation preserved (never "18 hdc" / "1 sc").
    expect(result?.translated).not.toContain("18 hdc");
    expect(result?.translated).not.toContain("1 sc");

    // No mechanical "when we reach the end of the round N we chain".
    expect(result?.translated).not.toContain("we chain");
    expect(result?.translated).not.toContain("on the chain 18hdc");
    expect(provider.requests).toHaveLength(0);

    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it.each([
    ["... 3 zincir çekiyoruz.", 3],
    ["... 1 zincir çekiyoruz.", 1],
  ])(
    "renders the no-yarn-cut round-end sibling distinctly from the yarn-cut family: %s",
    async (suffix, chains) => {
      const provider = new InspectingProvider();
      const source = `Sıra sonuna geldiğimizde ${chains} zincir çekiyoruz.`;

      const [result] = await translateBlocks(
        [{ id: "round-end-no-cut", text: source }],
        "en",
        { provider },
      );

      expect(result?.translated).toBe(`At the end of the round, ch ${chains}.`);
      expect(result?.translated).not.toContain("cut the yarn");
      expect(result?.valid).toBe(true);
    },
  );

  // ==========================================================================
  // Phase 2: full Page 11 regression -- both diagnosed fixes together,
  // across the whole real block (nested Round 11 FLO/BLO attachment as its
  // own segment, plus the 20-chain continuation as a second segment).
  // ==========================================================================

  it("full Page 11 regression: nested Round 11 FLO/BLO attachment bypasses the provider while the chain/skip/slip-stitch continuation translates to crochet-native English, with no ROUND_REFERENCE_MISMATCH and every number/compact-notation token preserved", async () => {
    const provider = new UnconditionalCorruptingProvider();

    const roundFloBloSource =
      "11. sırada FLO’dan ördüğümüz sık iğnelerin, BLO’sundan ipimizi sabitliyoruz.";
    const continuationSource =
      "20 zincir çekip dönüyoruz, zincir üzerine üçüncü zincirden itibaren 18hdc, " +
      "1x atla sıradaki ilmeğe cc, tekrar sıradaki sık iğneye cc yapıyoruz. " +
      "Bu şekilde sıra sonuna kadar devam ediyoruz. " +
      "Sıra sonuna geldiğimizde 3 zincir çekiyoruz.";

    const results = await translateBlocks(
      [
        { id: "page11-block-a-round-flo-blo", text: roundFloBloSource },
        { id: "page11-block-b-continuation", text: continuationSource },
      ],
      "en",
      { provider },
    );

    const [roundResult, continuationResult] = results;

    // Block A: fully deterministic, atomic-covered -- provider never called
    // for it, and its output is the exact canonical string even though the
    // provider would have corrupted it had it been invoked.
    expect(roundResult?.translated).toBe(
      "Attach the yarn to the BLO of the single crochet stitches worked in the FLO of Round 11.",
    );
    expect(roundResult?.errors).toEqual([]);
    expect(roundResult?.valid).toBe(true);
    expect(
      roundResult?.errors.map(({ code }) => code) ?? [],
    ).not.toContain("ROUND_REFERENCE_MISMATCH");

    // Block B: not atomic (real prose throughout), so the provider is
    // called -- but it's now called with already crochet-native English
    // fragments (from the newly-extended normalizer families) rather than
    // raw, unguided Turkish, so the corrupting trap's duplication lands
    // only in the free-form prose, never inside a protected number or
    // notation placeholder.
    expect(continuationResult?.valid).toBe(true);

    expect(continuationResult?.translated).toMatch(/\bCh 20\b/u);
    expect(continuationResult?.translated).toMatch(/\b18hdc\b/u);
    expect(continuationResult?.translated).toMatch(/\b3\b/u);

    // Every protected numeric value from the source survives, unmutated,
    // in the reconstructed output (order aside, since the trap provider
    // duplicates prose around them).
    for (const value of ["20", "18", "1", "3"]) {
      expect(continuationResult?.translated).toContain(value);
    }

    expect(provider.requests).toHaveLength(0);
    for (const request of provider.requests) {
      for (const block of request.blocks) {
        // The atomic Round 11 clause must never reach the provider, even
        // indirectly as a sub-fragment.
        expect(block.text).not.toContain("Round 11");
        expect(block.text).not.toMatch(/sabitliyoruz/iu);
      }
    }
  });
});

describe("Page 13 round-count trailing-action regressions", () => {
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
  ])(
    "bypasses the provider for a fully deterministic round-count + %s instruction",
    async (_label, source, expected) => {
      const provider = new UnconditionalCorruptingProvider();

      const [result] = await translateBlocks(
        [{ id: "page13-round-count-trailing-action", text: source }],
        "en",
        { provider },
      );

      expect(result?.translated).toBe(expected);
      expect(provider.requests).toHaveLength(0);
      expect(result?.errors).toEqual([]);
      expect(result?.valid).toBe(true);
    },
  );

  it("keeps round-count trailing actions atomic when Canva formatting bisects them inside mixed prose", async () => {
    const provider = new InspectingProvider();

    const freeProse = "Bu bölümde çalışmaya devam ediyoruz.\n";
    const buttonhole =
      "12-20) 9 sıra 54x, 6 zincir (düğme iliği)";
    const chainAndCut =
      "21-25) 5 sıra 54x, 1 zincir çekip ipimizi kesiyoruz.";

    const source =
      freeProse +
      buttonhole +
      "\n" +
      chainAndCut;

    // Intentionally place Canva style boundaries inside both deterministic
    // semantic spans. Atomic ownership must prevent either instruction from
    // being fragmented and exposed to the provider.
    const boundaryA = source.indexOf("54x, 6") + 2;
    const boundaryB = source.indexOf("54x, 1") + 2;

    const [result] = await translateBlocks(
      [
        {
          id: "formatted-page13-round-count-trailing-actions",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: 0, end: boundaryA },
            { id: "fmt-1", start: boundaryA, end: boundaryB },
            { id: "fmt-2", start: boundaryB, end: source.length },
          ],
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "12-20) 54sc for 9 rounds, ch 6 (buttonhole)",
    );
    expect(result?.translated).toContain(
      "21-25) 54sc for 5 rounds, ch 1 and cut the yarn.",
    );

    // The unrelated prose still uses the provider.
    expect(provider.requests.length).toBeGreaterThan(0);

    const providerText = provider.protectedTexts.join(" ");

    expect(providerText).not.toMatch(/9\s+sıra\s+54x/iu);
    expect(providerText).not.toMatch(/5\s+sıra\s+54x/iu);
    expect(providerText).not.toMatch(/düğme\s+iliği/iu);
    expect(providerText).not.toMatch(/ipimizi\s+kesiyoruz/iu);

    expect(result?.targetFormattingRegions).toBeDefined();
    expect(result?.targetFormattingRegions).toHaveLength(3);
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it.each([
    "12-20) 9 sıra 54x, 6 zincir (düğme iliği)",
    "21-25) 5 sıra 54x, 1 zincir çekip ipimizi kesiyoruz.",
  ])(
    "does not bypass the provider for the round-count trailing-action family in Spanish: %s",
    async (source) => {
      const provider = new InspectingProvider();

      await translateBlocks(
        [{ id: "page13-round-count-trailing-action-es", text: source }],
        "es",
        { provider },
      );

      expect(provider.requests.length).toBeGreaterThan(0);
    },
  );
});

describe("Page 13 yarn intro and armhole regressions", () => {
  it("renders the lilac yarn introduction deterministically through the full pipeline", async () => {
    const provider = new InspectingProvider();

    const [result] = await translateBlocks(
      [
        {
          id: "page13-lilac-yarn-intro",
          text: "Lila renk ip (Catania 226) ile başlıyoruz.",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "Start with lilac yarn (Catania 226).",
    );
    expect(result?.valid).toBe(true);
    expect(result?.errors).toEqual([]);
  });

  it("normalizes both armhole skip phrasings consistently in the same row", async () => {
    const provider = new InspectingProvider();

    const source =
      "9) 9x, 6 zincir çekip 12x atlıyoruz (kol boşluğu oluşturuyoruz), " +
      "18x, 6 zincir, 12x atla (kol boşluğu), 9x";

    const [result] = await translateBlocks(
      [{ id: "page13-armhole-row9", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "9sc, ch 6, skip 12 sts",
    );
    expect(result?.translated).toContain(
      "18sc, ch 6, skip 12 sts",
    );

    expect(result?.translated).not.toContain("12sc");
    expect(result?.translated).not.toContain("6 chain and skip");

    expect(result?.valid).toBe(true);
    expect(result?.errors).toEqual([]);
  });
});

describe("Page 13 final buttonhole regressions", () => {
  it("normalizes the complete first-row buttonhole guidance through the full pipeline", async () => {
    const provider = new InspectingProvider();

    const source =
      "1) 34 zincir çekip dönüyoruz. " +
      "6 zincir atlıyoruz (düğme iliği oluşturuyoruz. " +
      "Düğme iliği için çektiğimiz zincir sayısını, " +
      "kullanacağınız düğme boyutuna göre arttırıp ya da azaltabilirsiniz.) " +
      "Yedinci zincirden itibaren 28x örüyoruz.";

    const [result] = await translateBlocks(
      [{ id: "page13-buttonhole-row1", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain("Ch 34 and turn.");
    expect(result?.translated).toContain(
      "Skip 6 chains (to form a buttonhole;",
    );
    expect(result?.translated).toContain(
      "you can increase or decrease the number of chains depending on the size of the button you will use).",
    );
    expect(result?.translated).toContain(
      "Starting from the seventh chain",
    );
    expect(result?.translated).toContain("28sc");

    expect(result?.translated).not.toContain("we are forming");
    expect(result?.translated).not.toContain("chains we make");

    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("normalizes standalone buttonhole chains through the full pipeline", async () => {
    const provider = new InspectingProvider();

    const [result] = await translateBlocks(
      [
        {
          id: "page13-standalone-buttonhole",
          text: "6 zincir (düğme iliği)",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toBe("ch 6 (buttonhole)");
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("uses unit-neutral repeated course-end turn wording through the full pipeline (Task 18B)", async () => {
    const provider = new InspectingProvider();

    const [result] = await translateBlocks(
      [
        {
          id: "page13-round-end-turn",
          text: "Sıra sonlarında 1 zincir çekip dönüyoruz.",
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "Each time you reach the end, ch 1 and turn.",
    );
    expect(result?.translated).not.toContain("end of each round");
    expect(provider.requests).toHaveLength(0);
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });
});

describe("Page 13 long buttonhole formatting regression", () => {
  it("keeps long buttonhole guidance atomic when Canva formatting bisects it", async () => {
    const provider = new InspectingProvider();

    const prefix = "1) 34 zincir çekip dönüyoruz. ";
    const guidance =
      "6 zincir atlıyoruz (düğme iliği oluşturuyoruz. " +
      "Düğme iliği için çektiğimiz zincir sayısını, " +
      "kullanacağınız düğme boyutuna göre arttırıp ya da azaltabilirsiniz.)";
    const suffix = " Yedinci zincirden itibaren 28x örüyoruz.";

    const source = prefix + guidance + suffix;

    // Bisect the deterministic guidance inside the explanatory sentence.
    const boundary =
      source.indexOf("çektiğimiz zincir sayısını") + 10;

    const [result] = await translateBlocks(
      [
        {
          id: "page13-buttonhole-formatting-regression",
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

    expect(result?.translated).toContain(
      "Skip 6 chains (to form a buttonhole;",
    );
    expect(result?.translated).toContain(
      "you can increase or decrease the number of chains depending on the size of the button you will use).",
    );
    expect(result?.translated).toContain(
      "Starting from the seventh chain",
    );
    expect(result?.translated).toContain("28sc");

    expect(result?.translated).not.toContain(
      "we are making a buttonhole",
    );
    expect(result?.translated).not.toContain(
      "chains we make for the buttonhole",
    );

    // The guidance itself must not be exposed to the provider.
    const providerText = provider.protectedTexts.join(" ");
    expect(providerText).not.toMatch(/düğme\s+iliği\s+oluşturuyoruz/iu);
    expect(providerText).not.toMatch(/çektiğimiz\s+zincir\s+sayısını/iu);

    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });
});

describe("Page 13 exact-live long buttonhole deterministic ownership", () => {
  it("bypasses the provider completely for the exact live 'artırıp' guidance", async () => {
    const provider = new UnconditionalCorruptingProvider();

    const source =
      "6 zincir atlıyoruz (düğme iliği oluşturuyoruz. " +
      "Düğme iliği için çektiğimiz zincir sayısını, " +
      "kullanacağınız düğme boyutuna göre artırıp ya da azaltabilirsiniz.)";

    const [result] = await translateBlocks(
      [{ id: "page13-live-buttonhole-guidance", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "Skip 6 chains (to form a buttonhole; " +
      "you can increase or decrease the number of chains depending on the size of the button you will use).",
    );

    expect(provider.requests).toHaveLength(0);
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("keeps the exact live guidance away from the provider across Canva formatting boundaries", async () => {
    const provider = new InspectingProvider();

    const prefix = "1) 34 zincir çekip geriye dönüyoruz. ";
    const guidance =
      "6 zincir atlıyoruz (düğme iliği oluşturuyoruz. " +
      "Düğme iliği için çektiğimiz zincir sayısını, " +
      "kullanacağınız düğme boyutuna göre artırıp ya da azaltabilirsiniz.)";
    const suffix = " yedinci zincirden itibaren 28x";

    const source = prefix + guidance + suffix;

    const boundary =
      source.indexOf("çektiğimiz zincir sayısını") + 10;

    const [result] = await translateBlocks(
      [
        {
          id: "page13-live-row1-formatting",
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

    expect(result?.translated).toContain(
      "Skip 6 chains (to form a buttonhole;",
    );
    expect(result?.translated).toContain(
      "you can increase or decrease the number of chains depending on the size of the button you will use).",
    );
    expect(result?.translated).toContain("28sc");

    const providerText = provider.protectedTexts.join(" ");

    // Neither original Turkish nor already-normalized deterministic English
    // is allowed back through the provider.
    expect(providerText).not.toMatch(/düğme\s+iliği\s+oluşturuyoruz/iu);
    expect(providerText).not.toMatch(/çektiğimiz\s+zincir\s+sayısını/iu);
    expect(providerText).not.toContain("to form a buttonhole");
    expect(providerText).not.toContain(
      "you can increase or decrease the number of chains",
    );

    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("does not claim deterministic resolution for the same family in Spanish", async () => {
    const provider = new InspectingProvider();

    const source =
      "6 zincir atlıyoruz (düğme iliği oluşturuyoruz. " +
      "Düğme iliği için çektiğimiz zincir sayısını, " +
      "kullanacağınız düğme boyutuna göre artırıp ya da azaltabilirsiniz.)";

    await translateBlocks(
      [{ id: "page13-buttonhole-guidance-es", text: source }],
      "es",
      { provider },
    );

    expect(provider.requests.length).toBeGreaterThan(0);
  });
});

describe("mixed-span full-context regression", () => {
  it("gives the provider the complete mixed instruction as prose context", async () => {
    const provider = new InspectingProvider();

    const source =
      "İlk kolda 13x örüp kolun üzerine denk getirdim. " +
      "Diğer kolda 9x ördüğümde denk geldi. " +
      "Gerekirse 1-2 sık iğne eksik ya da fazla örün.";

    await translateBlocks(
      [{ id: "mixed-full-context", text: source }],
      "en",
      { provider },
    );

    expect(provider.requests).toHaveLength(1);

    const userPrompt = JSON.parse(
      provider.requests[0]?.userPrompt ?? "{}",
    ) as {
      proseContext?: string;
      spans?: Array<{ id: string; text: string }>;
    };

    expect(userPrompt.proseContext).toContain("13");
    expect(userPrompt.proseContext).toContain("9");
    expect(userPrompt.proseContext).toContain("1-2");

    expect(userPrompt.proseContext).toContain("İlk kolda");
    expect(userPrompt.proseContext).toContain("Diğer kolda");
    expect(userPrompt.proseContext).toContain("denk geldi");

    expect(userPrompt.spans?.length).toBeGreaterThan(1);
  });
});

describe("Page 15 edge-finishing regression", () => {
  it("keeps the edge-finishing sequence coherent through the full pipeline", async () => {
    const provider = new InspectingProvider();

    const source =
      "30) Görselde görüldüğü gibi dışa kıvırmak için ördüğümüz " +
      "kısmın çevresini simli ip ile 1 zincir, sıradaki sık iğneye cc, " +
      "yaparak dönüyoruz. Tüm çevreyi ördükten sonra 1 zincir çekip " +
      "ipimizi kesiyoruz.";

    const [result] = await translateBlocks(
      [{ id: "page15-edge-finishing", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain("30)");
    expect(result?.translated).toContain("1");
    expect(result?.translated).toContain("sl st");
    expect(result?.translated).toContain("cut the yarn");
  });
});

describe("Page 15 other-arm paragraph regression", () => {
  it("translates the complete other-arm alignment guidance deterministically", async () => {
    const provider = new InspectingProvider();

    const source =
      "♦ Diğer kolu da aynı şekilde örüyoruz. " +
      "(26. sırada ilk kolda 13x örüp kolun üzerine denk getirmiştim. " +
      "Diğer kolu örerken 9x ördüğümde kolun üzerine denk geldi. " +
      "Sizde kolun üzerine denk gelecek şekilde 1-2 sık iğne eksik ya da fazla örerek üst kısma gelin.)";

    const [result] = await translateBlocks(
      [{ id: "page15-other-arm", text: source }],
      "en",
      { provider },
    );

    expect(provider.requests).toHaveLength(0);
    expect(result?.translated).toBe(
      "♦ Work the other arm in the same way. " +
      "(In Round 26, on the first arm I worked 13sc to align with the top of the arm. " +
      "On the other arm, it aligned after 9sc. " +
      "Work 1-2 fewer or additional single crochet stitches as needed so that it aligns with the top of the arm.)",
    );

    expect(result?.translated).not.toMatch(/[çğıöşü]/iu);
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });
});

describe("Page 15 other-arm formatting regression", () => {
  it("keeps the other-arm alignment guidance deterministic across a Canva formatting split", async () => {
    const provider = new InspectingProvider();

    const source =
      "♦ Diğer kolu da aynı şekilde örüyoruz. " +
      "(26. sırada ilk kolda 13x örüp kolun üzerine denk getirmiştim. " +
      "Diğer kolu örerken 9x ördüğümde kolun üzerine denk geldi. " +
      "Sizde kolun üzerine denk gelecek şekilde 1-2 sık iğne eksik ya da fazla örerek üst kısma gelin.)";

    const boundary =
      source.indexOf("Sizde kolun üzerine denk gelecek şekilde") + 14;

    const [result] = await translateBlocks(
      [
        {
          id: "page15-other-arm-formatting",
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

    expect(result?.translated).toBe(
      "♦ Work the other arm in the same way. " +
      "(In Round 26, on the first arm I worked 13sc to align with the top of the arm. " +
      "On the other arm, it aligned after 9sc. " +
      "Work 1-2 fewer or additional single crochet stitches as needed so that it aligns with the top of the arm.)",
    );

    expect(provider.requests).toHaveLength(0);
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
    expect(result?.targetFormattingRegions).toBeDefined();
  });
});

describe("Page 15 other-arm marker/body formatting regression", () => {
  it("preserves the bullet/body formatting boundary for other-arm alignment guidance", async () => {
    const provider = new InspectingProvider();

    const source =
      "♦ Diğer kolu da aynı şekilde örüyoruz. " +
      "(26. sırada ilk kolda 13x örüp kolun üzerine denk getirmiştim. " +
      "Diğer kolu örerken 9x ördüğümde kolun üzerine denk geldi. " +
      "Sizde kolun üzerine denk gelecek şekilde 1-2 sık iğne eksik ya da fazla örerek üst kısma gelin.)";

    const bodyStart = source.indexOf("Diğer kolu");

    const [result] = await translateBlocks(
      [
        {
          id: "page15-other-arm-bullet-body-formatting",
          text: source,
          formattingRegions: [
            { id: "fmt-bullet", start: 0, end: bodyStart },
            { id: "fmt-body", start: bodyStart, end: source.length },
          ],
        },
      ],
      "en",
      { provider },
    );

    const translated = result?.translated ?? "";
    const translatedBodyStart = translated.indexOf("Work the other arm");

    expect(translatedBodyStart).toBeGreaterThan(0);
    expect(result?.targetFormattingRegions).toEqual([
      { id: "fmt-bullet", start: 0, end: translatedBodyStart },
      { id: "fmt-body", start: translatedBodyStart, end: translated.length },
    ]);

    expect(result?.formattingProjection).not.toBe("atomic_collapse");
    expect(provider.requests).toHaveLength(0);
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });
});

describe("Page 15 live other-arm marker regression", () => {
  it("preserves the live ✦ marker and body formatting while translating other-arm guidance deterministically", async () => {
    const provider = new InspectingProvider();

    const source =
      "✦ Diğer kolu da aynı şekilde örüyoruz. " +
      "(26. sırada ilk kolda 13x örüp kolun üzerine denk getirmiştim. " +
      "Diğer kolu örerken 9x ördüğümde kolun üzerine denk geldi. " +
      "Sizde kolun üzerine denk gelecek şekilde 1-2 sık iğne eksik ya da fazla örerek üst kısma gelin.)";

    const bodyStart = source.indexOf("Diğer kolu");

    const [result] = await translateBlocks(
      [
        {
          id: "page15-live-other-arm",
          text: source,
          formattingRegions: [
            { id: "fmt-marker", start: 0, end: bodyStart },
            { id: "fmt-body", start: bodyStart, end: source.length },
          ],
        },
      ],
      "en",
      { provider },
    );

    const translated = result?.translated ?? "";
    const translatedBodyStart = translated.indexOf("Work the other arm");

    expect(translated).toBe(
      "✦ Work the other arm in the same way. " +
      "(In Round 26, on the first arm I worked 13sc to align with the top of the arm. " +
      "On the other arm, it aligned after 9sc. " +
      "Work 1-2 fewer or additional single crochet stitches as needed so that it aligns with the top of the arm.)",
    );

    expect(result?.targetFormattingRegions).toEqual([
      { id: "fmt-marker", start: 0, end: translatedBodyStart },
      { id: "fmt-body", start: translatedBodyStart, end: translated.length },
    ]);

    expect(result?.formattingProjection).not.toBe("atomic_collapse");
    expect(provider.requests).toHaveLength(0);
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });
});

describe("Page 15 collar turning-row regression", () => {
  it("preserves both turning instructions and uses row terminology through the full pipeline", async () => {
    const provider = new InspectingProvider();

    const source =
      "1) 28x örüyoruz, 1 zincir çekip dönüyoruz. " +
      "Bütün sıra sonlarında 1 zincir çekip dönüyoruz.";

    const [result] = await translateBlocks(
      [{ id: "page15-collar-turning-row", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "1) Work 28sc, Ch 1 and turn. At the end of each row, ch 1 and turn.",
    );

    expect(result?.translated).not.toContain("Bütün");
    expect(result?.translated).not.toContain("each round");
    expect(result?.translated).toContain("Ch 1 and turn.");
    expect(result?.translated).toContain(
      "At the end of each row, ch 1 and turn.",
    );

    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });
});


describe("Page 15 collar repeated-row count regression", () => {
  it("keeps the later 3-7 count in row terminology after explicit repeated turning", async () => {
    const provider = new InspectingProvider();

    const source =
      "1) 28x örüyoruz, 1 zincir çekip dönüyoruz. " +
      "Bütün sıra sonlarında 1 zincir çekip dönüyoruz.\n" +
      "♦ Yakanın ilk parçasını öreceğiz,\n" +
      "2) (1x, 1v)*5, 1sc = 16x\n" +
      "3-7) 5 sıra 16x, 1 zincir çekip ipimizi kesiyoruz.";

    const [result] = await translateBlocks(
      [{ id: "page15-collar-repeated-rows", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "At the end of each row, ch 1 and turn.",
    );
    expect(result?.translated).toContain(
      "16sc for 5 rows, ch 1 and cut the yarn.",
    );
    expect(result?.translated).not.toContain("16sc for 5 rounds");

    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });
  it("keeps the later collar count in row terminology when Canva formatting isolates that instruction", async () => {
    const provider = new InspectingProvider();

    const source =
      "1) 28x örüyoruz, 1 zincir çekip dönüyoruz. " +
      "Bütün sıra sonlarında 1 zincir çekip dönüyoruz.\n" +
      "♦ Yakanın ilk parçasını öreceğiz,\n" +
      "2) (1x, 1v)*5, 1sc = 16x\n" +
      "3-7) 5 sıra 16x, 1 zincir çekip ipimizi kesiyoruz.";

    const countLineStart = source.indexOf("3-7)");

    const [result] = await translateBlocks(
      [
        {
          id: "page15-collar-repeated-rows-formatting",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: 0, end: countLineStart },
            { id: "fmt-1", start: countLineStart, end: source.length },
          ],
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "16sc for 5 rows, ch 1 and cut the yarn.",
    );
    expect(result?.translated).not.toContain("16sc for 5 rounds");

    expect(result?.errors.map(({ code }) => code)).not.toContain(
      "NUMBER_MISMATCH",
    );
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);

    expect(result?.targetFormattingRegions).toBeDefined();
  });

  it("does not inherit turning-row context across a numbering reset into a new section", async () => {
    const provider = new InspectingProvider();

    const source =
      "1) 28x örüyoruz, 1 zincir çekip dönüyoruz. " +
      "Bütün sıra sonlarında 1 zincir çekip dönüyoruz.\n" +
      "♦ Yeni bölüm\n" +
      "1) 5 sıra 16x, 1 zincir çekip ipimizi kesiyoruz.";

    const [result] = await translateBlocks(
      [{ id: "row-context-numbering-reset", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "16sc for 5 rounds, ch 1 and cut the yarn.",
    );
    expect(result?.translated).not.toContain("16sc for 5 rows");
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

});

describe("Page 14 sleeve deterministic ownership", () => {
  it("bypasses the provider for the complete sleeve setup instruction", async () => {
    const provider = new UnconditionalCorruptingProvider();

    const source =
      "1) Görselde görüldüğü gibi kol boşluğunun arka tarafından ipimizi sabitliyoruz. " +
      "20x örüyoruz. Başlangıç noktamız burası olacak, işaretleyiciyi buraya takıyoruz.";

    const [result] = await translateBlocks(
      [{ id: "page14-sleeve-setup", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "attach the yarn from the back of the armhole",
    );
    expect(result?.translated).toContain("Work 20sc");
    expect(result?.translated).toContain(
      "place a stitch marker here",
    );
    expect(provider.requests).toHaveLength(0);
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("bypasses the provider for the complete sleeve shaping instruction", async () => {
    const provider = new UnconditionalCorruptingProvider();

    const source =
      "26) 13x örüyoruz (kolun üzerindeki dışa doğru kıvırdığımız kısmı öreceğiz). " +
      "Görselde görüldüğü gibi ben 13x ördüğümde tam kolun üzerine denk geldi. " +
      "Sizde kolun üst kısmına denk gelecek şekilde 1-2 sık iğne eksik ya da fazla örebilirsiniz. " +
      "1 zincir çekip dönüyoruz.";

    const [result] = await translateBlocks(
      [{ id: "page14-sleeve-shaping", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "26) Work 13sc (we will crochet the section folded outward over the arm). " +
      "As shown in the image, when I worked 13sc, it aligned exactly over the arm. " +
      "You can work 1-2 fewer or additional single crochet stitches so that it aligns with the top of the arm. " +
      "Ch 1 and turn.",
    );

    expect(provider.requests).toHaveLength(0);
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("keeps sleeve shaping deterministic across a Canva formatting split", async () => {
    const provider = new InspectingProvider();

    const source =
      "26) 13x örüyoruz (kolun üzerindeki dışa doğru kıvırdığımız kısmı öreceğiz). " +
      "Görselde görüldüğü gibi ben 13x ördüğümde tam kolun üzerine denk geldi. " +
      "Sizde kolun üst kısmına denk gelecek şekilde 1-2 sık iğne eksik ya da fazla örebilirsiniz. " +
      "1 zincir çekip dönüyoruz.";

    const boundary =
      source.indexOf("Sizde kolun üst kısmına") + 12;

    const [result] = await translateBlocks(
      [
        {
          id: "page14-sleeve-shaping-formatting",
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

    expect(result?.translated).toContain(
      "when I worked 13sc",
    );
    expect(result?.translated).toContain(
      "work 1-2 fewer or additional single crochet stitches",
    );
    expect(result?.translated).toContain("Ch 1 and turn.");
    expect(provider.protectedTexts.join(" ")).not.toContain(
      "kolun üzerindeki",
    );
    expect(provider.protectedTexts.join(" ")).not.toContain(
      "when I worked 13sc",
    );
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("keeps the sleeve shaping family on the provider path for Spanish", async () => {
    const provider = new InspectingProvider();

    const source =
      "26) 13x örüyoruz (kolun üzerindeki dışa doğru kıvırdığımız kısmı öreceğiz). " +
      "Görselde görüldüğü gibi ben 13x ördüğümde tam kolun üzerine denk geldi. " +
      "Sizde kolun üst kısmına denk gelecek şekilde 1-2 sık iğne eksik ya da fazla örebilirsiniz. " +
      "1 zincir çekip dönüyoruz.";

    await translateBlocks(
      [{ id: "page14-sleeve-shaping-es", text: source }],
      "es",
      { provider },
    );

    expect(provider.requests.length).toBeGreaterThan(0);
  });
});

describe("Page 14 exact saved blocks", () => {
  it("translates the complete saved Block 2 deterministically without provider exposure", async () => {
    const provider = new UnconditionalCorruptingProvider();

    const source =
      "2-25) 24 sıra 20x\n" +
      "26) 13x örüyoruz (kolun üzerindeki dışa doğru kıvırdığımız kısmı öreceğiz). " +
      "Görselde görüldüğü gibi ben 13x ördüğümde tam kolun üzerine denk geldi. " +
      "Sizde kolun üst kısmına denk gelecek şekilde 1-2 sık iğne eksik ya da fazla örebilirsiniz. " +
      "1 zincir çekip dönüyoruz.\n" +
      "2) Bu sırayı Blo’dan örüyoruz. 2x, 1v, (4x,1v)*3, 2x = 24x, 1 zincir, dön,\n" +
      "3) 24x, 1 zincir, dön,\n" +
      "4) 24x, 1 zincir çekip ipimizi kesiyoruz.";

    const [result] = await translateBlocks(
      [{ id: "page14-exact-block-2", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "2-25) 20sc for 24 rounds",
    );

    expect(result?.translated).toContain(
      "26) Work 13sc (we will crochet the section folded outward over the arm).",
    );

    expect(result?.translated).toContain(
      "As shown in the image, when I worked 13sc, it aligned exactly over the arm.",
    );

    expect(result?.translated).toContain(
      "You can work 1-2 fewer or additional single crochet stitches so that it aligns with the top of the arm.",
    );

    expect(result?.translated).toContain("Ch 1 and turn.");

    expect(result?.translated).toContain(
      "2) Work in BLO. 2sc, 1inc, (4sc,1inc)*3, 2sc = 24sc, Ch 1 and turn,",
    );

    expect(result?.translated).toContain(
      "3) 24sc, Ch 1 and turn,",
    );

    expect(result?.translated).toContain(
      "4) 24sc. Ch 1 and cut the yarn.",
    );

    expect(provider.requests).toHaveLength(0);
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("preserves representative multi-style formatting across the complete saved Block 2", async () => {
    const provider = new UnconditionalCorruptingProvider();

    const source =
      "2-25) 24 sıra 20x\n" +
      "26) 13x örüyoruz (kolun üzerindeki dışa doğru kıvırdığımız kısmı öreceğiz). " +
      "Görselde görüldüğü gibi ben 13x ördüğümde tam kolun üzerine denk geldi. " +
      "Sizde kolun üst kısmına denk gelecek şekilde 1-2 sık iğne eksik ya da fazla örebilirsiniz. " +
      "1 zincir çekip dönüyoruz.\n" +
      "2) Bu sırayı Blo’dan örüyoruz. 2x, 1v, (4x,1v)*3, 2x = 24x, 1 zincir, dön,\n" +
      "3) 24x, 1 zincir, dön,\n" +
      "4) 24x, 1 zincir çekip ipimizi kesiyoruz.";

    const row26Start = source.indexOf("26)");
    const row26ImageStart = source.indexOf("Görselde görüldüğü gibi ben");
    const row26AdjustmentStart = source.indexOf("Sizde kolun üst");
    const row26TurnStart = source.indexOf("1 zincir çekip dönüyoruz.");

    const bloRowStart = source.indexOf("2) Bu sırayı");
    const bloStitchStart = source.indexOf("2x, 1v", bloRowStart);
    const bloTurnStart = source.indexOf("1 zincir, dön,", bloRowStart);

    const row3Start = source.indexOf("3) 24x");
    const row3TurnStart = source.indexOf("1 zincir, dön,", row3Start);

    const row4Start = source.indexOf("4) 24x");
    const row4CutStart = source.indexOf("1 zincir çekip", row4Start);

    const formattingRegions = [
      { id: "fmt-0", start: 0, end: row26Start },
      { id: "fmt-1", start: row26Start, end: row26ImageStart },
      {
        id: "fmt-2",
        start: row26ImageStart,
        end: row26AdjustmentStart,
      },
      {
        id: "fmt-3",
        start: row26AdjustmentStart,
        end: row26TurnStart,
      },
      { id: "fmt-4", start: row26TurnStart, end: bloRowStart },
      { id: "fmt-5", start: bloRowStart, end: bloStitchStart },
      { id: "fmt-6", start: bloStitchStart, end: bloTurnStart },
      { id: "fmt-7", start: bloTurnStart, end: row3Start },
      { id: "fmt-8", start: row3Start, end: row3TurnStart },
      { id: "fmt-9", start: row3TurnStart, end: row4Start },
      { id: "fmt-10", start: row4Start, end: row4CutStart },
      { id: "fmt-11", start: row4CutStart, end: source.length },
    ];

    const [result] = await translateBlocks(
      [
        {
          id: "page14-exact-block-2-multi-style",
          text: source,
          formattingRegions,
        },
      ],
      "en",
      { provider },
    );

    const translated = result?.translated ?? "";
    const regions = result?.targetFormattingRegions ?? [];

    expect(translated).toBe(
      "2-25) 20sc for 24 rounds\n" +
        "26) Work 13sc (we will crochet the section folded outward over the arm). " +
        "As shown in the image, when I worked 13sc, it aligned exactly over the arm. " +
        "You can work 1-2 fewer or additional single crochet stitches so that it aligns with the top of the arm. " +
        "Ch 1 and turn.\n" +
        "2) Work in BLO. 2sc, 1inc, (4sc,1inc)*3, 2sc = 24sc, Ch 1 and turn,\n" +
        "3) 24sc, Ch 1 and turn,\n" +
        "4) 24sc. Ch 1 and cut the yarn.",
    );

    expect(provider.requests).toHaveLength(0);
    expect(result?.formattingProjection).not.toBe("atomic_collapse");
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);

    expect(new Set(regions.map(({ id }) => id))).toEqual(
      new Set(formattingRegions.map(({ id }) => id)),
    );

    expect(
      regions.some(({ start, end }) => start === end),
    ).toBe(false);

    expect(regions[0]?.start).toBe(0);
    expect(regions.at(-1)?.end).toBe(translated.length);

    for (let index = 1; index < regions.length; index++) {
      expect(regions[index]?.start).toBe(regions[index - 1]?.end);
    }

    const ownerAt = (needle: string) => {
      const offset = translated.indexOf(needle);

      return regions.find(
        ({ start, end }) => start <= offset && offset < end,
      )?.id;
    };

    expect(ownerAt("20sc for 24 rounds")).toBe("fmt-0");
    expect(ownerAt("Work 13sc")).toBe("fmt-1");
    expect(ownerAt("when I worked 13sc")).toBe("fmt-2");
    expect(ownerAt("1-2 fewer or additional")).toBe("fmt-3");
    expect(ownerAt("Ch 1 and turn.\n2)")).toBe("fmt-4");
    expect(ownerAt("Work in BLO")).toBe("fmt-5");
    expect(ownerAt("2sc, 1inc")).toBe("fmt-6");

    const bloTurnOffset = translated.indexOf(
      "Ch 1 and turn,",
      translated.indexOf("Work in BLO"),
    );
    expect(
      regions.find(
        ({ start, end }) =>
          start <= bloTurnOffset && bloTurnOffset < end,
      )?.id,
    ).toBe("fmt-7");

    expect(ownerAt("3) 24sc")).toBe("fmt-8");

    const row3TurnOffset = translated.indexOf(
      "Ch 1 and turn,",
      translated.indexOf("3) 24sc"),
    );
    expect(
      regions.find(
        ({ start, end }) =>
          start <= row3TurnOffset && row3TurnOffset < end,
      )?.id,
    ).toBe("fmt-9");

    expect(ownerAt("4) 24sc")).toBe("fmt-10");
    expect(ownerAt("Ch 1 and cut the yarn")).toBe("fmt-11");
  });

  it("preserves every critical instruction in the exact saved Block 1 row", async () => {
    const provider = new InspectingProvider();

    const source =
      "1) Görselde görüldüğü gibi kol boşluğunun arka tarafından ipimizi sabitliyoruz. " +
      "20x örüyoruz. Başlangıç noktamız burası olacak, işaretleyiciyi buraya takıyoruz.";

    const [result] = await translateBlocks(
      [{ id: "page14-exact-block-1-row", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "1) As shown in the image, attach the yarn from the back of the armhole. " +
      "Work 20sc. This will be the beginning of the round; place a stitch marker here.",
    );

    expect(provider.requests).toHaveLength(0);
    expect(result?.translated).toContain("back of the armhole");
    expect(result?.translated).toContain("20sc");
    expect(result?.translated).toContain("stitch marker");
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("keeps all Page 14 deterministic instructions away from the provider across formatting splits", async () => {
    const provider = new InspectingProvider();

    const source =
      "26) 13x örüyoruz (kolun üzerindeki dışa doğru kıvırdığımız kısmı öreceğiz). " +
      "Görselde görüldüğü gibi ben 13x ördüğümde tam kolun üzerine denk geldi. " +
      "Sizde kolun üst kısmına denk gelecek şekilde 1-2 sık iğne eksik ya da fazla örebilirsiniz. " +
      "1 zincir çekip dönüyoruz.";

    const boundaryA = source.indexOf("Görselde görüldüğü gibi") + 9;
    const boundaryB = source.indexOf("1-2 sık iğne") + 4;

    const [result] = await translateBlocks(
      [
        {
          id: "page14-row26-multi-format",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: 0, end: boundaryA },
            { id: "fmt-1", start: boundaryA, end: boundaryB },
            { id: "fmt-2", start: boundaryB, end: source.length },
          ],
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toContain("when I worked 13sc");
    expect(result?.translated).toContain(
      "1-2 fewer or additional single crochet stitches",
    );
    expect(result?.translated).toContain("Ch 1 and turn.");

    const providerText = provider.protectedTexts.join(" ");

    expect(providerText).not.toContain("kolun üzerindeki");
    expect(providerText).not.toContain("Görselde görüldüğü gibi ben");
    expect(providerText).not.toContain("when I worked 13sc");
    expect(providerText).not.toContain(
      "1-2 fewer or additional single crochet stitches",
    );
    expect(providerText).not.toContain("Ch 1 and turn");

    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });
});

describe("Page 14 exact saved Block 1 including heading", () => {
  it("keeps the sleeve instruction deterministic while allowing only the heading prose onto the provider path", async () => {
    const provider = new InspectingProvider();

    const source =
      "Bluz kolu;\n" +
      "1) Görselde görüldüğü gibi kol boşluğunun arka tarafından ipimizi sabitliyoruz. " +
      "20x örüyoruz. Başlangıç noktamız burası olacak, işaretleyiciyi buraya takıyoruz.";

    const [result] = await translateBlocks(
      [{ id: "page14-exact-block-1", text: source }],
      "en",
      { provider },
    );

    expect(result?.translated).toContain(
      "1) As shown in the image, attach the yarn from the back of the armhole.",
    );
    expect(result?.translated).toContain("Work 20sc.");
    expect(result?.translated).toContain(
      "This will be the beginning of the round; place a stitch marker here.",
    );

    const providerText = provider.protectedTexts.join(" ");

    expect(providerText).not.toContain("kol boşluğunun");
    expect(providerText).not.toContain("20x örüyoruz");
    expect(providerText).not.toContain("Başlangıç noktamız");

    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });
});

describe("live Page 14 Block 1 formatting regression", () => {
  it("preserves the real Canva heading, newline, marker, and body formatting boundaries", async () => {
    const provider = new InspectingProvider();

    const source =
      "Bluz kolu;\n" +
      "1) Görselde görüldüğü gibi kol boşluğunun arka tarafından ipimizi sabitliyoruz. " +
      "20x örüyoruz. Başlangıç noktamız burası olacak, işaretleyiciyi buraya takıyoruz.";

    expect(source.length).toBe(171);
    expect(source.slice(0, 10)).toBe("Bluz kolu;");
    expect(source.slice(10, 11)).toBe("\n");
    expect(source.slice(11, 14)).toBe("1) ");

    const [result] = await translateBlocks(
      [
        {
          id: "page14-live-block-1-formatting",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: 0, end: 10 },
            { id: "fmt-1", start: 10, end: 11 },
            { id: "fmt-2", start: 11, end: 14 },
            { id: "fmt-3", start: 14, end: 171 },
          ],
        },
      ],
      "en",
      { provider },
    );

    const translated = result?.translated ?? "";

    expect(translated).toBe(
      "Bluz kolu;\n" +
        "1) As shown in the image, attach the yarn from the back of the armhole. " +
        "Work 20sc. This will be the beginning of the round; place a stitch marker here.",
    );

    expect(result?.targetFormattingRegions).toEqual([
      { id: "fmt-0", start: 0, end: 10 },
      { id: "fmt-1", start: 10, end: 11 },
      { id: "fmt-2", start: 11, end: 14 },
      { id: "fmt-3", start: 14, end: translated.length },
    ]);

    expect(result?.formattingProjection).not.toBe("atomic_collapse");
    expect(provider.protectedTexts).toContain("Bluz kolu;");
    expect(provider.protectedTexts.join(" ")).not.toContain("kol boşluğunun");
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });
});

describe("semantic formatting projection across atomic reordering", () => {
  it("projects atomic source styles onto reordered target semantic pieces instead of collapsing to the left style", async () => {
    const provider = new UnconditionalCorruptingProvider();

    const source = "2-11) 10 sıra 64x";
    const markerEnd = source.indexOf("10 sıra");
    const stitchStart = source.indexOf("64x");

    const [result] = await translateBlocks(
      [
        {
          id: "semantic-style-reorder",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: 0, end: markerEnd },
            { id: "fmt-1", start: markerEnd, end: stitchStart },
            { id: "fmt-2", start: stitchStart, end: source.length },
          ],
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toBe("2-11) 64sc for 10 rounds");
    expect(provider.requests).toHaveLength(0);

    const translated = result?.translated ?? "";
    const stitchTargetStart = translated.indexOf("64sc");
    const stitchTargetEnd = stitchTargetStart + "64sc".length;
    const roundTargetStart = stitchTargetEnd;

    expect(result?.targetFormattingRegions).toEqual([
      {
        id: "fmt-0",
        start: 0,
        end: stitchTargetStart,
      },
      {
        id: "fmt-2",
        start: stitchTargetStart,
        end: stitchTargetEnd,
      },
      {
        id: "fmt-1",
        start: roundTargetStart,
        end: translated.length,
      },
    ]);

    expect(result?.formattingProjection).not.toBe("atomic_collapse");
    expect(result?.valid).toBe(true);
    expect(result?.errors).toEqual([]);
  });
});

describe("mixed zero-width provenance safety", () => {
  it("does not let a later atomic collapse legitimize an empty ordinary translation unit", async () => {
    const provider = new EmptyTranslationProvider();

    const prose = "Bu açıklama çevrilsin.";
    const round = "2-11) 10 sıra 64x";
    const collapse = "4) 24x, 1 zincir çekip ipimizi kesiyoruz.";
    const source = `${prose}\n${round}\n${collapse}`;

    const proseEnd = prose.length;
    const roundStart = proseEnd + 1;
    const roundStitchStart = source.indexOf("64x", roundStart);
    const roundEnd = roundStart + round.length;
    const collapseStart = roundEnd + 1;
    const collapseSplit = source.indexOf("24x", collapseStart) + 2;

    const [result] = await translateBlocks(
      [
        {
          id: "mixed-empty-prose-semantic-and-collapse",
          text: source,
          formattingRegions: [
            { id: "fmt-prose", start: 0, end: proseEnd },
            { id: "fmt-gap-1", start: proseEnd, end: roundStart },
            {
              id: "fmt-round-a",
              start: roundStart,
              end: roundStitchStart,
            },
            {
              id: "fmt-round-b",
              start: roundStitchStart,
              end: roundEnd,
            },
            { id: "fmt-gap-2", start: roundEnd, end: collapseStart },
            {
              id: "fmt-collapse-a",
              start: collapseStart,
              end: collapseSplit,
            },
            {
              id: "fmt-collapse-b",
              start: collapseSplit,
              end: source.length,
            },
          ],
        },
      ],
      "en",
      { provider },
    );

    expect(provider.requests.length).toBeGreaterThan(0);

    expect(result?.translated).toContain(
      "2-11) 64sc for 10 rounds",
    );
    expect(result?.translated).toContain(
      "4) 24sc. Ch 1 and cut the yarn.",
    );

    expect(result?.valid).toBe(false);
    expect(result?.errors).toContainEqual(
      expect.objectContaining({ code: "EMPTY_TRANSLATION" }),
    );

    // A zero-width ordinary prose region is not an absorbed legacy style.
    // A later atomic-collapse elsewhere in the block must not make this
    // projection structurally complete.
    expect(result?.targetFormattingRegions).toBeUndefined();
  });
});

describe("mixed semantic and atomic-collapse formatting projection", () => {
  it("combines semantic target-order runs with a later legacy collapse in one block", async () => {
    const provider = new UnconditionalCorruptingProvider();

    const firstLine = "2-11) 10 sıra 64x";
    const secondLine = "4) 24x, 1 zincir çekip ipimizi kesiyoruz.";
    const source = `${firstLine}\n${secondLine}`;

    const markerEnd = source.indexOf("10 sıra");
    const stitchStart = source.indexOf("64x");
    const secondLineStart = source.indexOf(secondLine);
    const splitInsideSecondStitch =
      source.indexOf("24x", secondLineStart) + 2;

    const [result] = await translateBlocks(
      [
        {
          id: "mixed-semantic-and-collapse-formatting",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: 0, end: markerEnd },
            { id: "fmt-1", start: markerEnd, end: stitchStart },
            {
              id: "fmt-2",
              start: stitchStart,
              end: secondLineStart,
            },
            {
              id: "fmt-3",
              start: secondLineStart,
              end: splitInsideSecondStitch,
            },
            {
              id: "fmt-4",
              start: splitInsideSecondStitch,
              end: source.length,
            },
          ],
        },
      ],
      "en",
      { provider },
    );

    const translated = result?.translated ?? "";
    const expectedFirstLine = "2-11) 64sc for 10 rounds";
    const expectedSecondLine = "4) 24sc. Ch 1 and cut the yarn.";
    const expected = `${expectedFirstLine}\n${expectedSecondLine}`;

    expect(translated).toBe(expected);
    expect(result?.formattingProjection).toBe("atomic_collapse");
    expect(provider.requests).toHaveLength(0);
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);

    const regions = result?.targetFormattingRegions ?? [];

    const stitchTargetStart = translated.indexOf("64sc");
    const stitchTargetEnd = stitchTargetStart + "64sc".length;
    const secondTargetStart = translated.indexOf(expectedSecondLine);

    expect(regions.slice(0, 4)).toEqual([
      {
        id: "fmt-0",
        start: 0,
        end: stitchTargetStart,
      },
      {
        id: "fmt-2",
        start: stitchTargetStart,
        end: stitchTargetEnd,
      },
      {
        id: "fmt-1",
        start: stitchTargetEnd,
        end: expectedFirstLine.length,
      },
      {
        id: "fmt-2",
        start: expectedFirstLine.length,
        end: secondTargetStart,
      },
    ]);

    expect(regions.slice(-2)).toEqual([
      {
        id: "fmt-3",
        start: secondTargetStart,
        end: translated.length,
      },
      {
        id: "fmt-4",
        start: translated.length,
        end: translated.length,
      },
    ]);

    const positiveWidth = regions.filter(({ start, end }) => start < end);

    expect(positiveWidth[0]?.start).toBe(0);
    expect(positiveWidth.at(-1)?.end).toBe(translated.length);

    for (let index = 1; index < positiveWidth.length; index++) {
      expect(positiveWidth[index]?.start).toBe(
        positiveWidth[index - 1]?.end,
      );
    }

    expect(new Set(regions.map(({ id }) => id))).toEqual(
      new Set(["fmt-0", "fmt-1", "fmt-2", "fmt-3", "fmt-4"]),
    );

    expect(result?.absorbedFormattingRegionIds).toEqual(["fmt-4"]);

    expect(
      regions
        .filter(({ start, end }) => start === end)
        .map(({ id }) => id),
    ).toEqual(result?.absorbedFormattingRegionIds);
  });
});

describe("Page 14 semantic formatting projection", () => {
  it("preserves separate styles across the complete sleeve setup instruction", async () => {
    const provider = new UnconditionalCorruptingProvider();

    const source =
      "1) Görselde görüldüğü gibi kol boşluğunun arka tarafından ipimizi sabitliyoruz. " +
      "20x örüyoruz. Başlangıç noktamız burası olacak, işaretleyiciyi buraya takıyoruz.";

    const stitchStart = source.indexOf("20x");
    const markerStart = source.indexOf("Başlangıç noktamız");

    const [result] = await translateBlocks(
      [
        {
          id: "page14-sleeve-setup-semantic-formatting",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: 0, end: stitchStart },
            { id: "fmt-1", start: stitchStart, end: markerStart },
            { id: "fmt-2", start: markerStart, end: source.length },
          ],
        },
      ],
      "en",
      { provider },
    );

    const translated = result?.translated ?? "";

    expect(translated).toBe(
      "1) As shown in the image, attach the yarn from the back of the armhole. " +
        "Work 20sc. This will be the beginning of the round; place a stitch marker here.",
    );

    const translatedStitchStart = translated.indexOf("Work 20sc.");
    const translatedMarkerStart = translated.indexOf(
      "This will be the beginning of the round;",
    );

    expect(result?.targetFormattingRegions).toEqual([
      {
        id: "fmt-0",
        start: 0,
        end: translatedStitchStart,
      },
      {
        id: "fmt-1",
        start: translatedStitchStart,
        end: translatedMarkerStart,
      },
      {
        id: "fmt-2",
        start: translatedMarkerStart,
        end: translated.length,
      },
    ]);

    expect(result?.formattingProjection).not.toBe("atomic_collapse");
    expect(provider.requests).toHaveLength(0);
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("preserves sentence-level styles across the complete sleeve shaping instruction", async () => {
    const provider = new UnconditionalCorruptingProvider();

    const source =
      "26) 13x örüyoruz (kolun üzerindeki dışa doğru kıvırdığımız kısmı öreceğiz). " +
      "Görselde görüldüğü gibi ben 13x ördüğümde tam kolun üzerine denk geldi. " +
      "Sizde kolun üst kısmına denk gelecek şekilde 1-2 sık iğne eksik ya da fazla örebilirsiniz. " +
      "1 zincir çekip dönüyoruz.";

    const imageSentenceStart = source.indexOf("Görselde görüldüğü gibi");
    const adjustmentSentenceStart = source.indexOf(
      "Sizde kolun üst kısmına",
    );
    const turnSentenceStart = source.indexOf("1 zincir çekip dönüyoruz");

    const [result] = await translateBlocks(
      [
        {
          id: "page14-sleeve-shaping-semantic-formatting",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: 0, end: imageSentenceStart },
            {
              id: "fmt-1",
              start: imageSentenceStart,
              end: adjustmentSentenceStart,
            },
            {
              id: "fmt-2",
              start: adjustmentSentenceStart,
              end: turnSentenceStart,
            },
            {
              id: "fmt-3",
              start: turnSentenceStart,
              end: source.length,
            },
          ],
        },
      ],
      "en",
      { provider },
    );

    const translated = result?.translated ?? "";

    expect(translated).toBe(
      "26) Work 13sc (we will crochet the section folded outward over the arm). " +
        "As shown in the image, when I worked 13sc, it aligned exactly over the arm. " +
        "You can work 1-2 fewer or additional single crochet stitches so that it aligns with the top of the arm. " +
        "Ch 1 and turn.",
    );

    const translatedImageStart = translated.indexOf(
      "As shown in the image",
    );
    const translatedAdjustmentStart = translated.indexOf(
      "You can work 1-2",
    );
    const translatedTurnStart = translated.indexOf("Ch 1 and turn.");

    expect(result?.targetFormattingRegions).toEqual([
      {
        id: "fmt-0",
        start: 0,
        end: translatedImageStart,
      },
      {
        id: "fmt-1",
        start: translatedImageStart,
        end: translatedAdjustmentStart,
      },
      {
        id: "fmt-2",
        start: translatedAdjustmentStart,
        end: translatedTurnStart,
      },
      {
        id: "fmt-3",
        start: translatedTurnStart,
        end: translated.length,
      },
    ]);

    expect(result?.formattingProjection).not.toBe("atomic_collapse");
    expect(provider.requests).toHaveLength(0);
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });
});

describe("Page 14 compact-row semantic formatting projection", () => {
  it("preserves BLO prose, stitch sequence, and turn-action styles separately", async () => {
    const provider = new UnconditionalCorruptingProvider();

    const source =
      "2) Bu sırayı Blo’dan örüyoruz. 2x, 1v, (4x,1v)*3, 2x = 24x, 1 zincir, dön,";

    const stitchStart = source.indexOf("2x, 1v");
    const turnStart = source.indexOf("1 zincir");

    const [result] = await translateBlocks(
      [
        {
          id: "page14-blo-row-semantic-formatting",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: 0, end: stitchStart },
            { id: "fmt-1", start: stitchStart, end: turnStart },
            { id: "fmt-2", start: turnStart, end: source.length },
          ],
        },
      ],
      "en",
      { provider },
    );

    const translated = result?.translated ?? "";

    expect(translated).toBe(
      "2) Work in BLO. 2sc, 1inc, (4sc,1inc)*3, 2sc = 24sc, Ch 1 and turn,",
    );

    const translatedStitchStart = translated.indexOf("2sc, 1inc");
    const translatedTurnStart = translated.indexOf("Ch 1 and turn");

    expect(result?.targetFormattingRegions).toEqual([
      {
        id: "fmt-0",
        start: 0,
        end: translatedStitchStart,
      },
      {
        id: "fmt-1",
        start: translatedStitchStart,
        end: translatedTurnStart,
      },
      {
        id: "fmt-2",
        start: translatedTurnStart,
        end: translated.length,
      },
    ]);

    expect(result?.formattingProjection).not.toBe("atomic_collapse");
    expect(provider.requests).toHaveLength(0);
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("preserves stitch and finishing-action styles when chain-and-cut becomes a new target sentence", async () => {
    const provider = new UnconditionalCorruptingProvider();

    const source = "4) 24x, 1 zincir çekip ipimizi kesiyoruz.";
    const finishingStart = source.indexOf("1 zincir");

    const [result] = await translateBlocks(
      [
        {
          id: "page14-cut-row-semantic-formatting",
          text: source,
          formattingRegions: [
            { id: "fmt-0", start: 0, end: finishingStart },
            {
              id: "fmt-1",
              start: finishingStart,
              end: source.length,
            },
          ],
        },
      ],
      "en",
      { provider },
    );

    const translated = result?.translated ?? "";

    expect(translated).toBe(
      "4) 24sc. Ch 1 and cut the yarn.",
    );

    const translatedFinishingStart = translated.indexOf("Ch 1");

    expect(result?.targetFormattingRegions).toEqual([
      {
        id: "fmt-0",
        start: 0,
        end: translatedFinishingStart,
      },
      {
        id: "fmt-1",
        start: translatedFinishingStart,
        end: translated.length,
      },
    ]);

    expect(result?.formattingProjection).not.toBe("atomic_collapse");
    expect(provider.requests).toHaveLength(0);
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

  it("falls back to atomic_collapse when a formatting boundary splits the compact stitch sequence", async () => {
    const provider = new UnconditionalCorruptingProvider();

    const source =
      "2) Bu sırayı Blo’dan örüyoruz. 2x, 1v, (4x,1v)*3, 2x = 24x, 1 zincir, dön,";

    const splitInsideStitchSequence = source.indexOf("(4x,1v)");

    const [result] = await translateBlocks(
      [
        {
          id: "page14-blo-row-split-stitch-fallback",
          text: source,
          formattingRegions: [
            {
              id: "fmt-0",
              start: 0,
              end: splitInsideStitchSequence,
            },
            {
              id: "fmt-1",
              start: splitInsideStitchSequence,
              end: source.length,
            },
          ],
        },
      ],
      "en",
      { provider },
    );

    const translated = result?.translated ?? "";

    expect(translated).toBe(
      "2) Work in BLO. 2sc, 1inc, (4sc,1inc)*3, 2sc = 24sc, Ch 1 and turn,",
    );

    expect(result?.formattingProjection).toBe("atomic_collapse");

    expect(result?.targetFormattingRegions).toEqual([
      {
        id: "fmt-0",
        start: 0,
        end: translated.length,
      },
      {
        id: "fmt-1",
        start: translated.length,
        end: translated.length,
      },
    ]);

    expect(provider.requests).toHaveLength(0);
    expect(result?.errors).toEqual([]);
    expect(result?.valid).toBe(true);
  });

});

describe("Page 14 sleeve semantic projection fallback safety", () => {
  it("falls back to atomic_collapse when a formatting boundary splits a sleeve semantic clause", async () => {
    const provider = new UnconditionalCorruptingProvider();

    const source =
      "1) Görselde görüldüğü gibi kol boşluğunun arka tarafından ipimizi sabitliyoruz. 20x örüyoruz. Başlangıç noktamız burası olacak, işaretleyiciyi buraya takıyoruz.";

    const splitInsideFirstClause = source.indexOf("kol boşluğunun");

    const [result] = await translateBlocks(
      [
        {
          id: "page14-sleeve-split-inside-clause",
          text: source,
          formattingRegions: [
            {
              id: "fmt-0",
              start: 0,
              end: splitInsideFirstClause,
            },
            {
              id: "fmt-1",
              start: splitInsideFirstClause,
              end: source.length,
            },
          ],
        },
      ],
      "en",
      { provider },
    );

    expect(result?.translated).toBe(
      "1) As shown in the image, attach the yarn from the back of the armhole. Work 20sc. This will be the beginning of the round; place a stitch marker here.",
    );

    expect(result?.formattingProjection).toBe("atomic_collapse");

    expect(result?.targetFormattingRegions).toEqual([
      {
        id: "fmt-0",
        start: 0,
        end: result?.translated.length ?? 0,
      },
      {
        id: "fmt-1",
        start: result?.translated.length ?? 0,
        end: result?.translated.length ?? 0,
      },
    ]);

    expect(provider.requests).toHaveLength(0);
    expect(result?.valid).toBe(true);
    expect(result?.errors).toEqual([]);
  });
});

describe("live Page 14 formatting regression", () => {
  it("preserves real Canva marker/body formatting boundaries for the sleeve block", async () => {
    const source =
      "2-25) 24 sıra 20x\n" +
      "26) 13x örüyoruz (kolun üzerindeki dışa doğru kıvırdığımız kısmı öreceğiz). Görselde görüldüğü gibi ben 13x ördüğümde tam kolun üzerine denk geldi. Sizde kolun üst kısmına denk gelecek şekilde 1-2 sık iğne eksik ya da fazla örebilirsiniz. 1 zincir çekip dönüyoruz.\n" +
      "27) Bu sırayı Blo’dan örüyoruz. 2x, 1v, (4x,1v)*3, 2x = 24x, 1 zincir, dön,\n" +
      "28) 24x, 1 zincir, dön,\n" +
      "29) 24x, 1 zincir çekip ipimizi kesiyoruz.";

    const formattingRegions = [
      { id: "fmt-0", start: 0, end: 6 },
      { id: "fmt-1", start: 6, end: 18 },
      { id: "fmt-2", start: 18, end: 22 },
      { id: "fmt-3", start: 22, end: 283 },
      { id: "fmt-4", start: 283, end: 287 },
      { id: "fmt-5", start: 287, end: 359 },
      { id: "fmt-6", start: 359, end: 363 },
      { id: "fmt-7", start: 363, end: 383 },
      { id: "fmt-8", start: 383, end: 387 },
      { id: "fmt-9", start: 387, end: 425 },
    ];

    const provider = {
      translate: vi.fn(async () => {
        throw new Error("provider must not be called for this deterministic regression");
      }),
    };

    const [result] = await translateBlocks(
      [
        {
          id: "page-14-live-block-2",
          text: source,
          formattingRegions,
        } as never,
      ],
      "en",
      { provider: provider as never },
    );

    expect(provider.translate).not.toHaveBeenCalled();
    expect(result).toBeDefined();

    expect(result?.translated).toBe(
      "2-25) 20sc for 24 rounds\n" +
        "26) Work 13sc (we will crochet the section folded outward over the arm). As shown in the image, when I worked 13sc, it aligned exactly over the arm. You can work 1-2 fewer or additional single crochet stitches so that it aligns with the top of the arm. Ch 1 and turn.\n" +
        "27) Work in BLO. 2sc, 1inc, (4sc,1inc)*3, 2sc = 24sc, Ch 1 and turn,\n" +
        "28) 24sc, Ch 1 and turn,\n" +
        "29) 24sc. Ch 1 and cut the yarn.",
    );

    const regions = result?.targetFormattingRegions ?? [];

    expect(
      regions.map(({ id, start, end }) => ({
        id,
        text: result?.translated.slice(start, end) ?? "",
      })),
    ).toEqual([
      { id: "fmt-0", text: "2-25) " },
      { id: "fmt-1", text: "20sc for 24 rounds\n" },
      { id: "fmt-2", text: "26) " },
      {
        id: "fmt-3",
        text:
          "Work 13sc (we will crochet the section folded outward over the arm). As shown in the image, when I worked 13sc, it aligned exactly over the arm. You can work 1-2 fewer or additional single crochet stitches so that it aligns with the top of the arm. Ch 1 and turn.\n",
      },
      { id: "fmt-4", text: "27) " },
      {
        id: "fmt-5",
        text:
          "Work in BLO. 2sc, 1inc, (4sc,1inc)*3, 2sc = 24sc, Ch 1 and turn,\n",
      },
      { id: "fmt-6", text: "28) " },
      { id: "fmt-7", text: "24sc, Ch 1 and turn,\n" },
      { id: "fmt-8", text: "29) " },
      { id: "fmt-9", text: "24sc. Ch 1 and cut the yarn." },
    ]);

    expect(result?.valid).toBe(true);
    expect(result?.errors).toEqual([]);
  });
});

describe("course-end turn family through the pipeline (Task 18B)", () => {
  it.each([
    ["Sıra sonunda 1 zincir çekip dönüyoruz.", "When you reach the end, ch 1 and turn."],
    ["12) Sıra sonlarında 2 zincir çekip dönüyoruz.", "12) Each time you reach the end, ch 2 and turn."],
  ])("renders %s deterministically without the provider", async (text, expected) => {
    const provider = new InspectingProvider();
    const [result] = await translateBlocks([{ id: "course-end-turn", text }], "en", { provider });
    expect(result).toMatchObject({ translated: expected, valid: true, errors: [] });
    expect(result?.translated).not.toMatch(/\b(?:rounds?|rows?)\b/iu);
    expect(provider.requests).toHaveLength(0);
  });

  it("sends only the free prose after the clause to the provider, never the course word", async () => {
    const provider = new InspectingProvider();
    const [result] = await translateBlocks(
      [{ id: "course-end-turn-prose", text: "Sıra sonunda 1 zincir çekip dönüyoruz ve kenarı dikiyoruz." }],
      "en",
      { provider },
    );
    expect(result?.translated).toBe("When you reach the end, ch 1 and turn. ve kenarı dikiyoruz.");
    const sent = provider.requests.flatMap(({ blocks }) => blocks.map(({ text }) => text));
    expect(sent.join(" ")).toContain("kenarı dikiyoruz");
    expect(sent.some((text) => /sıra/iu.test(text))).toBe(false);
  });
});

describe("tool/yarn intro family is provider-independent when every slot is deterministic (Task 20B)", () => {
  // A provider that would destroy anything it is sent (the old h-3790 failure).
  class HostileProvider extends InspectingProvider {
    override async translate(request: Parameters<TranslationProvider["translate"]>[0]) {
      this.requests.push(request);
      return { translations: request.blocks.map(({ id }) => ({ id, translated: "" })) };
    }
  }

  it.each([
    // h-3790: size only (was empty and invalid after a provider round-trip).
    ["2.20 mm tığ ile örüyoruz.", "Using a 2.20 mm crochet hook, work as follows."],
    // h-b171: mapped colour through the generic description branch (was "siyah").
    ["2.20 numara tığ, siyah ip ile (catania 110) örüyoruz.", "Using a 2.20 mm crochet hook and black yarn (catania 110), work as follows."],
    ["2.20 numara tığ, siyah ip (Catania 110) ile örüyoruz.", "Using a 2.20 mm crochet hook and black Catania 110 yarn, work as follows."],
    // h-39c84 intro line: multiword mapped colour with a bullet.
    ["✦ 2.20 numara tığ, Açık gri (Gazzal Giza 2456) ip ile örüyoruz.", "✦ Using a 2.20 mm crochet hook and light gray yarn (Gazzal Giza 2456), work as follows."],
    ["3.00 mm tığ kullanıyoruz.", "Use a 3.00 mm crochet hook."],
  ])("%s renders deterministically with zero provider calls", async (text, expected) => {
    const provider = new HostileProvider();
    const [result] = await translateBlocks([{ id: "intro", text }], "en", { provider });
    expect(result).toMatchObject({ translated: expected, valid: true, errors: [] });
    expect(provider.requests).toHaveLength(0);
    expect(result?.translated).not.toMatch(/\b(?:siyah|açık|gri|tığ|ip|örüyoruz)\b/iu);
    expect(result?.translated.split(text.match(/\d+(?:[.,]\d+)?/u)![0])).toHaveLength(2);
  });

  it.each([
    // Unmapped descriptions are not deterministic: they keep the provider path.
    ["2 numara tığ, pamuk ip (Catania) ile örüyoruz.", "Using a 2 mm crochet hook and pamuk Catania yarn, work as follows."],
    // h-adcec: unknown "simli" plus a heading stays provider-owned and untranslated by this family.
    ["Bal kabağı; 2.00 numara tığ, simli ip ile örüyoruz.", "Bal kabağı; 2.00 numara tığ, simli ip ile örüyoruz."],
    // A recognized intro followed by free prose is not swallowed.
    ["2.20 mm tığ ile örüyoruz. Ekru renk ip ile başlıyoruz.", "Using a 2.20 mm crochet hook, work as follows. With ecru yarn başlıyoruz."],
  ])("%s keeps the provider path", async (text, echoed) => {
    const provider = new InspectingProvider();
    const [result] = await translateBlocks([{ id: "intro", text }], "en", { provider });
    expect(provider.requests.length).toBeGreaterThan(0);
    expect(result?.translated).toBe(echoed);
    expect(result?.translated).not.toContain("glitter");
    expect(result?.translated).not.toContain("sparkly");
  });

  const intro = "✦ 2.20 numara tığ, Açık gri (Gazzal Giza 2456) ip ile örüyoruz.";
  const introEn = "✦ Using a 2.20 mm crochet hook and light gray yarn (Gazzal Giza 2456), work as follows.";
  const text = `${intro}\n1) Sihirli halka içine 6x\n2) 6v = 12x`;

  it("a formatted block (as in h-39c84) no longer sends its intro formatting unit to the provider", async () => {
    const provider = new InspectingProvider();
    const [result] = await translateBlocks([{
      id: "block", text,
      formattingRegions: [
        { id: "fmt-0", start: 0, end: intro.length },
        { id: "fmt-1", start: intro.length, end: text.length },
      ],
    }], "en", { provider });
    expect(result?.translated.split("\n")[0]).toBe(introEn);
    expect(provider.protectedTexts.join(" ")).not.toMatch(/crochet hook|light gray|tığ/u);
  });

  it("an unformatted multi-line block stays one segment and, fully carried, needs no provider (Task 23K-2)", async () => {
    // fullyResolved is decided per segment; an unformatted multi-line block is
    // one whole-block segment. Since Task 23K-2 its deterministic spans (the
    // intro, the magic ring) are carried there too, and nothing translatable
    // is left, so the provider is not called.
    const provider = new InspectingProvider();
    const [result] = await translateBlocks([{ id: "block", text }], "en", { provider });
    expect(result?.translated.split("\n")[0]).toBe(introEn);
    expect(result?.valid).toBe(true);
    expect(provider.requests).toHaveLength(0);
  });
});

describe("deterministic span carrier keeps chain + turn out of provider ownership (Task 21B)", () => {
  // Hostile providers: erase everything, paraphrase English, or drop placeholders.
  class RewritingProvider extends InspectingProvider {
    constructor(private readonly rewrite: (text: string) => string) {
      super();
    }
    override async translate(request: Parameters<TranslationProvider["translate"]>[0]) {
      this.requests.push(request);
      this.protectedTexts.push(...request.blocks.map(({ text }) => text));
      return { translations: request.blocks.map(({ id, text }) => ({ id, translated: this.rewrite(text) })) };
    }
  }
  const hostile = {
    empty: () => "",
    rewrite: (text: string) =>
      text.replace(/\bCh\b/gu, "Chain").replace(/\bturn\b/gu, "rotate").replace(/kenarı/iu, "EDGE"),
    dropPlaceholders: (text: string) => text.replace(/__XQ[A-Z]+QX__\s?/gu, ""),
  };
  const sentTexts = (provider: InspectingProvider) => provider.protectedTexts;
  const occurrences = (text: string | undefined, needle: string) => (text ?? "").split(needle).length - 1;

  it.each([
    ["1 zincir çekip dönüyoruz.", "Ch 1 and turn."],
    ["2 zincir çekip dönüyoruz.", "Ch 2 and turn."],
    ["1 zincir, dön", "Ch 1 and turn"],
  ])("a pure clause %s needs no provider and survives every hostile provider", async (text, expected) => {
    for (const rewrite of Object.values(hostile)) {
      const provider = new RewritingProvider(rewrite);
      const [result] = await translateBlocks([{ id: "chain-turn", text }], "en", { provider });
      expect(result).toMatchObject({ translated: expected, valid: true, errors: [] });
      expect(provider.requests).toHaveLength(0);
    }
  });

  it.each([
    ["1 zincir çekip dönüyoruz ve kenarı dikiyoruz.", "Ch 1 and turn.", "ve kenarı dikiyoruz."],
    ["Kenarı dikip 1 zincir çekip dönüyoruz.", "Ch 1 and turn.", "Kenarı dikip"],
    ["3) 1 zincir çekip dönüyoruz ve kenarı dikiyoruz.", "Ch 1 and turn.", "ve kenarı dikiyoruz."],
  ])("a mixed line %s offers only its prose to the provider", async (text, deterministic, prose) => {
    const echo = new InspectingProvider();
    const [echoed] = await translateBlocks([{ id: "chain-turn", text }], "en", { provider: echo });
    expect(sentTexts(echo)).toEqual([prose]);
    // The deterministic text is read-only context, never a translatable span.
    expect(echo.requests[0]?.userPrompt).toContain(deterministic);
    expect(occurrences(echoed?.translated, deterministic)).toBe(1);
    expect(echoed?.valid).toBe(true);

    for (const rewrite of Object.values(hostile)) {
      const provider = new RewritingProvider(rewrite);
      const [result] = await translateBlocks([{ id: "chain-turn", text }], "en", { provider });
      // Exactly once, byte-exact, whatever the provider does to the prose.
      expect(occurrences(result?.translated, deterministic)).toBe(1);
      expect(result?.translated).not.toMatch(/Chain|rotate/u);
      expect(result?.translated.match(/\d+/gu)).toEqual(text.match(/\d+/gu));
    }
    const rewritten = new RewritingProvider(hostile.rewrite);
    const [paraphrased] = await translateBlocks([{ id: "chain-turn", text }], "en", { provider: rewritten });
    // The prose is still provider-owned.
    expect(paraphrased?.translated).toContain("EDGE");
  });

  it("formatting units still translate and project the mixed line", async () => {
    const text = "1 zincir çekip dönüyoruz ve kenarı dikiyoruz.";
    const split = text.indexOf(" ve ");
    const provider = new InspectingProvider();
    const [result] = await translateBlocks([{
      id: "chain-turn-formatted", text,
      formattingRegions: [
        { id: "fmt-0", start: 0, end: split },
        { id: "fmt-1", start: split, end: text.length },
      ],
    }], "en", { provider });
    expect(result?.valid).toBe(true);
    expect(occurrences(result?.translated, "Ch 1 and turn")).toBe(1);
    expect(sentTexts(provider).join(" ")).not.toMatch(/\bCh\b|turn/u);
  });

  it("the validator still checks the restored chain count", () => {
    const options = { notationCaseInsensitive: true, contentKind: "pattern" as const };
    const source = "1 zincir çekip dönüyoruz ve kenarı dikiyoruz.";
    expect(validateTranslation(source, "Ch 1 and turn. and sew the edge.", "en", options).valid).toBe(true);
    expect(validateTranslation(source, "Ch 3 and turn. and sew the edge.", "en", options).valid).toBe(false);
  });

  it("fails closed when the source already holds a reserved placeholder", async () => {
    const provider = new InspectingProvider();
    const text = `${reservedPlaceholder(0)} 1 zincir çekip dönüyoruz ve kenarı dikiyoruz.`;
    const [result] = await translateBlocks([{ id: "chain-turn-reserved", text }], "en", { provider });
    expect(result?.valid).toBe(false);
    expect(result?.translated).toBe("");
    expect(provider.requests).toHaveLength(0);
  });

  it("the style layer receives the restored fragment once and leaves it unchanged", async () => {
    const provider = new InspectingProvider();
    const text = "12) 1 zincir çekip dönüyoruz ve sıranın sonunu dikiyoruz.";
    const [result] = await translateBlocks([{ id: "chain-turn-style", text }], "en", { provider });
    expect(occurrences(result?.translated, "Ch 1 and turn.")).toBe(1);
    expect(result?.translated.startsWith("12) Ch 1 and turn. ")).toBe(true);
  });
});

describe("deterministic span carrier keeps word-ordinal chain start out of provider ownership (Task 22B)", () => {
  // Hostile providers: erase everything, paraphrase English, or drop placeholders.
  class RewritingProvider extends InspectingProvider {
    constructor(private readonly rewrite: (text: string) => string) {
      super();
    }
    override async translate(request: Parameters<TranslationProvider["translate"]>[0]) {
      this.requests.push(request);
      this.protectedTexts.push(...request.blocks.map(({ text }) => text));
      return { translations: request.blocks.map(({ id, text }) => ({ id, translated: this.rewrite(text) })) };
    }
  }
  const hostile = {
    empty: () => "",
    rewrite: (text: string) =>
      text
        .replace(/seventh|third/gu, "second")
        .replace(/\bwork\b/gu, "skip")
        .replace(/Starting from/gu, "Ending at")
        .replace(/kenarı/iu, "EDGE"),
    dropPlaceholders: (text: string) => text.replace(/__XQ[A-Z]+QX__\s?/gu, ""),
  };
  const occurrences = (text: string | undefined, needle: string) => (text ?? "").split(needle).length - 1;

  it.each([
    ["Yedinci zincirden itibaren 28x", "Starting from the seventh chain, work 28sc"],
    ["Üçüncü zincirden itibaren 8hdc", "Starting from the third chain, work 8hdc"],
    [
      "1) 10 zincir çekip dönüyoruz. Üçüncü zincirden itibaren 8hdc",
      "1) Ch 10 and turn. Starting from the third chain, work 8hdc",
    ],
  ])("a pure clause %s needs no provider and survives every hostile provider", async (text, expected) => {
    for (const rewrite of Object.values(hostile)) {
      const provider = new RewritingProvider(rewrite);
      const [result] = await translateBlocks([{ id: "chain-start", text }], "en", { provider });
      expect(result).toMatchObject({ translated: expected, valid: true, errors: [] });
      expect(provider.requests).toHaveLength(0);
    }
  });

  it("renders the stitch count in target notation, outside the carried prose", async () => {
    const provider = new InspectingProvider();
    const [result] = await translateBlocks(
      [{ id: "chain-start-count", text: "Yedinci zincirden itibaren 28x örüyoruz." }],
      "en",
      { provider },
    );
    expect(result).toMatchObject({ translated: "Starting from the seventh chain, work 28sc.", valid: true });
    expect(result?.translated).not.toContain("28x");
    // The trailing period is structure (Task 23A), so nothing reaches the provider.
    expect(provider.requests).toHaveLength(0);

    for (const rewrite of Object.values(hostile)) {
      const hostileProvider = new RewritingProvider(rewrite);
      const [hostileResult] = await translateBlocks(
        [{ id: "chain-start-count", text: "Yedinci zincirden itibaren 28x örüyoruz." }],
        "en",
        { provider: hostileProvider },
      );
      expect(hostileResult?.translated).toBe("Starting from the seventh chain, work 28sc.");
    }
  });

  it.each([
    [
      "Yedinci zincirden itibaren 28x örüyoruz ve kenarı dikiyoruz.",
      "Starting from the seventh chain, work",
      ["ve kenarı dikiyoruz."],
    ],
    [
      "Kenarı dikip yedinci zincirden itibaren 28x örüyoruz.",
      "Starting from the seventh chain, work",
      ["Kenarı dikip"],
    ],
  ])("a mixed line %s offers only its prose to the provider", async (text, deterministic, prose) => {
    const echo = new InspectingProvider();
    const [echoed] = await translateBlocks([{ id: "chain-start", text }], "en", { provider: echo });
    expect(echo.protectedTexts).toEqual(prose);
    // The deterministic text is read-only context, never a translatable span.
    expect(echo.requests[0]?.userPrompt).toContain(deterministic);
    expect(occurrences(echoed?.translated, deterministic)).toBe(1);
    expect(echoed?.translated).toContain(`${deterministic} 28sc`);
    expect(echoed?.valid).toBe(true);

    for (const rewrite of Object.values(hostile)) {
      const provider = new RewritingProvider(rewrite);
      const [result] = await translateBlocks([{ id: "chain-start", text }], "en", { provider });
      // Exactly once, byte-exact, with the count still in target notation.
      expect(occurrences(result?.translated, `${deterministic} 28sc`)).toBe(1);
      expect(result?.translated).not.toMatch(/second|skip|Ending at|28x/u);
    }
    const rewritten = new RewritingProvider(hostile.rewrite);
    const [paraphrased] = await translateBlocks([{ id: "chain-start", text }], "en", { provider: rewritten });
    // The prose is still provider-owned.
    expect(paraphrased?.translated).toContain("EDGE");
  });

  it("leaves second-chain and numeric-ordinal forms provider-exposed as before", async () => {
    const second = new InspectingProvider();
    const [secondResult] = await translateBlocks(
      [{ id: "second-chain", text: "ikinci zincirden itibaren 5x" }],
      "en",
      { provider: second },
    );
    expect(secondResult?.translated).toBe("Starting from the second chain, 5sc");
    expect(second.protectedTexts).toEqual(["Starting from the second chain"]);

    const numeric = new InspectingProvider();
    const [numericResult] = await translateBlocks(
      [{ id: "numeric-ordinal", text: "3. zincirden itibaren 8x" }],
      "en",
      { provider: numeric },
    );
    expect(numericResult?.translated).toBe("3. zincirden itibaren 8sc");
    expect(numeric.protectedTexts).toEqual(["zincirden itibaren"]);
  });

  it("formatting units still translate and project the mixed line", async () => {
    const text = "Yedinci zincirden itibaren 28x örüyoruz ve kenarı dikiyoruz.";
    const split = text.indexOf(" ve ");
    const provider = new InspectingProvider();
    const [result] = await translateBlocks([{
      id: "chain-start-formatted", text,
      formattingRegions: [
        { id: "fmt-0", start: 0, end: split },
        { id: "fmt-1", start: split, end: text.length },
      ],
    }], "en", { provider });
    expect(result?.valid).toBe(true);
    expect(occurrences(result?.translated, "Starting from the seventh chain, work 28sc")).toBe(1);
    expect(provider.protectedTexts.join(" ")).not.toMatch(/Starting|chain|work/u);
  });

  it("the validator still checks the restored stitch count", () => {
    const options = { notationCaseInsensitive: true, contentKind: "pattern" as const };
    const source = "Yedinci zincirden itibaren 28x örüyoruz ve kenarı dikiyoruz.";
    expect(
      validateTranslation(source, "Starting from the seventh chain, work 28sc and sew the edge.", "en", options).valid,
    ).toBe(true);
    expect(
      validateTranslation(source, "Starting from the seventh chain, work 27sc and sew the edge.", "en", options).valid,
    ).toBe(false);
  });

  it("the style layer receives the restored fragment once and leaves it unchanged", async () => {
    const provider = new InspectingProvider();
    const text = "12) Yedinci zincirden itibaren 28x örüyoruz ve sıranın sonunu dikiyoruz.";
    const [result] = await translateBlocks([{ id: "chain-start-style", text }], "en", { provider });
    expect(occurrences(result?.translated, "Starting from the seventh chain, work 28sc")).toBe(1);
    expect(result?.translated.startsWith("12) Starting from the seventh chain, work 28sc ")).toBe(true);
  });
});

describe("deterministic span carrier keeps buttonhole turn, magic ring and yarn intro out of provider ownership (Task 22D)", () => {
  // Hostile providers: erase everything, paraphrase English, or drop placeholders.
  class RewritingProvider extends InspectingProvider {
    constructor(private readonly rewrite: (text: string) => string) {
      super();
    }
    override async translate(request: Parameters<TranslationProvider["translate"]>[0]) {
      this.requests.push(request);
      this.protectedTexts.push(...request.blocks.map(({ text }) => text));
      return { translations: request.blocks.map(({ id, text }) => ({ id, translated: this.rewrite(text) })) };
    }
  }
  const hostile = {
    empty: () => "",
    rewrite: (text: string) =>
      text
        .replace(/buttonhole/gu, "picot")
        .replace(/\bturn\b/gu, "rotate")
        .replace(/\bch\b/gu, "chain")
        .replace(/magic ring/gu, "chain space")
        .replace(/black|red/gu, "white")
        .replace(/\byarn\b/gu, "thread")
        .replace(/catania|Alize/gu, "acrylic")
        .replace(/kenarı/iu, "EDGE"),
    dropPlaceholders: (text: string) => text.replace(/__XQ[A-Z]+QX__\s?/gu, ""),
  };
  const translate = async (provider: InspectingProvider, text: string, formattingRegions?: { id: string; start: number; end: number }[]) => {
    const [result] = await translateBlocks(
      [{ id: "carrier-22d", text, ...(formattingRegions ? { formattingRegions } : {}) }],
      "en",
      { provider },
    );
    return result;
  };
  const occurrences = (text: string | undefined, needle: string) => (text ?? "").split(needle).length - 1;

  it.each([
    ["42x - 5 zincir (düğme iliği) dön", "42sc, ch 5 (buttonhole) and turn"],
    ["12) 30x – 3 zincir (düğme iliği) dön", "12) 30sc, ch 3 (buttonhole) and turn"],
    ["Sihirli halka içine 6x", "6sc into the magic ring"],
  ])("a pure line %s needs no provider and survives every hostile provider", async (text, expected) => {
    for (const rewrite of Object.values(hostile)) {
      const provider = new RewritingProvider(rewrite);
      const result = await translate(provider, text);
      expect(result).toMatchObject({ translated: expected, valid: true, errors: [] });
      expect(provider.requests).toHaveLength(0);
    }
  });

  it.each([
    [
      "42x - 5 zincir (düğme iliği) dön ve kenarı dikiyoruz.",
      "42sc, ch 5 (buttonhole) and turn",
      ["ve kenarı dikiyoruz."],
    ],
    [
      "Sihirli halka içine 6x örüyoruz, sonra kenarı dikiyoruz.",
      "6sc into the magic ring",
      ["örüyoruz", "sonra kenarı dikiyoruz."],
    ],
    [
      "Kırmızı renk ip (Alize Cotton Gold 56) ile başlıyoruz ve kenarı dikiyoruz.",
      "Start with red yarn (Alize Cotton Gold 56)",
      ["ve kenarı dikiyoruz."],
    ],
  ])("a mixed line %s offers only its prose to the provider", async (text, deterministic, prose) => {
    const echo = new InspectingProvider();
    const echoed = await translate(echo, text);
    expect(echo.protectedTexts).toEqual(prose);
    // The deterministic text is read-only context, never a translatable span.
    expect(echo.requests[0]?.userPrompt).toContain(deterministic.replace(/(\d+)sc/u, "$1x"));
    expect(occurrences(echoed?.translated, deterministic)).toBe(1);
    expect(echoed?.valid).toBe(true);

    for (const rewrite of Object.values(hostile)) {
      const provider = new RewritingProvider(rewrite);
      const result = await translate(provider, text);
      // Exactly once, byte-exact, with counts still in target notation.
      expect(occurrences(result?.translated, deterministic)).toBe(1);
      expect(result?.translated).not.toMatch(/picot|rotate|chain space|white|thread|acrylic|\d+x\b/u);
      expect(result?.translated.match(/\d+/gu)).toEqual(text.match(/\d+/gu));
    }
    const rewritten = new RewritingProvider(hostile.rewrite);
    // The prose is still provider-owned.
    expect((await translate(rewritten, text))?.translated).toContain("EDGE");
  });

  it("protects the magic ring beside the stitch-marker gloss without duplicating it", async () => {
    const text = "1) Sihirli halka içine 6x , Başlangıç noktamız burası olacak. İşaretleyiciyi buraya takıyoruz.";
    const echo = new InspectingProvider();
    expect((await translate(echo, text))?.translated).toBe(
      "1) 6sc into the magic ring. This will be the beginning of the round; place a stitch marker here.",
    );
    expect(echo.protectedTexts.join(" ")).not.toContain("magic ring");
    for (const rewrite of Object.values(hostile)) {
      const result = await translate(new RewritingProvider(rewrite), text);
      expect(occurrences(result?.translated, "1) 6sc into the magic ring")).toBe(1);
    }
  });

  it("keeps the yarn intro beside provider-owned course-end prose", async () => {
    const text =
      "Siyah ip (catania 110) ile başlıyoruz. Sıra sonlarında cc ile birleştirip, 1 zincir çekip bir üst sıraya geçiyoruz.";
    const echo = new InspectingProvider();
    const echoed = await translate(echo, text);
    expect(echoed?.translated).toBe(
      "Start with black yarn (catania 110). At the end of each round, join with sl st, ch 1, and continue to the next round.",
    );
    expect(echo.protectedTexts.join(" ")).not.toMatch(/Start with|black|catania/u);
    for (const rewrite of Object.values(hostile)) {
      const result = await translate(new RewritingProvider(rewrite), text);
      expect(result?.translated.startsWith("Start with black yarn (catania 110)")).toBe(true);
    }
  });

  it("formatting units still translate and project the mixed magic-ring line", async () => {
    const text = "Sihirli halka içine 6x örüyoruz, sonra kenarı dikiyoruz.";
    const split = text.indexOf(" örüyoruz");
    const provider = new InspectingProvider();
    const result = await translate(provider, text, [
      { id: "fmt-0", start: 0, end: split },
      { id: "fmt-1", start: split, end: text.length },
    ]);
    expect(result?.valid).toBe(true);
    expect(occurrences(result?.translated, "6sc into the magic ring")).toBe(1);
    expect(provider.protectedTexts.join(" ")).not.toMatch(/magic|ring/u);
  });

  it("the validator still checks counts beside the carried prose", () => {
    const options = { notationCaseInsensitive: true, contentKind: "pattern" as const };
    const valid = (source: string, target: string) => validateTranslation(source, target, "en", options).valid;
    expect(valid("42x - 5 zincir (düğme iliği) dön", "42sc, ch 5 (buttonhole) and turn")).toBe(true);
    expect(valid("42x - 5 zincir (düğme iliği) dön", "42sc, ch 4 (buttonhole) and turn")).toBe(false);
    expect(valid("42x - 5 zincir (düğme iliği) dön", "41sc, ch 5 (buttonhole) and turn")).toBe(false);
    const ring = "Sihirli halka içine 6x örüyoruz, sonra ipimizi kesiyoruz.";
    expect(valid(ring, "6sc into the magic ring, then cut the yarn.")).toBe(true);
    expect(valid(ring, "5sc into the magic ring, then cut the yarn.")).toBe(false);
    const yarn = "Kırmızı renk ip (Alize Cotton Gold 56) ile başlıyoruz ve kenarı dikiyoruz.";
    expect(valid(yarn, "Start with red yarn (Alize Cotton Gold 56) and sew the edge.")).toBe(true);
    expect(valid(yarn, "Start with red yarn (Alize Cotton Gold 57) and sew the edge.")).toBe(false);
  });

  it("the style layer receives the restored fragment once and leaves it unchanged", async () => {
    const provider = new InspectingProvider();
    const result = await translate(provider, "12) Sihirli halka içine 6x örüyoruz, sonra kenarı dikiyoruz.");
    expect(occurrences(result?.translated, "6sc into the magic ring")).toBe(1);
    expect(result?.translated.startsWith("12) 6sc into the magic ring ")).toBe(true);
  });
});

describe("punctuation-only text is structure, never provider-owned (Task 23A)", () => {
  // Hostile providers: erase everything, rewrite punctuation, or drop placeholders.
  class RewritingProvider extends InspectingProvider {
    constructor(private readonly rewrite: (text: string) => string) {
      super();
    }
    override async translate(request: Parameters<TranslationProvider["translate"]>[0]) {
      this.requests.push(request);
      this.protectedTexts.push(...request.blocks.map(({ text }) => text));
      return { translations: request.blocks.map(({ id, text }) => ({ id, translated: this.rewrite(text) })) };
    }
  }
  const hostile = {
    empty: () => "",
    rewrite: (text: string) => text.replace(/[.!?✦◆]/gu, ";").replace(/sık/u, "SIK").replace(/örüyoruz/u, "ÖRÜYORUZ"),
    dropPlaceholders: (text: string) => text.replace(/__XQ[A-Z]+QX__\s?/gu, ""),
  };
  const occurrences = (text: string | undefined, needle: string) => (text ?? "").split(needle).length - 1;

  it.each([
    ["1) (6x, v) x 6. FLO örüyoruz.", "1) (6sc, inc) x 6. FLO"],
    ["1) (6x, v) x 6! FLO örüyoruz.", "1) (6sc, inc) x 6! FLO"],
    ["1) (6x, v) x 6? FLO örüyoruz.", "1) (6sc, inc) x 6? FLO"],
  ])("%s keeps its lone mark out of the provider and survives every hostile provider", async (text, structural) => {
    const echo = new InspectingProvider();
    const [echoed] = await translateBlocks([{ id: "punctuation", text }], "en", { provider: echo });
    expect(echo.protectedTexts).toEqual(["örüyoruz."]);
    expect(echoed?.translated).toBe(`${structural} örüyoruz.`);

    for (const rewrite of Object.values(hostile)) {
      const provider = new RewritingProvider(rewrite);
      const [result] = await translateBlocks([{ id: "punctuation", text }], "en", { provider });
      expect(result?.translated.startsWith(structural)).toBe(true);
      expect(occurrences(result?.translated, structural)).toBe(1);
    }
    // The adjacent prose is still provider-owned.
    const [rewritten] = await translateBlocks([{ id: "punctuation", text }], "en", {
      provider: new RewritingProvider(hostile.rewrite),
    });
    expect(rewritten?.translated).toContain("ÖRÜYORUZ");
  });

  it.each(["✦", "◆"])("a formatting unit holding only %s needs no provider and keeps its region", async (bullet) => {
    const text = `${bullet} Bu açıklama çevrilsin.`;
    const formattingRegions = [
      { id: "fmt-0", start: 0, end: 2 },
      { id: "fmt-1", start: 2, end: text.length },
    ];
    for (const rewrite of Object.values(hostile)) {
      const provider = new RewritingProvider(rewrite);
      const [result] = await translateBlocks([{ id: "bullet-unit", text, formattingRegions }], "en", { provider });
      expect(provider.protectedTexts).toEqual(["Bu açıklama çevrilsin."]);
      expect(result?.translated.startsWith(`${bullet} `)).toBe(true);
      expect(occurrences(result?.translated, bullet)).toBe(1);
      expect(result?.targetFormattingRegions?.[0]).toEqual({ id: "fmt-0", start: 0, end: 2 });
      expect(result?.targetFormattingRegions?.map(({ id }) => id)).toEqual(["fmt-0", "fmt-1"]);
    }
  });

  it.each([
    ["6x. sık iğneye ipimizi sabitliyoruz.", ". sık iğneye ipimizi sabitliyoruz.", "SIK"],
    ["6x ! dikkat edin.", "! dikkat edin.", ";"],
  ])("%s keeps its punctuation-prefixed prose provider-owned", async (text, span, marker) => {
    const echo = new InspectingProvider();
    await translateBlocks([{ id: "prefixed-prose", text }], "en", { provider: echo });
    expect(echo.protectedTexts).toEqual([span]);
    const [rewritten] = await translateBlocks([{ id: "prefixed-prose", text }], "en", {
      provider: new RewritingProvider(hostile.rewrite),
    });
    expect(rewritten?.translated).toContain(marker);
  });

  it("the validator is unchanged for structural punctuation", () => {
    const options = { notationCaseInsensitive: true, contentKind: "pattern" as const };
    const source = "1) (6x, v) x 6. FLO örüyoruz.";
    expect(validateTranslation(source, "1) (6sc, inc) x 6. Work in FLO.", "en", options).valid).toBe(true);
    expect(validateTranslation(source, "1) (5sc, inc) x 6. Work in FLO.", "en", options).valid).toBe(false);
  });
});

describe("the carrier protects the rendered occurrence, not an earlier identical text (Task 23B)", () => {
  class RewritingProvider extends InspectingProvider {
    override async translate(request: Parameters<TranslationProvider["translate"]>[0]) {
      this.requests.push(request);
      this.protectedTexts.push(...request.blocks.map(({ text }) => text));
      return {
        translations: request.blocks.map(({ id, text }) => ({
          id,
          translated: text.replace(/\bturn\b/gu, "rotate").replace(/magic ring/gu, "chain space"),
        })),
      };
    }
  }

  it.each([
    ["Ch 1 and turn. ve 1 zincir çekip dönüyoruz.", "ve Ch 1 and turn.", /ve Ch 1 and turn\.$/u],
    ["6x into the magic ring sonra sihirli halka içine 6x", "sonra 6sc into the magic ring", /sonra 6sc into the magic ring$/u],
  ])("%s keeps the rendering immutable", async (text, rendered, tail) => {
    const echo = new InspectingProvider();
    const [echoed] = await translateBlocks([{ id: "duplicate-text", text }], "en", { provider: echo });
    expect(echoed?.translated).toMatch(tail);
    expect(echoed?.translated).toContain(rendered);

    const provider = new RewritingProvider();
    const [result] = await translateBlocks([{ id: "duplicate-text", text }], "en", { provider });
    // The rendering survives; only the English that was already in the source is provider text.
    expect(result?.translated).toMatch(tail);
  });
});

describe("deterministic span carrier keeps \"In\" before FLO/BLO and \"Work\" out of provider ownership (Task 23C)", () => {
  // Hostile providers: erase everything, paraphrase English, or drop placeholders.
  class RewritingProvider extends InspectingProvider {
    constructor(private readonly rewrite: (text: string) => string) {
      super();
    }
    override async translate(request: Parameters<TranslationProvider["translate"]>[0]) {
      this.requests.push(request);
      this.protectedTexts.push(...request.blocks.map(({ text }) => text));
      return { translations: request.blocks.map(({ id, text }) => ({ id, translated: this.rewrite(text) })) };
    }
  }
  const hostile = {
    empty: () => "",
    rewrite: (text: string) =>
      text.replace(/\bIn\b/gu, "Out").replace(/\bWork\b/gu, "Skip").replace(/kenarı/iu, "EDGE"),
    dropPlaceholders: (text: string) => text.replace(/__XQ[A-Z]+QX__\s?/gu, ""),
  };
  const translate = async (provider: InspectingProvider, text: string) =>
    (await translateBlocks([{ id: "glue", text }], "en", { provider }))[0];
  const occurrences = (text: string | undefined, needle: string) => (text ?? "").split(needle).length - 1;

  it.each([
    ["5) FLO’dan (3x, 1v)*6 = 30x", "5) In FLO, (3sc, 1inc)*6 = 30sc"],
    ["BLO’dan (2x, 1v)*6 = 18x", "In BLO, (2sc, 1inc)*6 = 18sc"],
    ["6x örüyoruz", "Work 6sc"],
    ["6dc örüyoruz.", "Work 6dc."],
  ])("a pure line %s needs no provider and survives every hostile provider", async (text, expected) => {
    for (const rewrite of Object.values(hostile)) {
      const provider = new RewritingProvider(rewrite);
      expect(await translate(provider, text)).toMatchObject({ translated: expected, valid: true, errors: [] });
      expect(provider.requests).toHaveLength(0);
    }
  });

  it.each([
    ["FLO’dan (3x, 1v)*6, sonra kenarı dikiyoruz.", "In FLO, (3sc, 1inc)*6,", ["sonra kenarı dikiyoruz."]],
    ["Kenarı dikip. 6x örüyoruz.", "Work 6sc.", ["Kenarı dikip."]],
    // The same English word already in the source stays provider text.
    ["In bu sırada:\nFLO’dan (3x, 1v)*6, sonra kenarı dikiyoruz.", "\nIn FLO, (3sc, 1inc)*6,", ["In bu sırada", "sonra kenarı dikiyoruz."]],
    ["Work slowly, kenarı dikip. 6x örüyoruz.", "Work 6sc.", ["Work slowly", "kenarı dikip."]],
  ])("a mixed line %s offers only its prose to the provider", async (text, carried, prose) => {
    const echo = new InspectingProvider();
    const echoed = await translate(echo, text);
    expect(echo.protectedTexts).toEqual(prose);
    expect(occurrences(echoed?.translated, carried)).toBe(1);
    expect(echoed?.valid).toBe(true);

    for (const rewrite of Object.values(hostile)) {
      const result = await translate(new RewritingProvider(rewrite), text);
      // Exactly once, byte-exact, with counts still in target notation.
      expect(occurrences(result?.translated, carried)).toBe(1);
      expect(result?.translated.match(/\d+/gu)).toEqual(text.match(/\d+/gu));
    }
    // The prose, including the source's own English, is still provider-owned.
    const rewritten = await translate(new RewritingProvider(hostile.rewrite), text);
    expect(rewritten?.translated).toContain("EDGE");
    expect(rewritten?.translated).not.toMatch(/Out FLO|Skip 6sc/u);
  });

  it("the style layer leaves the carried In FLO unchanged and never duplicates it", async () => {
    const result = await translate(new InspectingProvider(), "12) FLO’dan (9x, 1v)*6 = 66x");
    expect(result?.translated).toBe("12) In FLO, (9sc, 1inc)*6 = 66sc");
    expect(occurrences(result?.translated, "In FLO")).toBe(1);
  });

  it("formatting units keep their regions around the carried In", async () => {
    const text = "5) FLO’dan (3x, 1v)*6 = 30x";
    const provider = new InspectingProvider();
    const [result] = await translateBlocks([{
      id: "glue-formatted", text,
      formattingRegions: [
        { id: "fmt-0", start: 0, end: 3 },
        { id: "fmt-1", start: 3, end: 19 },
        { id: "fmt-2", start: 19, end: text.length },
      ],
    }], "en", { provider });
    expect(result?.valid).toBe(true);
    expect(result?.translated).toBe("5) In FLO, (3sc, 1inc)*6 = 30sc");
    expect(provider.requests).toHaveLength(0);
    expect(result?.targetFormattingRegions?.map(({ id }) => id)).toEqual(["fmt-0", "fmt-1", "fmt-2"]);
  });

  it("the validator still checks counts beside the carried words", () => {
    const options = { notationCaseInsensitive: true, contentKind: "pattern" as const };
    const valid = (source: string, target: string) => validateTranslation(source, target, "en", options).valid;
    expect(valid("6x örüyoruz", "Work 6sc")).toBe(true);
    expect(valid("6x örüyoruz", "Work 5sc")).toBe(false);
    expect(valid("5) FLO’dan (3x, 1v)*6 = 30x", "5) In FLO, (3sc, 1inc)*6 = 30sc")).toBe(true);
    expect(valid("5) FLO’dan (3x, 1v)*6 = 30x", "5) In FLO, (4sc, 1inc)*6 = 30sc")).toBe(false);
  });
});

describe("simple Work rule keeps the separator before provider prose (Task 23D)", () => {
  class RewritingProvider extends InspectingProvider {
    constructor(private readonly rewrite: (text: string) => string) {
      super();
    }
    override async translate(request: Parameters<TranslationProvider["translate"]>[0]) {
      this.requests.push(request);
      this.protectedTexts.push(...request.blocks.map(({ text }) => text));
      return { translations: request.blocks.map(({ id, text }) => ({ id, translated: this.rewrite(text) })) };
    }
  }

  it.each([
    ["6x örüyoruz ve kenarı dikiyoruz.", "Work 6sc ve kenarı dikiyoruz.", ["ve kenarı dikiyoruz."]],
    ["3) 6x örüyoruz ve kenarı dikiyoruz.", "3) Work 6sc ve kenarı dikiyoruz.", ["ve kenarı dikiyoruz."]],
    ["6x örüyoruz\nve kenarı dikiyoruz.", "Work 6sc\nve kenarı dikiyoruz.", ["ve kenarı dikiyoruz."]],
    [
      "Kenarı dikip. 6x örüyoruz ve sonra kesiyoruz.",
      "Kenarı dikip. Work 6sc ve sonra kesiyoruz.",
      ["Kenarı dikip.", "ve sonra kesiyoruz."],
    ],
  ])("%s sends intact prose and never glues words", async (text, expected, prose) => {
    const echo = new InspectingProvider();
    const [echoed] = await translateBlocks([{ id: "work-spacing", text }], "en", { provider: echo });
    expect(echoed).toMatchObject({ translated: expected, valid: true, errors: [] });
    expect(echo.protectedTexts).toEqual(prose);
    expect(echoed?.translated).not.toMatch(/\d+(?:sc|x)\p{L}/u);

    const hostile = new RewritingProvider((span) => span.replace(/\bWork\b/gu, "Skip").replace(/kenarı/iu, "EDGE"));
    const [rewritten] = await translateBlocks([{ id: "work-spacing", text }], "en", { provider: hostile });
    expect(rewritten?.translated).toContain("Work 6sc");
    expect(rewritten?.translated).not.toContain("Skip");
    // The following prose is still provider-owned.
    expect(rewritten?.translated).toContain("EDGE");
  });

  it.each([
    ["6x örüyoruz", "Work 6sc"],
    ["6x örüyoruz.", "Work 6sc."],
    ["6x örüyoruz   .", "Work 6sc."],
    ["6dc örüyoruz.", "Work 6dc."],
    ["3) 6x örüyoruz.", "3) Work 6sc."],
  ])("a pure line %s is unchanged and needs no provider", async (text, expected) => {
    const provider = new InspectingProvider();
    const [result] = await translateBlocks([{ id: "work-pure", text }], "en", { provider });
    expect(result).toMatchObject({ translated: expected, valid: true, errors: [] });
    expect(provider.requests).toHaveLength(0);
  });

  it("the validator still checks the count beside the separated prose", () => {
    const options = { notationCaseInsensitive: true, contentKind: "pattern" as const };
    const source = "6x örüyoruz ve kenarı dikiyoruz.";
    expect(validateTranslation(source, "Work 6sc and sew the edge.", "en", options).valid).toBe(true);
    expect(validateTranslation(source, "Work 5sc and sew the edge.", "en", options).valid).toBe(false);
  });
});

describe("magic ring and hair continuation have one owner: normalizer + carrier (Task 23F)", () => {
  class RewritingProvider extends InspectingProvider {
    constructor(private readonly rewrite: (text: string) => string) {
      super();
    }
    override async translate(request: Parameters<TranslationProvider["translate"]>[0]) {
      this.requests.push(request);
      this.protectedTexts.push(...request.blocks.map(({ text }) => text));
      return { translations: request.blocks.map(({ id, text }) => ({ id, translated: this.rewrite(text) })) };
    }
  }
  const hostile = {
    empty: () => "",
    rewrite: (text: string) =>
      text
        .replace(/hair strands/gu, "beard")
        .replace(/cutting the yarn/gu, "keeping the thread")
        .replace(/magic ring/gu, "chain space")
        .replace(/kenarı/iu, "EDGE"),
    dropPlaceholders: (text: string) => text.replace(/__XQ[A-Z]+QX__\s?/gu, ""),
  };
  const translate = async (provider: InspectingProvider, text: string) =>
    (await translateBlocks([{ id: "single-owner", text }], "en", { provider }))[0];
  const occurrences = (text: string | undefined, needle: string) => (text ?? "").split(needle).length - 1;
  const hair = "Without cutting the yarn, continue with the hair strands";

  it.each([
    ["Sihirli halka içine 6x", "6sc into the magic ring"],
    ["1) Sihirli halka içine 6x.", "1) 6sc into the magic ring."],
    ["12) 66x örüyoruz ipimizi kesmeden saç telleri ile devam ediyoruz.", `12) 66sc. ${hair}.`],
    ["66x örüyoruz ipimizi kesmeden saç telleri ile devam ediyoruz", `66sc. ${hair}`],
  ])("a pure line %s needs no provider and survives every hostile provider", async (text, expected) => {
    for (const rewrite of Object.values(hostile)) {
      const provider = new RewritingProvider(rewrite);
      expect(await translate(provider, text)).toMatchObject({ translated: expected, valid: true, errors: [] });
      expect(provider.requests).toHaveLength(0);
    }
  });

  it.each([
    ["Kenarı dikip. 66x örüyoruz ipimizi kesmeden saç telleri ile devam ediyoruz.", `66sc. ${hair}.`, ["Kenarı dikip."]],
    ["12) 66x örüyoruz ipimizi kesmeden saç telleri ile devam ediyoruz ve kenarı dikiyoruz.", `12) 66sc. ${hair}`, ["ve kenarı dikiyoruz."]],
    [
      "Without cutting the yarn, kenarı dikip. 66x örüyoruz ipimizi kesmeden saç telleri ile devam ediyoruz.",
      `66sc. ${hair}.`,
      ["Without cutting the yarn", "kenarı dikip."],
    ],
    ["Sihirli halka içine 6x örüyoruz, sonra kenarı dikiyoruz.", "6sc into the magic ring", ["örüyoruz", "sonra kenarı dikiyoruz."]],
  ])("a mixed line %s offers only its prose to the provider", async (text, carried, prose) => {
    const echo = new InspectingProvider();
    const echoed = await translate(echo, text);
    expect(echo.protectedTexts).toEqual(prose);
    expect(occurrences(echoed?.translated, carried)).toBe(1);
    expect(echoed?.valid).toBe(true);
    for (const rewrite of Object.values(hostile)) {
      const result = await translate(new RewritingProvider(rewrite), text);
      expect(occurrences(result?.translated, carried)).toBe(1);
      expect(result?.translated.match(/\d+/gu)).toEqual(text.match(/\d+/gu));
    }
    // The surrounding prose, including the source's own English, is still provider-owned.
    expect((await translate(new RewritingProvider(hostile.rewrite), text))?.translated).toMatch(/EDGE/u);
  });

  it("neither line is atomically covered, so the style-based provider bypass never applies", () => {
    for (const text of [
      "Sihirli halka içine 6x",
      "1) Sihirli halka içine 6x.",
      "12) 66x örüyoruz ipimizi kesmeden saç telleri ile devam ediyoruz.",
    ]) {
      expect(extractSourceAtomicNaturalLanguageSpans(text)).toEqual([]);
    }
  });

  it("the validator still checks the count beside the carried continuation", () => {
    const options = { notationCaseInsensitive: true, contentKind: "pattern" as const };
    const source = "12) 66x örüyoruz ipimizi kesmeden saç telleri ile devam ediyoruz.";
    expect(validateTranslation(source, `12) 66sc. ${hair}.`, "en", options).valid).toBe(true);
    expect(validateTranslation(source, `12) 65sc. ${hair}.`, "en", options).valid).toBe(false);
  });
});

describe("neutral leg templates have one owner: normalizer + carrier (Task 23G)", () => {
  class RewritingProvider extends InspectingProvider {
    constructor(private readonly rewrite: (text: string) => string) {
      super();
    }
    override async translate(request: Parameters<TranslationProvider["translate"]>[0]) {
      this.requests.push(request);
      this.protectedTexts.push(...request.blocks.map(({ text }) => text));
      return { translations: request.blocks.map(({ id, text }) => ({ id, translated: this.rewrite(text) })) };
    }
  }
  const hostile = {
    empty: () => "",
    rewrite: (text: string) =>
      text
        .replace(/\bleg\b/gu, "arm")
        .replace(/\bch\b|\bCh\b/gu, "chain")
        .replace(/cut the yarn|cutting the yarn/gu, "keep the thread")
        .replace(/\bWork\b|\bwork\b/gu, "Skip")
        .replace(/ecru/gu, "navy")
        .replace(/kenarı/iu, "EDGE"),
    dropPlaceholders: (text: string) => text.replace(/__XQ[A-Z]+QX__\s?/gu, ""),
  };
  const translate = async (provider: InspectingProvider, text: string) =>
    (await translateBlocks([{ id: "leg", text }], "en", { provider }))[0];
  const occurrences = (text: string | undefined, needle: string) => (text ?? "").split(needle).length - 1;
  const join = "From the second leg, ch 3 and join to the first leg with the backs of the legs facing you";
  const align =
    "For me, the finishing point of both legs aligned with the center of the inner side of each leg. If yours does not align, work 1-2 fewer or additional single crochet stitches to reach the center";
  const sources = {
    yarn: "✦ Ekru renk ip ile; (Turuncu ipimizi kesiyoruz.)",
    cut: "52) 24x, 1 zincir çekip ipimizi kesiyoruz.",
    join: "✦ İkinci bacaktan 3 zincir ile bacakların arka tarafı bize dönük olacak şekilde ilk bacak ile birleştiriyoruz.",
    align:
      "✦ Bende her iki bacağın bitiş noktası bacağın iç kısmının ortasına denk geldi. Sizde denk gelmiyorsa 1-2 sık iğne eksik ya da fazla örerek orta noktaya gelin.",
    body: "53) 12x örüyoruz, ipimizi kesmeden gövde ile devam ediyoruz.",
  };

  it.each([
    [sources.yarn, "✦ With ecru yarn: (Cut the orange yarn.)"],
    [sources.cut, "52) 24sc. Ch 1 and cut the yarn."],
    [sources.join, `✦ ${join}.`],
    [sources.align, `✦ ${align}.`],
    [sources.body, "53) Work 12sc, then continue with the body without cutting the yarn."],
  ])("a pure line %s needs no provider and survives every hostile provider", async (text, expected) => {
    for (const rewrite of Object.values(hostile)) {
      const provider = new RewritingProvider(rewrite);
      expect(await translate(provider, text)).toMatchObject({ translated: expected, valid: true, errors: [] });
      expect(provider.requests).toHaveLength(0);
    }
  });

  it.each([
    [`${sources.yarn} ve kenarı dikiyoruz.`, "With ecru yarn: (Cut the orange yarn.)", ["ve kenarı dikiyoruz."]],
    ["Kenarı dikip. 24x, 1 zincir çekip ipimizi kesiyoruz.", "24sc. Ch 1 and cut the yarn.", ["Kenarı dikip."]],
    [sources.cut.replace(/\.$/u, " ve kenarı dikiyoruz."), "52) 24sc. Ch 1 and cut the yarn", ["ve kenarı dikiyoruz."]],
    [sources.join.replace(/\.$/u, " ve kenarı dikiyoruz."), join, ["ve kenarı dikiyoruz."]],
    [`Kenarı dikip, ${sources.join.slice(2).replace(/^İ/u, "i")}`, join, ["Kenarı dikip"]],
    [sources.align.replace(/\.$/u, " ve kenarı dikiyoruz."), align, ["ve kenarı dikiyoruz."]],
    ["Kenarı dikip. 12x örüyoruz, ipimizi kesmeden gövde ile devam ediyoruz.", "Work 12sc, then continue with the body without cutting the yarn.", ["Kenarı dikip."]],
    [sources.body.replace(/\.$/u, " ve kenarı dikiyoruz."), "53) Work 12sc, then continue with the body without cutting the yarn", ["ve kenarı dikiyoruz."]],
    // The same English already in the source stays provider text.
    [`From the second leg, kenarı dikip. ${sources.join.slice(2)}`, join, ["From the second leg", "kenarı dikip."]],
  ])("a mixed line %s offers only its prose to the provider", async (text, carried, prose) => {
    const echo = new InspectingProvider();
    const echoed = await translate(echo, text);
    expect(echo.protectedTexts).toEqual(prose);
    expect(occurrences(echoed?.translated, carried)).toBe(1);
    expect(echoed?.valid).toBe(true);
    for (const rewrite of Object.values(hostile)) {
      const result = await translate(new RewritingProvider(rewrite), text);
      expect(occurrences(result?.translated, carried)).toBe(1);
      expect(result?.translated.match(/\d+/gu)).toEqual(text.match(/\d+/gu));
    }
    // The surrounding prose is still provider-owned.
    expect((await translate(new RewritingProvider(hostile.rewrite), text))?.translated).toMatch(/EDGE/u);
  });

  it("only the compact chain-cut line is atomically covered, so only its style rule stays a bypass renderer", () => {
    expect(extractSourceAtomicNaturalLanguageSpans(sources.cut)).not.toEqual([]);
    for (const text of [sources.yarn, sources.join, sources.align, sources.body]) {
      expect(extractSourceAtomicNaturalLanguageSpans(text)).toEqual([]);
    }
  });

  it("leaves the round-sensitive leg sentences as before", async () => {
    const provider = new InspectingProvider();
    const result = await translate(provider, "✦ İkinci bacakta da ilk 51 sırayı aynı şekilde örüyoruz.");
    expect(result?.translated).toBe("✦ On the second leg, work the first 51 rounds in the same way.");
    expect(provider.requests.length).toBeGreaterThan(0);
  });

  it("the validator still checks stitch and chain counts beside the carried words", () => {
    const options = { notationCaseInsensitive: true, contentKind: "pattern" as const };
    const valid = (source: string, target: string) => validateTranslation(source, target, "en", options).valid;
    expect(valid(sources.cut, "52) 24sc. Ch 1 and cut the yarn.")).toBe(true);
    expect(valid(sources.cut, "52) 23sc. Ch 1 and cut the yarn.")).toBe(false);
    expect(valid(sources.cut, "52) 24sc. Ch 2 and cut the yarn.")).toBe(false);
    expect(valid(sources.join, `✦ ${join}.`)).toBe(true);
    expect(valid(sources.join, `✦ ${join.replace("ch 3", "ch 4")}.`)).toBe(false);
    expect(valid(sources.body, "53) Work 12sc, then continue with the body without cutting the yarn.")).toBe(true);
    expect(valid(sources.body, "53) Work 11sc, then continue with the body without cutting the yarn.")).toBe(false);
  });
});

describe("the ch/skip fragment is carried while style keeps the eye parenthetical (Task 23H)", () => {
  class RewritingProvider extends InspectingProvider {
    constructor(private readonly rewrite: (text: string) => string) {
      super();
    }
    override async translate(request: Parameters<TranslationProvider["translate"]>[0]) {
      this.requests.push(request);
      this.protectedTexts.push(...request.blocks.map(({ text }) => text));
      return { translations: request.blocks.map(({ id, text }) => ({ id, translated: this.rewrite(text) })) };
    }
  }
  const hostile = {
    empty: () => "",
    rewrite: (text: string) =>
      text.replace(/\bch\b/gu, "chain").replace(/\bskip\b/gu, "work").replace(/\bsts?\b/gu, "loops").replace(/kenarı/iu, "EDGE"),
    dropPlaceholders: (text: string) => text.replace(/__XQ[A-Z]+QX__\s?/gu, ""),
  };
  const translate = async (provider: InspectingProvider, text: string) =>
    (await translateBlocks([{ id: "ch-skip", text }], "en", { provider }))[0];
  const occurrences = (text: string | undefined, needle: string) => (text ?? "").split(needle).length - 1;

  it.each([
    ["24) 25x, 1 zincir, 1x atla, 10x", "24) 25sc, ch 1, skip 1 st, 10sc"],
    ["15x, 2 zincir 2x atla, 9x", "15sc, ch 2, skip 2 sts, 9sc"],
    ["24) 15x, 2 zincir 2x atla, 9x, 3 zincir, 1x atla, 38x", "24) 15sc, ch 2, skip 2 sts, 9sc, ch 3, skip 1 st, 38sc"],
    ["3 zincir çekip 2x atlıyoruz.", "ch 3, skip 2 sts."],
  ])("a pure line %s needs no provider and survives every hostile provider", async (text, expected) => {
    for (const rewrite of Object.values(hostile)) {
      const provider = new RewritingProvider(rewrite);
      expect(await translate(provider, text)).toMatchObject({ translated: expected, valid: true, errors: [] });
      expect(provider.requests).toHaveLength(0);
    }
  });

  it.each([
    ["Kenarı dikip, 25x, 1 zincir, 1x atla, 10x", ["ch 1, skip 1 st"], ["Kenarı dikip"]],
    ["25x, 1 zincir, 1x atla, 10x ve kenarı dikiyoruz.", ["ch 1, skip 1 st"], ["ve kenarı dikiyoruz."]],
    ["2 zincir 2x atla, sonra kenarı dikip, 3 zincir 1x atla.", ["ch 2, skip 2 sts", "ch 3, skip 1 st"], ["sonra kenarı dikip"]],
    // The same English already in the source stays provider text.
    ["Kenarı dikip, ch 1, skip 1 st. 25x, 1 zincir, 1x atla, 10x", ["25sc, ch 1, skip 1 st, 10sc"], ["Kenarı dikip", "ch", "skip", "st."]],
  ])("a mixed line %s offers only its prose to the provider", async (text, carried, prose) => {
    const echo = new InspectingProvider();
    const echoed = await translate(echo, text);
    expect(echo.protectedTexts).toEqual(prose);
    expect(echoed?.valid).toBe(true);
    for (const rewrite of Object.values(hostile)) {
      const result = await translate(new RewritingProvider(rewrite), text);
      for (const fragment of carried) expect(occurrences(result?.translated, fragment)).toBe(1);
      expect(result?.translated.match(/\d+/gu)).toEqual(text.match(/\d+/gu));
    }
    // Order is kept and the surrounding prose is still provider-owned.
    const rewritten = (await translate(new RewritingProvider(hostile.rewrite), text))?.translated ?? "";
    expect(rewritten).toMatch(/EDGE/u);
    if (carried.length === 2) expect(rewritten.indexOf(carried[0]!)).toBeLessThan(rewritten.indexOf(carried[1]!));
  });

  it("the eye-placement parenthetical stays provider prose rebuilt by the style sequence rule", async () => {
    const text =
      "24) 15x, 2 zincir 2x atla, 9x, 2 zincir 2x atla, 38x (zincirlerle oluşturduğumuz boşluklara daha sonra gözleri takacağız)";
    const expected =
      "24) 15sc, ch 2, skip 2 sts, 9sc, ch 2, skip 2 sts, 38sc (we will insert the eyes into these chain spaces later)";
    const echo = new InspectingProvider();
    expect(await translate(echo, text)).toMatchObject({ translated: expected, valid: true });
    // Only the parenthetical reaches the provider; the ch/skip words are carried.
    expect(echo.protectedTexts).toEqual(["zincirlerle oluşturduğumuz boşluklara daha sonra we will insert the eyes"]);
    // The style sequence rule still owns the parenthetical's wording, whatever the provider says.
    for (const rewrite of Object.values(hostile)) {
      expect((await translate(new RewritingProvider(rewrite), text))?.translated).toBe(expected);
    }
    expect(extractSourceAtomicNaturalLanguageSpans(text)).toEqual([]);
    expect(extractSourceAtomicNaturalLanguageSpans("24) 25x, 1 zincir, 1x atla, 10x")).toEqual([]);
  });

  it("the validator still checks chain counts, skip counts and notation", () => {
    const options = { notationCaseInsensitive: true, contentKind: "pattern" as const };
    const source = "24) 15x, 2 zincir 2x atla, 9x, 3 zincir, 1x atla, 38x";
    const valid = (target: string) => validateTranslation(source, target, "en", options).valid;
    expect(valid("24) 15sc, ch 2, skip 2 sts, 9sc, ch 3, skip 1 st, 38sc")).toBe(true);
    expect(valid("24) 15sc, ch 4, skip 2 sts, 9sc, ch 3, skip 1 st, 38sc")).toBe(false);
    expect(valid("24) 15sc, ch 2, skip 3 sts, 9sc, ch 3, skip 1 st, 38sc")).toBe(false);
    expect(valid("24) 15sc, ch, skip 2 sts, 9sc, ch 3, skip 1 st, 38sc")).toBe(false);
    expect(valid("24) 15sc, ch 2, skip 2 sts, 9dc, ch 3, skip 1 st, 38sc")).toBe(false);
  });
});

describe("legacy FLO/BLO spellings no longer depend on the style repair (Task 23I)", () => {
  class RewritingProvider extends InspectingProvider {
    constructor(private readonly rewrite: (text: string) => string) {
      super();
    }
    override async translate(request: Parameters<TranslationProvider["translate"]>[0]) {
      this.requests.push(request);
      this.protectedTexts.push(...request.blocks.map(({ text }) => text));
      return { translations: request.blocks.map(({ id, text }) => ({ id, translated: this.rewrite(text) })) };
    }
  }
  const hostile = {
    empty: () => "",
    rewrite: (text: string) =>
      text.replace(/\bIn\b/gu, "Out").replace(/\bFLO\b|\bBLO\b/gu, "LOOP").replace(/^[‘’'`´]?\s*dan$/u, "from").replace(/kenarı/iu, "EDGE"),
    dropPlaceholders: (text: string) => text.replace(/__XQ[A-Z]+QX__\s?/gu, ""),
  };
  const translate = async (provider: InspectingProvider, text: string) =>
    (await translateBlocks([{ id: "loop", text }], "en", { provider }))[0];
  const occurrences = (text: string | undefined, needle: string) => (text ?? "").split(needle).length - 1;

  it.each([
    ["5) flodan (3x, 1v)*6 = 30x", "5) In FLO, (3sc, 1inc)*6 = 30sc"],
    ["5) FLOdan (3x, 1v)*6 = 30x", "5) In FLO, (3sc, 1inc)*6 = 30sc"],
    ["5) FLO dan (3x, 1v)*6 = 30x", "5) In FLO, (3sc, 1inc)*6 = 30sc"],
    ["5) blodan (2x, 1v)*6 = 18x", "5) In BLO, (2sc, 1inc)*6 = 18sc"],
    ["5) BLOdan (2x, 1v)*6 = 18x", "5) In BLO, (2sc, 1inc)*6 = 18sc"],
    ["5) BLO dan (2x, 1v)*6 = 18x", "5) In BLO, (2sc, 1inc)*6 = 18sc"],
  ])("a pure line %s needs no provider and survives every hostile provider", async (text, expected) => {
    for (const rewrite of Object.values(hostile)) {
      const provider = new RewritingProvider(rewrite);
      expect(await translate(provider, text)).toMatchObject({ translated: expected, valid: true, errors: [] });
      expect(provider.requests).toHaveLength(0);
    }
  });

  it.each([
    ["flodan (3x, 1v)*6, sonra kenarı dikiyoruz.", "In FLO, (3sc, 1inc)*6,", ["sonra kenarı dikiyoruz."]],
    ["Kenarı dikip.\nBLO dan (2x, 1v)*6 = 18x", "In BLO, (2sc, 1inc)*6 = 18sc", ["Kenarı dikip."]],
    // The source's own English "In" stays provider text.
    ["In bu sırada:\nflodan (3x, 1v)*6, sonra kenarı dikiyoruz.", "In FLO, (3sc, 1inc)*6,", ["In bu sırada", "sonra kenarı dikiyoruz."]],
  ])("a mixed line %s offers only its prose to the provider", async (text, carried, prose) => {
    const echo = new InspectingProvider();
    const echoed = await translate(echo, text);
    expect(echo.protectedTexts).toEqual(prose);
    expect(occurrences(echoed?.translated, carried)).toBe(1);
    expect(echoed?.valid).toBe(true);
    for (const rewrite of Object.values(hostile)) {
      const result = await translate(new RewritingProvider(rewrite), text);
      expect(occurrences(result?.translated, carried)).toBe(1);
      expect(result?.translated.match(/\d+/gu)).toEqual(text.match(/\d+/gu));
    }
    expect((await translate(new RewritingProvider(hostile.rewrite), text))?.translated).toMatch(/EDGE/u);
  });

  it("no short-loop line is atomically covered, so no provider bypass depends on the retired repair", () => {
    for (const text of ["5) FLO’dan (3x, 1v)*6 = 30x", "5) flodan (3x, 1v)*6 = 30x", "5) BLO dan (3x, 1v)*6 = 30x"]) {
      expect(extractSourceAtomicNaturalLanguageSpans(text)).toEqual([]);
    }
  });

  it("the validator still checks counts and notation beside the carried In", () => {
    const options = { notationCaseInsensitive: true, contentKind: "pattern" as const };
    const source = "5) flodan (3x, 1v)*6 = 30x";
    const valid = (target: string) => validateTranslation(source, target, "en", options).valid;
    expect(valid("5) In FLO, (3sc, 1inc)*6 = 30sc")).toBe(true);
    expect(valid("5) In FLO, (4sc, 1inc)*6 = 30sc")).toBe(false);
    expect(valid("5) In FLO, (3sc, 1dec)*6 = 30sc")).toBe(false);
  });
});

describe("notation-like yarn and tool brands stay exact source data and validate (Task 23K-1)", () => {
  class RewritingProvider extends InspectingProvider {
    constructor(private readonly rewrite: (text: string) => string) {
      super();
    }
    override async translate(request: Parameters<TranslationProvider["translate"]>[0]) {
      this.requests.push(request);
      this.protectedTexts.push(...request.blocks.map(({ text }) => text));
      return { translations: request.blocks.map(({ id, text }) => ({ id, translated: this.rewrite(text) })) };
    }
  }
  const providers = {
    echo: () => new InspectingProvider(),
    rewrite: () =>
      new RewritingProvider((text) =>
        text.replace(/\byarn\b/gu, "thread").replace(/Alize|Brand/gu, "acrylic").replace(/kenarı/iu, "EDGE"),
      ),
  };
  const translate = async (
    text: string,
    provider: InspectingProvider,
    formattingRegions?: { id: string; start: number; end: number }[],
  ) =>
    (await translateBlocks([{ id: "brand", text, ...(formattingRegions ? { formattingRegions } : {}) }], "en", { provider }))[0];
  const ORDINARY = "Alize Cotton Gold";
  const BRANDS = [ORDINARY, "Alize 110", "Alize 3x", "Alize 1v", "Brand 2a", "Brand 3x 1v", "3x", "110"];
  const occurrences = (text: string | undefined, needle: string) => (text ?? "").split(needle).length - 1;

  // Every Task 23J dimension of the branded colour tool intro, in one shape list.
  const toolShapes: { shape: string; size: string }[] = [];
  for (const prefix of ["", "✦ ", "◆ ", "3) "])
    for (const size of ["2", "2.20", "2,5"])
      for (const keyword of ["numara", "NO"])
        for (const colour of ["siyah", "Açık gri"])
          for (const renk of ["", " renk"])
            for (const spacing of [" ", ""])
              for (const ending of [".", ""])
                toolShapes.push({ size, shape: `${prefix}${size} ${keyword} tığ, ${colour}${renk} (BRAND)${spacing}ip ile örüyoruz${ending}` });
  toolShapes.push(
    { size: "2.20", shape: "  ✦  2.20  numara  tığ ，  siyah  (  BRAND  )  ip  ile  örüyoruz ." },
    { size: "2.20", shape: "2.20 numara tığ, siyah ip ile (BRAND) örüyoruz." },
    { size: "2.20", shape: "◆ 2.20 no tığ, siyah ip (BRAND) ile örüyoruz" },
  );

  it(`keeps every branded tool intro exact, valid and provider-free (${toolShapes.length} shapes x ${BRANDS.length} brands)`, async () => {
    for (const { shape, size } of toolShapes) {
      const ordinaryProvider = new InspectingProvider();
      const ordinary = await translate(shape.replace("BRAND", ORDINARY), ordinaryProvider);
      for (const brand of BRANDS) {
        for (const make of Object.values(providers)) {
          const provider = make();
          const result = await translate(shape.replace("BRAND", brand), provider);
          const context = `${shape} / ${brand}`;
          expect(result?.valid, context).toBe(true);
          expect(occurrences(result?.translated, brand), context).toBeGreaterThanOrEqual(1);
          expect(result?.translated, context).toContain(`${size} mm crochet hook`);
          expect(result?.translated, context).not.toMatch(/\d+(?:sc|inc)\b/u);
          // Punctuation and bullets are exactly those of the ordinary brand.
          expect(result?.translated.split(brand).join("<B>"), context).toBe(ordinary?.translated.split(ORDINARY).join("<B>"));
          expect(provider.requests, context).toHaveLength(ordinaryProvider.requests.length);
          expect(provider.protectedTexts.join(" "), context).not.toContain(brand);
        }
      }
    }
  });

  it("covers both the style-covered and the normalizer-only fully-resolved paths", async () => {
    const styled = "✦ 2.20 numara tığ, Açık gri (Alize 3x) ip ile örüyoruz.";
    const normalizerOnly = ["◆ 2.20 numara tığ, Açık gri (Alize 3x) ip ile örüyoruz.", "2.20 numara tığ, siyah (Alize 3x)ip ile örüyoruz.", "3) 2.20 numara tığ, siyah (Alize 3x) ip ile örüyoruz."];
    expect(normalizeTranslationStyle(styled, "PROBE", "en")).toBe(
      "✦ Using a 2.20 mm crochet hook and light gray yarn (Alize 3x), work as follows.",
    );
    for (const source of normalizerOnly) expect(normalizeTranslationStyle(source, "PROBE", "en")).toBe("PROBE");
    for (const source of [styled, ...normalizerOnly]) {
      const provider = new InspectingProvider();
      const result = await translate(source, provider);
      expect(result).toMatchObject({ valid: true, errors: [] });
      expect(result?.translated).toContain("(Alize 3x), work as follows");
      expect(provider.requests).toHaveLength(0);
    }
  });

  it.each(BRANDS)("keeps the yarn intro brand %s exact and the yarn wording deterministic", async (brand) => {
    for (const [source, expected, prose] of [
      [`Kırmızı renk ip (${brand}) ile başlıyoruz.`, `Start with red yarn (${brand}).`, []],
      [`Siyah ip (${brand}) ile başlıyoruz`, `Start with black yarn (${brand})`, []],
      [`Kırmızı renk ip (${brand}) ile başlıyoruz ve kenarı dikiyoruz.`, `Start with red yarn (${brand}) ve kenarı dikiyoruz.`, ["ve kenarı dikiyoruz."]],
    ] as const) {
      const echo = new InspectingProvider();
      expect(await translate(source, echo)).toMatchObject({ translated: expected, valid: true, errors: [] });
      expect(echo.protectedTexts).toEqual(prose);
      const rewritten = await translate(source, providers.rewrite());
      expect(rewritten?.valid).toBe(true);
      expect(rewritten?.translated.startsWith(`Start with ${source.startsWith("Siyah") ? "black" : "red"} yarn (${brand})`)).toBe(true);
    }
  });

  it("keeps notation-like brands opaque on the whole-block provider path and in a formatted block", async () => {
    for (const brand of BRANDS) {
      const intro = `✦ 2.20 numara tığ, Açık gri (${brand}) ip ile örüyoruz.`;
      const text = `${intro}\n1) Sihirli halka içine 6x\n2) 6v = 12x`;
      const expected = `✦ Using a 2.20 mm crochet hook and light gray yarn (${brand}), work as follows.\n1) 6sc into the magic ring\n2) 6inc = 12sc`;
      for (const make of Object.values(providers)) {
        const provider = make();
        const result = await translate(text, provider);
        expect(result?.valid, brand).toBe(true);
        expect(result?.translated.split("\n").slice(1), brand).toEqual(expected.split("\n").slice(1));
        expect(result?.translated, brand).toContain(`yarn (${brand})`);
        // Fully carried since Task 23K-2: nothing is left for the provider.
        expect(provider.requests, brand).toHaveLength(0);
      }
      const echo = new InspectingProvider();
      expect((await translate(text, echo))?.translated).toBe(expected);
      const formatted = await translate(text, new InspectingProvider(), [
        { id: "fmt-0", start: 0, end: intro.length },
        { id: "fmt-1", start: intro.length, end: text.length },
      ]);
      expect(formatted).toMatchObject({ translated: expected, valid: true });
    }
  });

  it("keeps a brand opaque on a mixed tool-intro line and still converts real notation outside it", async () => {
    const source = "2.20 numara tığ, siyah (Alize 3x) ip ile örüyoruz ve 3x örüyoruz.";
    const provider = new InspectingProvider();
    const result = await translate(source, provider);
    expect(result).toMatchObject({
      translated: "Using a 2.20 mm crochet hook and black yarn (Alize 3x), work as follows ve 3sc örüyoruz.",
      valid: true,
    });
    expect(provider.protectedTexts.join(" ")).not.toContain("Alize");
    const yarn = await translate("Kırmızı renk ip (Alize 1v) ile başlıyoruz ve 6v örüyoruz.", new InspectingProvider());
    expect(yarn).toMatchObject({ translated: "Start with red yarn (Alize 1v) ve 6inc örüyoruz.", valid: true });
    const two = await translate(
      "2.20 numara tığ, siyah (Alize 3x) ip ile örüyoruz. 2.20 numara tığ, siyah (Alize 1v) ip ile örüyoruz.",
      new InspectingProvider(),
    );
    expect(two?.translated).toBe(
      "Using a 2.20 mm crochet hook and black yarn (Alize 3x), work as follows. Using a 2.20 mm crochet hook and black yarn (Alize 1v), work as follows.",
    );
  });

  it.each([
    ["2 numara tığ, pamuk ip (Catania) ile örüyoruz.", "Using a 2 mm crochet hook and pamuk Catania yarn, work as follows."],
    ["Bal kabağı; 2.00 numara tığ, simli ip ile örüyoruz.", "Bal kabağı; 2.00 numara tığ, simli ip ile örüyoruz."],
    ["2.20 numara tığ, simli siyah ip (Catania) ile örüyoruz.", undefined],
    ["2.20 numara tığ, Turkuaz (Catania) ip ile örüyoruz.", undefined],
    ["2.20 numara tığ, siyah ip ile örüyoruz.", undefined],
    ["2.20 numara tığ, siyah (Catania ip ile örüyoruz.", undefined],
    ["Yumuşak pamuklu bir ip (Catania gibi) kullanabilirsiniz.", undefined],
  ])("negative control %s keeps the provider path", async (source, echoed) => {
    const provider = new InspectingProvider();
    const result = await translate(source, provider);
    expect(provider.requests.length).toBeGreaterThan(0);
    if (echoed) expect(result?.translated).toBe(echoed);
  });

  it("never lets placeholder syntax or tracking sentinels in a brand become internal tokens", async () => {
    const placeholder = await translate("2.20 numara tığ, siyah (__XQAAAAQX__) ip ile örüyoruz.", new InspectingProvider());
    expect(placeholder).toMatchObject({ translated: "", valid: false });
    expect(placeholder?.errors.map(({ code }) => code)).toContain("DUPLICATE_PROTECTED_NOTATION");
    for (const sentinel of ["\uE000", "\uE001", "\uE002", "\uE003"]) {
      const brand = `Alize ${sentinel}3x`;
      const result = await translate(`2.20 numara tığ, siyah (${brand}) ip ile örüyoruz.`, new InspectingProvider());
      expect(result?.translated).toBe(`Using a 2.20 mm crochet hook and black yarn (${brand}), work as follows.`);
    }
  });

  it("leaves Spanish unchanged", async () => {
    const result = await translateBlocks(
      [{ id: "es", text: "2.20 numara tığ, siyah (Alize 3x) ip ile örüyoruz." }],
      "es",
      { provider: new InspectingProvider() },
    );
    expect(result[0]?.translated).toBe("Con un ganchillo de 2.20 mm y hilo negro (Alize 3pb), tejemos de la siguiente manera.");
  });
});

describe("deterministic spans are carried on fully-resolved and whole-block paths (Task 23K-2)", () => {
  class RewritingProvider extends InspectingProvider {
    constructor(private readonly rewrite: (text: string) => string) {
      super();
    }
    override async translate(request: Parameters<TranslationProvider["translate"]>[0]) {
      this.requests.push(request);
      this.protectedTexts.push(...request.blocks.map(({ text }) => text));
      return { translations: request.blocks.map(({ id, text }) => ({ id, translated: this.rewrite(text) })) };
    }
  }
  // Rewrites every carried English phrase of every family, plus unrelated prose.
  const hostile = (text: string) =>
    text
      .replace(/\bUsing a\b/gu, "Employing a")
      .replace(/crochet hook/gu, "needle")
      .replace(/\b(?:black|red|light gray)\b/gu, "white")
      .replace(/\byarn\b/gu, "thread")
      .replace(/work as follows/gu, "proceed")
      .replace(/Alize|Gazzal|Brand/gu, "acrylic")
      .replace(/\bCh\b/gu, "Chain")
      .replace(/\bch\b/gu, "chain")
      .replace(/\bturn\b/gu, "rotate")
      .replace(/magic ring/gu, "chain space")
      .replace(/\bWork\b/gu, "Crochet")
      .replace(/\bIn\b/gu, "Inside")
      .replace(/\bskip\b/gu, "miss")
      .replace(/Start with/gu, "Begin with")
      .replace(/seventh chain/gu, "chain seven")
      .replace(/kenarı/giu, "EDGE");
  const translate = async (
    text: string,
    provider: InspectingProvider,
    formattingRegions?: { id: string; start: number; end: number }[],
  ) =>
    (await translateBlocks([{ id: "carrier-23k2", text, ...(formattingRegions ? { formattingRegions } : {}) }], "en", { provider }))[0];
  const CARRIED = /Using a|crochet hook|work as follows|Start with|\bCh\b|\bch\b|and turn|magic ring|\bWork\b|\bIn\b|\bskip\b|seventh chain|Alize|Gazzal/u;

  it.each([
    // [source, echoed output, carried text that must survive a hostile provider]
    ["2.20 numara tığ, siyah (Alize Cotton Gold) ip ile örüyoruz ve kenarı dikiyoruz.", "Using a 2.20 mm crochet hook and black yarn (Alize Cotton Gold), work as follows ve kenarı dikiyoruz.", "Using a 2.20 mm crochet hook and black yarn (Alize Cotton Gold), work as follows"],
    ["Önce kenarı dikiyoruz, sonra 2.20 numara tığ, siyah (Alize 3x) ip ile örüyoruz.", "Önce kenarı dikiyoruz, sonra Using a 2.20 mm crochet hook and black yarn (Alize 3x), work as follows.", "Using a 2.20 mm crochet hook and black yarn (Alize 3x), work as follows."],
    ["2.20 numara tığ, siyah (Alize 3x) ip ile örüyoruz ve 3x örüyoruz.", "Using a 2.20 mm crochet hook and black yarn (Alize 3x), work as follows ve 3sc örüyoruz.", "Using a 2.20 mm crochet hook and black yarn (Alize 3x), work as follows ve 3sc"],
    ["2,5 no tığ, Açık gri renk (Brand 3x 1v)ip ile örüyoruz ve kenarı dikiyoruz", "Using a 2,5 mm crochet hook and light gray yarn (Brand 3x 1v), work as follows ve kenarı dikiyoruz", "Using a 2,5 mm crochet hook and light gray yarn (Brand 3x 1v), work as follows"],
    ["2.20 numara tığ, siyah (Alize 3x) ip ile örüyoruz. 1 zincir çekip dönüyoruz. Siyah ip (Gazzal 1v) ile başlıyoruz ve kenarı dikiyoruz.", "Using a 2.20 mm crochet hook and black yarn (Alize 3x), work as follows. Ch 1 and turn. Start with black yarn (Gazzal 1v) ve kenarı dikiyoruz.", "Using a 2.20 mm crochet hook and black yarn (Alize 3x), work as follows. Ch 1 and turn. Start with black yarn (Gazzal 1v) ve"],
    ["2.20 numara tığ, siyah (Alize 3x) ip ile örüyoruz. 2.20 numara tığ, siyah (Alize 1v) ip ile örüyoruz ve kenarı dikiyoruz.", "Using a 2.20 mm crochet hook and black yarn (Alize 3x), work as follows. Using a 2.20 mm crochet hook and black yarn (Alize 1v), work as follows ve kenarı dikiyoruz.", "Using a 2.20 mm crochet hook and black yarn (Alize 3x), work as follows. Using a 2.20 mm crochet hook and black yarn (Alize 1v), work as follows ve"],
  ])("a whole-block tool intro %s keeps its English, hook size and brand while prose stays provider-owned", async (text, echoed, carried) => {
    const echo = new InspectingProvider();
    expect(await translate(text, echo)).toMatchObject({ translated: echoed, valid: true, errors: [] });
    expect(echo.requests).toHaveLength(1);
    expect(echo.protectedTexts.join(" ")).not.toMatch(CARRIED);
    const rewritten = await translate(text, new RewritingProvider(hostile));
    expect(rewritten?.valid).toBe(true);
    expect(rewritten?.translated).toContain(carried);
    if (/kenarı/u.test(echoed)) expect(rewritten?.translated).toContain("EDGE");
  });

  it.each([
    // Each carried family, forced onto the whole-block path by a measurement.
    ["1 zincir çekip dönüyoruz ve 5 cm sonra kenarı dikiyoruz.", "Ch 1 and turn. ve 5 cm sonra kenarı dikiyoruz."],
    ["Yedinci zincirden itibaren 28x örüyoruz ve 5 cm sonra kenarı dikiyoruz.", "Starting from the seventh chain, work 28sc ve 5 cm sonra kenarı dikiyoruz."],
    ["Sihirli halka içine 6x örüyoruz, 2 cm sonra kenarı dikiyoruz.", "6sc into the magic ring örüyoruz, 2 cm sonra kenarı dikiyoruz."],
    ["Kırmızı renk ip (Alize 3x) ile başlıyoruz ve 5 cm sonra kenarı dikiyoruz.", "Start with red yarn (Alize 3x) ve 5 cm sonra kenarı dikiyoruz."],
    ["Bunu dikiyoruz. 6x örüyoruz ve 5 cm sonra kenarı dikiyoruz.", "Bunu dikiyoruz. Work 6sc ve 5 cm sonra kenarı dikiyoruz."],
    ["FLO'dan 6x örüyoruz ve 5 cm sonra kenarı dikiyoruz.", "In FLO, 6sc örüyoruz ve 5 cm sonra kenarı dikiyoruz."],
    ["2) BLO dan (3x, 1v) ve 5 cm sonra kenarı dikiyoruz.", "2) In BLO, (3sc, 1inc) ve 5 cm sonra kenarı dikiyoruz."],
    ["3 zincir çekip 2x atlıyoruz ve 5 cm sonra kenarı dikiyoruz.", "ch 3, skip 2 sts ve 5 cm sonra kenarı dikiyoruz."],
    ["42x - 5 zincir (düğme iliği) dön ve 5 cm sonra kenarı dikiyoruz.", "42sc, ch 5 (buttonhole) and turn ve 5 cm sonra kenarı dikiyoruz."],
  ])("the generic carrier keeps %s out of the whole-block provider request", async (text, echoed) => {
    const echo = new InspectingProvider();
    expect(await translate(text, echo)).toMatchObject({ translated: echoed, valid: true, errors: [] });
    expect(echo.requests).toHaveLength(1);
    expect(echo.protectedTexts.join(" ")).not.toMatch(CARRIED);
    expect(echo.protectedTexts.join(" ")).toContain("kenarı dikiyoruz");
    const rewritten = await translate(text, new RewritingProvider(hostile));
    expect(rewritten).toMatchObject({ translated: echoed.replace("kenarı", "EDGE"), valid: true });
  });

  it("fully-resolved lines stay provider-free and exact, with and without source data", async () => {
    for (const [text, expected] of [
      ["2.20 numara tığ, siyah ip ile (catania 110) örüyoruz.", "Using a 2.20 mm crochet hook and black yarn (catania 110), work as follows."],
      ["◆ 2.20 numara tığ, Açık gri (Alize 3x) ip ile örüyoruz.", "◆ Using a 2.20 mm crochet hook and light gray yarn (Alize 3x), work as follows."],
      ["1 zincir çekip dönüyoruz.", "Ch 1 and turn."],
    ] as const) {
      const provider = new RewritingProvider(hostile);
      expect(await translate(text, provider)).toMatchObject({ translated: expected, valid: true, errors: [] });
      expect(provider.requests).toHaveLength(0);
    }
  });

  it("a fully carried multi-line block needs no provider", async () => {
    const text = "◆ 2.20 numara tığ, Açık gri (Alize 3x) ip ile örüyoruz.\n1) Sihirli halka içine 6x\n2) 1 zincir çekip dönüyoruz.";
    const provider = new RewritingProvider(hostile);
    expect(await translate(text, provider)).toMatchObject({
      translated: "◆ Using a 2.20 mm crochet hook and light gray yarn (Alize 3x), work as follows.\n1) 6sc into the magic ring\n2) Ch 1 and turn.",
      valid: true,
    });
    expect(provider.requests).toHaveLength(0);
  });

  it("fails as before when the provider empties or drops placeholders", async () => {
    for (const text of ["1 zincir çekip dönüyoruz ve 5 cm sonra kenarı dikiyoruz.", "Önce kenarı dikiyoruz, sonra 2.20 numara tığ, siyah (Alize 3x) ip ile örüyoruz."]) {
      for (const rewrite of [() => "", (output: string) => output.replace(/__XQ[A-Z]+QX__\s?/gu, "")]) {
        const result = await translate(text, new RewritingProvider(rewrite));
        expect(result).toMatchObject({ translated: "", valid: false });
        expect(result?.errors.map(({ code }) => code)).toContain("MISSING_PROTECTED_NOTATION");
      }
      const duplicated = await translate(text, new RewritingProvider((output) => output.replace(/(__XQAAAAQX__)/u, "$1 $1")));
      expect(duplicated?.errors.map(({ code }) => code)).toContain("DUPLICATE_PROTECTED_NOTATION");
    }
  });

  it("does not carry when the source already holds placeholder syntax (prior behavior)", async () => {
    const provider = new InspectingProvider();
    const result = await translate("1 zincir çekip dönüyoruz ve __XQAAAAQX__ 5 cm sonra kenarı dikiyoruz.", provider);
    expect(result?.valid).toBe(false);
    expect(provider.protectedTexts).toEqual(["Ch __XQAAAAQX__ and turn. ve __XQAAAAQX__ __XQAAABQX__ sonra kenarı dikiyoruz."]);
  });

  it("keeps formatting units working for a formatted whole-block tool intro", async () => {
    const intro = "✦ 2.20 numara tığ, Açık gri (Alize 3x) ip ile örüyoruz.";
    const text = `${intro} Sonra 5 cm kenarı dikiyoruz.`;
    const provider = new InspectingProvider();
    const result = await translate(text, provider, [
      { id: "fmt-0", start: 0, end: intro.length },
      { id: "fmt-1", start: intro.length, end: text.length },
    ]);
    expect(result?.valid).toBe(true);
    expect(result?.translated.startsWith("✦ Using a 2.20 mm crochet hook and light gray yarn (Alize 3x), work as follows.")).toBe(true);
    expect(result?.targetFormattingRegions?.map(({ id }) => id)).toEqual(["fmt-0", "fmt-1"]);
    expect(provider.protectedTexts.join(" ")).not.toMatch(CARRIED);
  });

  it("leaves Spanish whole-block requests unchanged (no carried spans)", async () => {
    const provider = new InspectingProvider();
    const [result] = await translateBlocks(
      [{ id: "es", text: "1 zincir çekip dönüyoruz ve 5 cm sonra kenarı dikiyoruz." }],
      "es",
      { provider },
    );
    expect(provider.requests).toHaveLength(1);
    expect(provider.protectedTexts.join(" ")).not.toMatch(/__XQAAAAQX__ ve/u);
    expect(result?.valid).toBe(true);
  });
});
