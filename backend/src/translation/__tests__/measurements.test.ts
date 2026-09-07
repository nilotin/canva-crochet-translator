import { describe, expect, it } from "vitest";
import {
  extractMeasurements,
  extractSourceMeasurementSpans,
  extractSourceMeasurements,
} from "../measurements.js";
import {
  protectImmutablePattern,
  restoreImmutablePattern,
} from "../notation/immutable.js";
import { validateTranslation } from "../validator.js";
import { translateBlocks } from "../translator.js";
import {
  lexMixedSegment,
  reconstructMixedSource,
  reconstructMixedSegment,
} from "../mixed_segment.js";
import { segmentTranslationBlock } from "../segmentation.js";
import type { TranslationProvider } from "../providers/provider.js";

const sentence =
  "Süet ipimiz yoksa da 55cm tütün rengi ip ile zincir çekip aynı işlemi yapabiliriz.";
const natural =
  "If we don't have suede yarn, we can make a chain with 55 cm of tobacco-colored yarn and do the same.";

describe("atomic measurements", () => {
  it.each([
    "55cm",
    "55 cm",
    "12mm",
    "2.5mm",
    "2.20mm",
    "2.20 mm",
    "18 cm",
    "3.5 cm",
    "2 m",
    "2,20 mm",
  ])("protects %s as one token in both profiles", (source) => {
    for (const profile of ["pattern", "materials"] as const) {
      const protectedSource = protectImmutablePattern(
        `${source} tığ`,
        0,
        profile,
      );
      expect(protectedSource.tokens).toHaveLength(1);
      expect(protectedSource.tokens[0]).toMatchObject({
        kind: "measurement",
        source,
      });
      expect(protectedSource.text).toBe("__XQAAAAQX__ tığ");
      const measurement = extractMeasurements(source)[0];
      expect(
        restoreImmutablePattern("__XQAAAAQX__ hook", protectedSource, "en"),
      ).toMatchObject({
        valid: true,
        text: `${measurement?.value} ${measurement?.unit} hook`,
      });
    }
  });

  it.each([
    "6x",
    "6. sıra",
    "55cats",
    "55cms",
    "55mm2",
    "TR55cm",
    "6 M",
    "2.20.30mm",
  ])(
    "does not recognize unrelated notation or partial identifiers: %s",
    (source) => {
      expect(extractMeasurements(source)).toEqual([]);
      expect(
        protectImmutablePattern(source).tokens.some(
          ({ kind }) => kind === "measurement",
        ),
      ).toBe(false);
    },
  );

  it("keeps standalone stitch counts and round notation", () => {
    const protectedSource = protectImmutablePattern("6. sıra 6x");
    expect(
      restoreImmutablePattern(protectedSource.text, protectedSource, "en"),
    ).toMatchObject({ valid: true, text: "Round 6 6sc" });
  });

  it("restores distinct measurements in source order", () => {
    const protectedSource = protectImmutablePattern("12mm ve 18 cm");
    expect(protectedSource.tokens.map(({ source }) => source)).toEqual([
      "12mm",
      "18 cm",
    ]);
    expect(
      restoreImmutablePattern(
        "__XQAAAAQX__ and __XQAAABQX__",
        protectedSource,
        "en",
      ),
    ).toMatchObject({ valid: true, text: "12 mm and 18 cm" });
    expect(
      restoreImmutablePattern(
        "__XQAAABQX__ and __XQAAAAQX__",
        protectedSource,
        "en",
      ).errors,
    ).toContainEqual(
      expect.objectContaining({ code: "REORDERED_PROTECTED_NOTATION" }),
    );
  });

  it.each([
    "",
    "__XQAAAAQX__ __XQAAAAQX__",
    "__XQAAAAQX__ and 55 cm",
    "55we can chain with cm yarn",
  ])("rejects missing, duplicated, or split restoration: %s", (translated) => {
    expect(
      restoreImmutablePattern(translated, protectImmutablePattern("55cm"), "en")
        .valid,
    ).toBe(false);
  });

  it.each(["pattern", "materials"] as const)(
    "validates measurement integrity in %s",
    (contentKind) => {
      for (const translated of [
        "55we can chain with cm yarn",
        "55 mm yarn",
        "55 yarn",
        "55 cm and 55 cm yarn",
        "55 cmyarn",
      ]) {
        const result = validateTranslation("55cm ip", translated, "en", {
          contentKind,
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({ code: "MEASUREMENT_INTEGRITY_MISMATCH" }),
        );
      }
      expect(
        validateTranslation("55cm ip", "55we can chain with cm yarn", "en", {
          contentKind,
        }).errors.map(({ code }) => code),
      ).not.toContain("NUMBER_MISMATCH");
    },
  );

  it("detects reordered pairs even when numeric order is unchanged", () => {
    expect(
      validateTranslation("12mm ve 12 cm", "12 cm and 12 mm", "en").errors,
    ).toContainEqual(
      expect.objectContaining({ code: "MEASUREMENT_INTEGRITY_MISMATCH" }),
    );
    expect(
      validateTranslation("12mm ve 18 cm", "18 cm and 12 mm", "en").valid,
    ).toBe(false);
    expect(validateTranslation("2.20 mm tığ", "2.2 mm hook", "en").valid).toBe(
      false,
    );
    expect(validateTranslation("2.20mm tığ", "2.20 mm hook", "en").valid).toBe(
      true,
    );
  });

  it("treats a bare numeric hook size as millimeters consistently with the normalizer", () => {
    expect(
      validateTranslation(
        "2.20 tığ ile örüyoruz.",
        "With a 2.20 mm crochet hook, work as follows.",
        "en",
      ).valid,
    ).toBe(true);

    const changed = validateTranslation(
      "2.20 tığ ile örüyoruz.",
      "With a 2.2 mm crochet hook, work as follows.",
      "en",
    );

    expect(changed.valid).toBe(false);
    expect(changed.errors).toContainEqual(
      expect.objectContaining({ code: "MEASUREMENT_INTEGRITY_MISMATCH" }),
    );
  });

  it("does not duplicate an explicit millimeter hook measurement", () => {
    expect(
      extractSourceMeasurements("2.20 mm tığ ile örüyoruz.").map(
        ({ value, unit }) => ({ value, unit }),
      ),
    ).toEqual([{ value: "2.20", unit: "mm" }]);
  });

  it.each(["2.20 tığ", "2.20 mm tığ"])(
    "returns one complete source span for %s",
    (hook) => {
      const source = `${hook} ile örüyoruz.`;
      const spans = extractSourceMeasurementSpans(source);

      expect(spans).toHaveLength(1);
      expect(source.slice(spans[0]?.start, spans[0]?.end)).toBe(hook);
    },
  );

  it("does not treat an arbitrary bare decimal as a hook-size span", () => {
    expect(extractSourceMeasurementSpans("2.20 sıra örüyoruz.")).toEqual([]);
  });

  it("treats Turkish hook-number wording as a millimeter measurement without allowing value changes", () => {
    expect(
      validateTranslation(
        "2.20 numara tığ ile örüyoruz.",
        "With a 2.20 mm crochet hook, work as follows.",
        "en",
      ).valid,
    ).toBe(true);

    const changed = validateTranslation(
      "2.20 numara tığ ile örüyoruz.",
      "With a 2.2 mm crochet hook, work as follows.",
      "en",
    );

    expect(changed.valid).toBe(false);
    expect(changed.errors).toContainEqual(
      expect.objectContaining({ code: "MEASUREMENT_INTEGRITY_MISMATCH" }),
    );
  });

  it("keeps measurement source coverage exact in the mixed lexer", () => {
    const lexed = lexMixedSegment("55cm ip", "en", "mixed");
    expect(lexed.valid).toBe(true);
    expect(lexed.tokens[0]).toMatchObject({
      kind: "measurement",
      sourceText: "55cm",
      text: "55 cm",
      start: 0,
      end: 4,
    });
    expect(reconstructMixedSource(lexed.tokens)).toBe("55cm ip");
    expect(
      reconstructMixedSegment(
        lexed.tokens,
        new Map([["mixed::text-span:0", "yarn"]]),
      ),
    ).toBe("55 cm yarn");
  });

  it.each([false, true])(
    "translates the live sentence as one protected semantic unit (split style: %s)",
    async (splitStyle) => {
      const provider: TranslationProvider = {
        name: "measurement-stub",
        model: "stub",
        async checkReadiness() {
          return { ok: true, provider: this.name, model: this.model };
        },
        async translate(request) {
          expect(request.blocks).toHaveLength(1);
          const block = request.blocks[0];
          expect(block?.text).toBe(sentence.replace("55cm", "__XQAAAAQX__"));
          return {
            translations: [
              {
                id: block?.id ?? "",
                translated: natural.replace("55 cm", "__XQAAAAQX__"),
              },
            ],
          };
        },
      };
      const boundary = sentence.indexOf("cm");
      const [result] = await translateBlocks(
        [
          {
            id: "live",
            text: sentence,
            formattingRegions: splitStyle
              ? [
                  { id: "a", start: 0, end: boundary },
                  { id: "b", start: boundary, end: sentence.length },
                ]
              : undefined,
          },
        ],
        "en",
        { provider },
      );
      expect(result).toMatchObject({
        valid: true,
        translated: natural,
        errors: [],
      });
      expect(result?.translated).not.toContain("55we");
      expect(extractMeasurements(result?.translated ?? "")).toHaveLength(1);
    },
  );

  it("does not segment through a decimal measurement", () => {
    const source = `${"a".repeat(480)}; 2,20 mm ${"b".repeat(100)}`;
    const segments = segmentTranslationBlock(source);
    expect(segments.some(({ text }) => text.includes("2,20 mm"))).toBe(true);
    expect(segments.map(({ text }) => text).join("")).toContain("2,20 mm");
  });
});
