import {
  buildStaticTemplateTranslationResponse,
  CLOSING,
  CLOSING_TR,
  FRONT_NOTICE,
  FRONT_NOTICE_TR,
  GLOSSARY,
  GLOSSARY_TR,
  INSTRUCTIONS,
  INSTRUCTIONS_TR,
} from "../static_template_translation";
import type { CanvaTranslationBlock } from "../translation_review";
import type { WholeDocumentInventory } from "../whole_document_inventory";

type Page = WholeDocumentInventory["pages"][number];
type Block = Page["blocks"][number];

const block = (
  id: string,
  sourceText: string,
  order: number,
  formattingRegions: Block["formattingRegions"] = [],
): Block => ({ id, sourceText, order, formattingRegions });

const page = (blocks: Block[], discoveryIndex = 0): Page => ({
  pageId: `page-${discoveryIndex}`,
  discoveryIndex,
  locked: false,
  blocks,
});

const translationBlocksFor = (p: Page): CanvaTranslationBlock[] =>
  p.blocks.map((b) => ({ localId: b.id, sourceText: b.sourceText, order: b.order }));

const byId = (translations: ReturnType<typeof buildStaticTemplateTranslationResponse>, id: string) =>
  translations?.translations.find((t) => t.id === id);

const assertNoOverlapsOrOOB = (
  regions: readonly { start: number; end: number }[] | undefined,
  textLength: number,
) => {
  if (!regions) return;
  for (const region of regions) {
    expect(Number.isInteger(region.start)).toBe(true);
    expect(Number.isInteger(region.end)).toBe(true);
    expect(region.start).toBeGreaterThanOrEqual(0);
    expect(region.end).toBeGreaterThanOrEqual(region.start);
    expect(region.end).toBeLessThanOrEqual(textLength);
  }
  const sorted = [...regions].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i += 1) {
    expect(sorted[i]!.start).toBeGreaterThanOrEqual(sorted[i - 1]!.end);
  }
};

describe("buildStaticTemplateTranslationResponse: Page 1 (front cover)", () => {
  const buildPage1 = (title = "BUZU", noticeText = FRONT_NOTICE_TR) =>
    page([
      block("title", title, 0, [{ index: 0, length: title.length, text: title, formatting: {} }]),
      block("notice", noticeText, 1),
    ]);

  it("keeps the pattern title unchanged, byte-for-byte", () => {
    const p = buildPage1("BUZU");
    const result = buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "en");
    expect(byId(result, "title")?.translated).toBe("BUZU");
    expect(byId(result, "title")?.source).toBe("BUZU");
  });

  it("replaces the notice with the exact approved English text", () => {
    const p = buildPage1();
    const result = buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "en");
    expect(byId(result, "notice")?.translated).toBe(FRONT_NOTICE.en);
  });

  it("replaces the notice with the exact approved Spanish text", () => {
    const p = buildPage1();
    const result = buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "es");
    expect(byId(result, "notice")?.translated).toBe(FRONT_NOTICE.es);
  });

  it("still matches when the live source has different internal line-wrap/newline placement", () => {
    const noisyNotice = FRONT_NOTICE_TR.replace(
      "Tarif kişisel kullanım içindir.",
      "Tarif\nkişisel   kullanım\nİçindir.".replace("İçindir", "içindir"),
    );
    const p = buildPage1("BUZU", noisyNotice);
    const result = buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "en");
    expect(byId(result, "notice")?.translated).toBe(FRONT_NOTICE.en);
  });

  it("still matches when the live source uses smart quotes/dashes instead of plain punctuation", () => {
    const noisyNotice = FRONT_NOTICE_TR.replace(/'/gu, "’");
    const p = buildPage1("BUZU", noisyNotice);
    const result = buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "en");
    expect(byId(result, "notice")?.translated).toBe(FRONT_NOTICE.en);
  });

  it("returns valid, non-overlapping, in-bounds target formatting ranges", () => {
    const p = buildPage1();
    const result = buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "en");
    assertNoOverlapsOrOOB(byId(result, "notice")?.targetFormattingRegions, FRONT_NOTICE.en.length);
  });
});

describe("buildStaticTemplateTranslationResponse: Page 2 (materials / instructions / glossary)", () => {
  const MATERIALS_TR =
    "✦ 1 Catania 162 Dark Brown\n✦ 1 Catania 105 Ecru\n✦ 1 Puppets Eldorado C.075";

  const glossaryFormattingRegions = (): Block["formattingRegions"] => {
    const regions: Block["formattingRegions"] = [];
    let cursor = 0;
    for (const line of GLOSSARY_TR.split("\n")) {
      const colon = line.indexOf(":");
      const labelEnd = colon >= 0 ? colon + 1 : line.length;
      regions.push({
        index: cursor,
        length: labelEnd,
        text: line.slice(0, labelEnd),
        formatting: { fontWeight: "bold" },
      });
      regions.push({
        index: cursor + labelEnd,
        length: line.length - labelEnd,
        text: line.slice(labelEnd),
        formatting: {},
      });
      cursor += line.length + 1; // +1 for the "\n" joiner
    }
    return regions;
  };

  const buildPage2 = (
    materialsText = MATERIALS_TR,
    instructionsText = INSTRUCTIONS_TR,
    glossaryText = GLOSSARY_TR,
  ) =>
    page([
      block("materials", materialsText, 0, [
        { index: 0, length: materialsText.length, text: materialsText, formatting: { fontWeight: "bold" } },
      ]),
      block("instructions", instructionsText, 1),
      block("decorative", ".", 2),
      block("glossary", glossaryText, 3, glossaryFormattingRegions()),
    ]);

  it("leaves the materials block completely untouched, byte-for-byte", () => {
    const p = buildPage2();
    const result = buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "en");
    expect(byId(result, "materials")?.translated).toBe(MATERIALS_TR);
    expect(byId(result, "materials")?.source).toBe(MATERIALS_TR);
  });

  it("keeps the materials block's formatting mapping identity/safe (no shifted or invented ranges)", () => {
    const p = buildPage2();
    const result = buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "en");
    const regions = byId(result, "materials")?.targetFormattingRegions;
    expect(regions).toEqual([{ id: "fmt-0", start: 0, end: MATERIALS_TR.length }]);
  });

  it("produces the exact approved English instructions", () => {
    const p = buildPage2();
    const result = buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "en");
    expect(byId(result, "instructions")?.translated).toBe(INSTRUCTIONS.en);
  });

  it("produces the exact approved Spanish instructions", () => {
    const p = buildPage2();
    const result = buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "es");
    expect(byId(result, "instructions")?.translated).toBe(INSTRUCTIONS.es);
  });

  it("produces the exact approved English glossary", () => {
    const p = buildPage2();
    const result = buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "en");
    expect(byId(result, "glossary")?.translated).toBe(GLOSSARY.en);
  });

  it("produces the exact approved Spanish glossary", () => {
    const p = buildPage2();
    const result = buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "es");
    expect(byId(result, "glossary")?.translated).toBe(GLOSSARY.es);
  });

  it("leaves the decorative '.' block unchanged", () => {
    const p = buildPage2();
    const result = buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "en");
    expect(byId(result, "decorative")?.translated).toBe(".");
  });

  it("never produces the normal-pipeline notation-mismatch/manual-review warnings or errors", () => {
    const p = buildPage2();
    const result = buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "en");
    for (const t of result!.translations) {
      expect(t.errors).toEqual([]);
      expect(t.warnings).toEqual([]);
      expect(t.valid).toBe(true);
    }
  });

  it("produces only valid, non-overlapping, in-bounds target formatting ranges for every block", () => {
    const p = buildPage2();
    const result = buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "en");
    assertNoOverlapsOrOOB(byId(result, "materials")?.targetFormattingRegions, MATERIALS_TR.length);
    assertNoOverlapsOrOOB(byId(result, "glossary")?.targetFormattingRegions, GLOSSARY.en.length);
  });

  it("still matches when instructions/glossary have different internal line-wrap placement", () => {
    const noisyInstructions = INSTRUCTIONS_TR.replace(
      "kullanabilirsiniz.",
      "kullanabilirsiniz.\n  ",
    ).trim();
    const p = buildPage2(MATERIALS_TR, noisyInstructions, GLOSSARY_TR);
    const result = buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "en");
    expect(byId(result, "instructions")?.translated).toBe(INSTRUCTIONS.en);
  });

  it("still matches materials-independent of the materials content (pattern-specific)", () => {
    const differentMaterials = "✦ Some completely different pattern's yarn list";
    const p = buildPage2(differentMaterials);
    const result = buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "en");
    expect(byId(result, "materials")?.translated).toBe(differentMaterials);
    expect(byId(result, "instructions")?.translated).toBe(INSTRUCTIONS.en);
    expect(byId(result, "glossary")?.translated).toBe(GLOSSARY.en);
  });


  it("supports the real Canva 3-block Page 2 inventory", () => {
    const p = page([
      block("materials", MATERIALS_TR, 0, [
        {
          index: 0,
          length: MATERIALS_TR.length,
          text: MATERIALS_TR,
          formatting: { fontWeight: "bold" },
        },
      ]),
      block("instructions", INSTRUCTIONS_TR, 1),
      block("glossary", GLOSSARY_TR, 2, glossaryFormattingRegions()),
    ], 1);

    const result = buildStaticTemplateTranslationResponse(
      p,
      translationBlocksFor(p),
      "en",
    );

    expect(result).toBeDefined();
    expect(byId(result, "materials")?.translated).toBe(MATERIALS_TR);
    expect(byId(result, "instructions")?.translated).toBe(INSTRUCTIONS.en);
    expect(byId(result, "glossary")?.translated).toBe(GLOSSARY.en);

    for (const translation of result?.translations ?? []) {
      expect(translation.errors).toEqual([]);
      expect(translation.warnings).toEqual([]);
      expect(translation.valid).toBe(true);
    }
  });
});

describe("buildStaticTemplateTranslationResponse: closing page", () => {
  const buildClosing = (blocks = CLOSING_TR) =>
    page([
      block("headline", blocks[0]!, 0),
      block("body", blocks[1]!, 1),
      block("completed", blocks[2]!, 2),
      block("decorative", blocks[3]!, 3),
    ]);

  it("produces the exact approved English closing text for every fixed block", () => {
    const p = buildClosing();
    const result = buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "en");
    expect(byId(result, "headline")?.translated).toBe(CLOSING.en[0]);
    expect(byId(result, "body")?.translated).toBe(CLOSING.en[1]);
    expect(byId(result, "completed")?.translated).toBe(CLOSING.en[2]);
  });

  it("produces the exact approved Spanish closing text for every fixed block", () => {
    const p = buildClosing();
    const result = buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "es");
    expect(byId(result, "headline")?.translated).toBe(CLOSING.es[0]);
    expect(byId(result, "body")?.translated).toBe(CLOSING.es[1]);
    expect(byId(result, "completed")?.translated).toBe(CLOSING.es[2]);
  });

  it("leaves the decorative '.' block unchanged", () => {
    const p = buildClosing();
    const result = buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "en");
    expect(byId(result, "decorative")?.translated).toBe(".");
  });
});

describe("buildStaticTemplateTranslationResponse: unknown/changed pages fall back safely", () => {
  it("returns undefined for an ordinary pattern page", () => {
    const p = page([
      block("b1", "Kulak", 0),
      block("b2", "6x sık iğne örüyoruz", 1),
    ], 4);
    expect(
      buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "en"),
    ).toBeUndefined();
  });

  it("returns undefined when Page 2's block count doesn't match the known structure", () => {
    const p = page([
      block("materials", "✦ Some yarn", 0),
      block("instructions", INSTRUCTIONS_TR, 1),
    ], 1);
    expect(
      buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "en"),
    ).toBeUndefined();
  });

  it("returns undefined when the closing text has genuinely changed (a different pattern name)", () => {
    const p = page([
      block("headline", "TEBRIKLER!!", 0),
      block("body", CLOSING_TR[1]!.replace("Buzu", "Miki"), 1),
      block("completed", "Miki'yi Tamamladınız!", 2),
      block("decorative", ".", 3),
    ], 8);
    expect(
      buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "en"),
    ).toBeUndefined();
  });

  it("does not incorrectly match a front-cover-shaped page whose second block isn't the real notice", () => {
    const p = page([
      block("title", "SOME OTHER PATTERN", 0),
      block("notice", "This is just some unrelated two-block page.", 1),
    ], 0);
    expect(
      buildStaticTemplateTranslationResponse(p, translationBlocksFor(p), "en"),
    ).toBeUndefined();
  });
});

describe("realistic Canva-style granular glossary formatting regression", () => {
  const granularGlossaryRegions = () => {
    const regions: {
      index: number;
      length: number;
      text: string;
      formatting: { fontWeight?: "bold" };
    }[] = [];

    let cursor = 0;

    for (const line of GLOSSARY_TR.split("\n")) {
      const newlineLength =
        cursor + line.length < GLOSSARY_TR.length ? 1 : 0;

      let local = 0;

      if (line.startsWith("✦")) {
        regions.push({
          index: cursor,
          length: 1,
          text: "✦",
          formatting: {},
        });
        local += 1;
      }

      if (line[local] === " ") {
        regions.push({
          index: cursor + local,
          length: 1,
          text: " ",
          formatting: {},
        });
        local += 1;
      }

      const colon = line.indexOf(":", local);

      if (colon >= 0) {
        const labelLength = colon + 1 - local;

        regions.push({
          index: cursor + local,
          length: labelLength,
          text: line.slice(local, colon + 1),
          formatting: { fontWeight: "bold" },
        });

        local = colon + 1;
      }

      const remainder =
        line.slice(local) + (newlineLength ? "\n" : "");

      if (remainder.length > 0) {
        regions.push({
          index: cursor + local,
          length: remainder.length,
          text: remainder,
          formatting: {},
        });
      }

      cursor += line.length + newlineLength;
    }

    return regions;
  };

  it("projects a granular Canva-like glossary segmentation safely", () => {
    const page = {
      pageId: "realistic-page-2",
      discoveryIndex: 1,
      locked: false,
      blocks: [
        {
          id: "materials",
          sourceText: "pattern-specific materials",
          order: 0,
          formattingRegions: [],
        },
        {
          id: "instructions",
          sourceText: INSTRUCTIONS_TR,
          order: 1,
          formattingRegions: [],
        },
        {
          id: "dot",
          sourceText: ".",
          order: 2,
          formattingRegions: [],
        },
        {
          id: "glossary",
          sourceText: GLOSSARY_TR,
          order: 3,
          formattingRegions: granularGlossaryRegions(),
        },
      ],
    } satisfies WholeDocumentInventory["pages"][number];

    const blocks: CanvaTranslationBlock[] = page.blocks.map((block) => ({
      localId: block.id,
      sourceText: block.sourceText,
      order: block.order,
    }));

    const result = buildStaticTemplateTranslationResponse(page, blocks, "en");
    const glossary = result?.translations.find(
      (translation) => translation.id === "glossary",
    );

    expect(result).toBeDefined();
    expect(glossary?.translated).toBe(GLOSSARY.en);
    expect(glossary?.errors).toEqual([]);
    expect(glossary?.warnings).toEqual([]);

    const regions = glossary?.targetFormattingRegions;
    expect(regions).toBeDefined();
    expect(regions?.length).toBe(granularGlossaryRegions().length);

    for (const region of regions ?? []) {
      expect(Number.isInteger(region.start)).toBe(true);
      expect(Number.isInteger(region.end)).toBe(true);
      expect(region.start).toBeGreaterThanOrEqual(0);
      expect(region.end).toBeGreaterThanOrEqual(region.start);
      expect(region.end).toBeLessThanOrEqual(GLOSSARY.en.length);
    }

    const sorted = [...(regions ?? [])].sort(
      (left, right) => left.start - right.start,
    );

    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index]!.start).toBeGreaterThanOrEqual(
        sorted[index - 1]!.end,
      );
    }
  });
});
