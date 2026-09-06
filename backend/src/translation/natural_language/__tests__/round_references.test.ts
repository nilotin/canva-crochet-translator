import { describe, expect, it } from "vitest";
import {
  extractRoundReferences,
  renderRoundReference,
} from "../round_references.js";
import {
  protectImmutablePattern,
  restoreImmutablePattern,
} from "../../notation/immutable.js";
import { extractLeadingInstruction } from "../../instruction_marker.js";
import { validateTranslation } from "../../validator.js";
import { translateBlocks } from "../../translator.js";
import type { TranslationProvider } from "../../providers/provider.js";

const cases = [
  ["6. sıra", "Round 6"],
  ["8. sırada", "in Round 8"],
  ["8. sıradan", "from Round 8"],
  ["6. sıranın", "Round 6"],
  ["6. sıranın FLO’su", "the FLO of Round 6"],
  ["6. sıranın FLO’sundan", "the FLO of Round 6"],
  ["6. sıranın flo’ sundan", "the FLO of Round 6"],
  ["6. sıranın FLO' sundan", "the FLO of Round 6"],
  ["6. sıranın Flo’dan", "the FLO of Round 6"],
  ["6. sıranın BLO’su", "the BLO of Round 6"],
  ["6. sıranın BLO’sundan", "the BLO of Round 6"],
  ["6. sıranın BLO’dan", "the BLO of Round 6"],
] as const;

describe("crochet round references", () => {
  it.each(cases)("protects and renders %s as %s", (source, expected) => {
    const references = extractRoundReferences(source);
    expect(references).toHaveLength(1);
    expect(renderRoundReference(references[0]!, "en")).toBe(expected);
    expect(extractLeadingInstruction(source)).toBeUndefined();
    const protectedSource = protectImmutablePattern(source);
    expect(protectedSource.tokens).toHaveLength(1);
    expect(protectedSource.tokens[0]?.kind).toBe("round_reference");
    expect(
      restoreImmutablePattern(protectedSource.text, protectedSource, "en"),
    ).toMatchObject({ valid: true, text: expected });
  });

  it.each([
    "6x",
    "41)",
    "2.20 mm",
    "2.20",
    "6. bölüm",
    "6. örüyoruz",
    "6 sıra",
    "6. sıralı",
  ])("leaves other constructions alone: %s", (source) => {
    expect(extractRoundReferences(source)).toEqual([]);
    expect(
      protectImmutablePattern(source).tokens.some(
        ({ kind }) => kind === "round_reference",
      ),
    ).toBe(false);
  });

  it("preserves instruction markers while distinguishing round references", () => {
    expect(extractLeadingInstruction("41)")?.marker).toBe("41)");
    expect(extractLeadingInstruction("6. örüyoruz")?.marker).toBe("6.");
    expect(
      extractLeadingInstruction("41) 6. sıranın FLO’sundan örüyoruz.")?.body,
    ).toBe("6. sıranın FLO’sundan örüyoruz.");
  });

  it("does not consume a nested stitch/loop clause as a direct round-loop relation", () => {
    expect(
      extractRoundReferences(
        "8. sıranın FLO’dan ördüğümüz sık iğnelerinin BLO’sundan",
      )[0],
    ).toMatchObject({ source: "8. sıranın", relation: "of" });
    expect(
      extractRoundReferences(
        "8. sıranın FLO’dan ördüğümüz sık iğnelerinin BLO’sundan",
      )[0]?.loop,
    ).toBeUndefined();
  });

  it.each([
    [
      "6. sıranın FLO’sundan simli ipimizi sabitliyoruz.",
      "Attach the glitter yarn to ",
      "the FLO of Round 6",
    ],
    ["6. sıranın BLO’sundan örüyoruz.", "Work into ", "the BLO of Round 6"],
    ["8. sırada renk değiştiriyoruz.", "Change color ", "in Round 8"],
  ])(
    "translates a whole sentence with a protected round relation: %s",
    async (source, prefix, meaning) => {
      const provider: TranslationProvider = {
        name: "round-stub",
        model: "stub",
        async checkReadiness() {
          return { ok: true, provider: this.name, model: this.model };
        },
        async translate(request) {
          expect(request.blocks).toHaveLength(1);
          expect(request.blocks[0]?.text).toContain("__XQAAAAQX__");
          const context = JSON.parse(request.userPrompt);
          expect(context.roundReferences).toEqual([
            { placeholder: "__XQAAAAQX__", meaning },
          ]);
          return {
            translations: request.blocks.map(({ id }) => ({
              id,
              translated: `${prefix}__XQAAAAQX__.`,
            })),
          };
        },
      };
      const [result] = await translateBlocks(
        [{ id: "round", text: source }],
        "en",
        { provider },
      );
      expect(result).toMatchObject({
        valid: true,
        translated: `${prefix}${meaning}.`,
        errors: [],
      });
    },
  );

  it.each([
    ["6x", "6sc"],
    ["41)", "41)"],
    ["2.20 mm", "2.20 mm"],
  ])(
    "keeps unrelated deterministic input unchanged in meaning: %s",
    async (text, expected) => {
      const provider: TranslationProvider = {
        name: "unused",
        model: "stub",
        async checkReadiness() {
          return { ok: true, provider: this.name, model: this.model };
        },
        async translate() {
          throw new Error("No natural-language translation expected");
        },
      };
      expect(
        await translateBlocks([{ id: "control", text }], "en", { provider }),
      ).toMatchObject([{ valid: true, translated: expected }]);
    },
  );

  it("renders Round 6: 24sc without a provider call", async () => {
    const provider: TranslationProvider = {
      name: "unused",
      model: "stub",
      async checkReadiness() {
        return { ok: true, provider: this.name, model: this.model };
      },
      async translate() {
        throw new Error("A round heading has no prose to translate");
      },
    };
    expect(
      await translateBlocks([{ id: "heading", text: "6. sıra: 24x" }], "en", {
        provider,
      }),
    ).toMatchObject([{ valid: true, translated: "Round 6: 24sc" }]);
  });

  it.each([
    "6the round FLO secure our glitter yarn.",
    "Work into the 6th round FLO.",
    "Work into Round 6's FLO.",
    "Round 6. Attach the glitter yarn in FLO.",
    "Work into the BLO of Round 6.",
    "Work into the FLO of Round 7.",
    "Work into the FLO of Round 6 and Round 6.",
  ])("rejects a lost or malformed round-loop relation: %s", (translated) => {
    expect(
      validateTranslation("6. sıranın FLO’sundan örüyoruz.", translated, "en")
        .errors,
    ).toContainEqual(
      expect.objectContaining({ code: "ROUND_REFERENCE_MISMATCH" }),
    );
  });

  it.each([
    "Attach the glitter yarn to the FLO of Round 6.",
    "From the FLO of Round 6, work single crochet.",
    "Work into the FLO in Round 6.",
  ])("allows natural surrounding English word order: %s", (translated) => {
    expect(
      validateTranslation("6. sıranın FLO’sundan örüyoruz.", translated, "en")
        .valid,
    ).toBe(true);
  });

  it("preserves the existing Spanish loop vocabulary", () => {
    const source = protectImmutablePattern("6. sıranın FLO’sundan");
    expect(restoreImmutablePattern(source.text, source, "es")).toMatchObject({
      valid: true,
      text: "Flo de la Vuelta 6",
    });
  });

  it("retains measurement and stitch protection alongside a round heading", () => {
    const source = protectImmutablePattern("6. sıra: 24x, 2.20 mm");
    expect(restoreImmutablePattern(source.text, source, "en")).toMatchObject({
      valid: true,
      text: "Round 6: 24sc, 2.20 mm",
    });
  });
});
