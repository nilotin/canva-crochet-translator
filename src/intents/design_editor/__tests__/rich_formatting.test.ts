import type { RichtextFormatting } from "@canva/design";
import {
  applyPageReview,
  applyProjectedFormatting,
  buildPageReview,
  prepareProjectedFormatting,
  requiresFormattingProjection,
  snapshotFormattingRegions,
  translateCurrentPage,
  type ReviewBlock,
} from "../translation_review";
import { formattingRegionSignature } from "../formatting_freshness";

// Font refs are opaque Canva assets; this fixture represents the source Noto Serif.
const notoSerif = "font-noto-serif" as RichtextFormatting["fontRef"];
const rich: RichtextFormatting = {
  fontRef: notoSerif,
  fontSize: 18,
  letterSpacingEm: 0,
  lineHeightEm: 1.4,
  textAlign: "center",
};
const blockFor = (translated: string): ReviewBlock => ({
  id: "local-block-1",
  source: "ör",
  translated,
  editedTranslation: translated,
  validation: "PASS",
  errors: [],
  warnings: [],
});

it("builds stable signatures from preserved fields and region boundaries", () => {
  const first = formattingRegionSignature([
    {
      index: 0,
      length: 2,
      text: "ör",
      formatting: { color: "#111111", fontRef: notoSerif, fontSize: 18 },
    },
  ]);
  const reorderedProperties = formattingRegionSignature([
    {
      index: 0,
      length: 2,
      text: "ör",
      formatting: { fontSize: 18, fontRef: notoSerif, color: "#111111" },
    },
  ]);

  expect(reorderedProperties).toBe(first);
  expect(
    formattingRegionSignature([
      {
        index: 0,
        length: 1,
        text: "ö",
        formatting: { color: "#111111", fontRef: notoSerif, fontSize: 18 },
      },
      {
        index: 1,
        length: 1,
        text: "r",
        formatting: { color: "#111111", fontRef: notoSerif, fontSize: 18 },
      },
    ]),
  ).not.toBe(first);
  expect(
    formattingRegionSignature([
      {
        index: 0,
        length: 2,
        text: "ör",
        formatting: { color: "#111111", fontRef: notoSerif, fontSize: 12 },
      },
    ]),
  ).not.toBe(first);
});

it.each([true, false])(
  "explicitly restores Noto Serif 18 after Apply with changed length (mapping: %s)",
  async (withMapping) => {
    let text = "ör";
    let actual: RichtextFormatting = { ...rich };
    const content = {
      deleted: false,
      readPlaintext: () => text,
      readTextRegions: () => [{ text, formatting: { ...actual } }],
      replaceText: jest.fn((_bounds, replacement: string) => {
        text = replacement;
        // Simulate Canva losing the inherited font on replacement.
        actual = { fontRef: "font-arimo" as typeof notoSerif, fontSize: 12 };
      }),
      formatParagraph: jest.fn((_bounds, formatting: RichtextFormatting) => {
        actual = { ...actual, ...formatting };
      }),
      formatText: jest.fn(),
    };
    const sync = jest.fn();
    const query = jest.fn(async (_options, callback) =>
      callback({ contents: [content], sync }),
    );
    const contextId = `rich-${withMapping}`;
    const review = await translateCurrentPage("en", contextId, {
      queryCurrentPage: query as never,
      getDesignToken: (async () => ({ token: "token" })) as never,
      getUserToken: (async () => "token") as never,
      fetch: (async () => ({
        ok: true,
        json: async () => ({
          translations: [
            {
              ...blockFor("crochet"),
              valid: true,
              targetFormattingRegions: withMapping
                ? [{ id: "fmt-0", start: 0, end: 7 }]
                : undefined,
            },
          ],
        }),
      })) as never,
    });
    await applyPageReview(
      review,
      { contextId, language: "en" },
      {
        queryCurrentPage: query as never,
        verifyTarget: async () => ({
          isTranslationTarget: true,
          contextId,
          language: "en",
          sourceTitle: "Source",
        }),
      },
    );
    expect(text).toBe("crochet");
    expect(actual).toEqual(rich);
    expect(content.formatParagraph).toHaveBeenCalledWith(
      { index: 0, length: 7 },
      rich,
    );
    expect(content.formatText).toHaveBeenCalledWith(
      { index: 0, length: 7 },
      {},
    );
    expect(content.replaceText.mock.invocationCallOrder[0]).toBeLessThan(
      content.formatParagraph.mock.invocationCallOrder[0] ?? 0,
    );
    expect(sync).toHaveBeenCalledTimes(1);
  },
);

it("preserves distinct paragraph styles and projected inline runs", () => {
  const second = { ...rich, fontSize: 24, textAlign: "start" as const };
  const snapshots = snapshotFormattingRegions([
    { text: "ör", formatting: { ...rich, color: "#ff0000" } },
    { text: "!\n", formatting: { ...rich, fontWeight: "bold" } },
    { text: "bitir", formatting: second },
  ]);
  const block = {
    ...blockFor("crochet now!\nfinish"),
    targetFormattingRegions: [
      { id: "fmt-0", start: 0, end: 7 },
      { id: "fmt-1", start: 7, end: 13 },
      { id: "fmt-2", start: 13, end: 19 },
    ],
  };
  const reference = { formatParagraph: jest.fn(), formatText: jest.fn() };
  applyProjectedFormatting(block, reference, snapshots);
  expect(reference.formatParagraph.mock.calls).toEqual([
    [{ index: 0, length: 13 }, rich],
    [{ index: 13, length: 6 }, second],
  ]);
  expect(reference.formatText.mock.calls).toEqual([
    [{ index: 0, length: 7 }, { color: "#ff0000" }],
    [{ index: 7, length: 6 }, { fontWeight: "bold" }],
    [{ index: 13, length: 6 }, {}],
  ]);
});

it.each([
  "fontRef",
  "fontSize",
  "letterSpacingEm",
  "lineHeightEm",
  "textAlign",
  "listLevel",
  "listMarker",
] as const)("requires projection when only %s differs", (property) => {
  const changed = {
    fontRef: "another-font" as typeof notoSerif,
    fontSize: 24,
    letterSpacingEm: 0.1,
    lineHeightEm: 2,
    textAlign: "end" as const,
    listLevel: 1,
    listMarker: "disc" as const,
  };
  const snapshots = snapshotFormattingRegions([
    { text: "a\n", formatting: rich },
    { text: "b", formatting: { ...rich, [property]: changed[property] } },
  ]);
  expect(requiresFormattingProjection(snapshots)).toBe(true);
  const review = buildPageReview(
    [{ localId: "local-block-1", sourceText: "a\nb", order: 0 }],
    new Map([["local-block-1", snapshots]]),
    { translations: [{ ...blockFor("longer text"), valid: true }] },
  );
  expect(review.reviewStatus).toBe("blocked");
});

it("restores list paragraph formatting after text replacement", () => {
  const listFormatting: RichtextFormatting = {
    ...rich,
    listLevel: 1,
    listMarker: "disc",
  };

  const snapshots = snapshotFormattingRegions([
    { text: "ör", formatting: listFormatting },
  ]);

  const reference = {
    formatParagraph: jest.fn(),
    formatText: jest.fn(),
  };

  applyProjectedFormatting(
    {
      ...blockFor("crochet"),
      targetFormattingRegions: [{ id: "fmt-0", start: 0, end: 7 }],
    },
    reference,
    snapshots,
  );

  expect(reference.formatParagraph).toHaveBeenCalledWith(
    { index: 0, length: 7 },
    listFormatting,
  );
});

it("rejects conflicting rich styles in one target paragraph before mutation", () => {
  const snapshots = snapshotFormattingRegions([
    { text: "a\n", formatting: rich },
    { text: "b", formatting: { ...rich, fontSize: 24 } },
  ]);
  const reference = { formatParagraph: jest.fn(), formatText: jest.fn() };
  expect(() =>
    prepareProjectedFormatting(
      {
        ...blockFor("merged"),
        targetFormattingRegions: [
          { id: "fmt-0", start: 0, end: 3 },
          { id: "fmt-1", start: 3, end: 6 },
        ],
      },
      reference,
      snapshots,
    ),
  ).toThrow("MISSING_MAPPING");
  expect(reference.formatParagraph).not.toHaveBeenCalled();
  expect(reference.formatText).not.toHaveBeenCalled();
});

const partitionSnapshots = () =>
  snapshotFormattingRegions([
    { text: "a", formatting: { ...rich, color: "#ff0000" } },
    { text: "b", formatting: { ...rich, color: "#000000" } },
  ]);

it.each([
  [
    "gap",
    [
      ["fmt-0", 0, 2],
      ["fmt-1", 4, 6],
    ],
  ],
  [
    "overlap",
    [
      ["fmt-0", 0, 4],
      ["fmt-1", 2, 6],
    ],
  ],
  [
    "wrong order",
    [
      ["fmt-1", 0, 3],
      ["fmt-0", 3, 6],
    ],
  ],
  [
    "duplicate IDs",
    [
      ["fmt-0", 0, 3],
      ["fmt-0", 3, 6],
    ],
  ],
  ["missing ID", [["fmt-0", 0, 6]]],
  [
    "unknown ID",
    [
      ["fmt-0", 0, 3],
      ["fmt-2", 3, 6],
    ],
  ],
  [
    "fractional bounds",
    [
      ["fmt-0", 0, 2.5],
      ["fmt-1", 2.5, 6],
    ],
  ],
  [
    "negative bound",
    [
      ["fmt-0", -1, 3],
      ["fmt-1", 3, 6],
    ],
  ],
  [
    "empty region",
    [
      ["fmt-0", 0, 0],
      ["fmt-1", 0, 6],
    ],
  ],
  [
    "out of bounds",
    [
      ["fmt-0", 0, 3],
      ["fmt-1", 3, 7],
    ],
  ],
  [
    "leading gap",
    [
      ["fmt-0", 1, 3],
      ["fmt-1", 3, 6],
    ],
  ],
  [
    "trailing gap",
    [
      ["fmt-0", 0, 3],
      ["fmt-1", 3, 5],
    ],
  ],
] as const)(
  "rejects a multi-style %s during review and Apply preparation",
  (_name, regions) => {
    const snapshots = partitionSnapshots();
    const block = {
      ...blockFor("abcdef"),
      targetFormattingRegions: regions.map(([id, start, end]) => ({
        id,
        start,
        end,
      })),
    };
    const review = buildPageReview(
      [{ localId: block.id, sourceText: "ab", order: 0 }],
      new Map([[block.id, snapshots]]),
      { translations: [{ ...block, valid: true }] },
    );
    expect(review.reviewStatus).toBe("blocked");
    expect(review.blocks[0]?.errors).toContainEqual(
      expect.objectContaining({ code: "FORMATTING_MAPPING_REQUIRED" }),
    );
    const reference = { formatParagraph: jest.fn(), formatText: jest.fn() };
    expect(() =>
      prepareProjectedFormatting(block, reference, snapshots),
    ).toThrow("MISSING_MAPPING");
    expect(() =>
      prepareProjectedFormatting(
        { ...block, editedTranslation: "abcdefg" },
        reference,
        snapshots,
      ),
    ).toThrow("FORMATTING_EDIT_CONFLICT");
    expect(reference.formatParagraph).not.toHaveBeenCalled();
    expect(reference.formatText).not.toHaveBeenCalled();
  },
);

it("accepts a complete ordered multi-style partition during review and Apply", () => {
  const snapshots = partitionSnapshots();
  const block = {
    ...blockFor("abcdef"),
    targetFormattingRegions: [
      { id: "fmt-0", start: 0, end: 3 },
      { id: "fmt-1", start: 3, end: 6 },
    ],
  };
  const review = buildPageReview(
    [{ localId: block.id, sourceText: "ab", order: 0 }],
    new Map([[block.id, snapshots]]),
    { translations: [{ ...block, valid: true }] },
  );
  expect(review.reviewStatus).toBe("ready");
  const reference = { formatParagraph: jest.fn(), formatText: jest.fn() };
  applyProjectedFormatting(block, reference, snapshots);
  expect(reference.formatText.mock.calls).toEqual([
    [{ index: 0, length: 3 }, { color: "#ff0000" }],
    [{ index: 3, length: 3 }, { color: "#000000" }],
  ]);
});
