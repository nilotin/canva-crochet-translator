import type { RichtextFormatting } from "@canva/design";
import {
  applyPageReview,
  translateCurrentPage,
  planProjectedFormatting,
  snapshotFormattingRegions,
} from "../translation_review";

const base: RichtextFormatting = {
  fontRef: "noto-serif" as RichtextFormatting["fontRef"],
  fontSize: 18,
};
const source = "SOL kırmızı SAĞ";
const formatting = [
  { ...base, color: "#000000" },
  { ...base, color: "#ff0000", fontWeight: "bold" as const },
  { ...base, color: "#000000" },
];
const setup = async (edited: string) => {
  const content = {
    deleted: false,
    readPlaintext: () => source,
    readTextRegions: () => [
      { text: "SOL ", formatting: formatting[0] },
      { text: "kırmızı ", formatting: formatting[1] },
      { text: "SAĞ", formatting: formatting[2] },
    ],
    replaceText: jest.fn(),
    formatText: jest.fn(),
    formatParagraph: jest.fn(),
  };
  const sync = jest.fn();
  const query = jest.fn(async (_options, callback) =>
    callback({ contents: [content], sync }),
  );
  const contextId = `manual-${edited}`;
  const review = await translateCurrentPage("en", contextId, {
    queryCurrentPage: query as never,
    getDesignToken: (async () => ({ token: "token" })) as never,
    getUserToken: (async () => "token") as never,
    fetch: (async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "local-block-1",
            source,
            translated: "LEFT red RIGHT",
            valid: true,
            errors: [],
            warnings: [],
            targetFormattingRegions: [
              { id: "fmt-0", start: 0, end: 5 },
              { id: "fmt-1", start: 5, end: 9 },
              { id: "fmt-2", start: 9, end: 14 },
            ],
          },
        ],
      }),
    })) as never,
  });
  const block = review.blocks[0];
  if (!block) throw new Error("Expected block");
  block.editedTranslation = edited;
  const apply = () =>
    applyPageReview(
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
  return { content, sync, apply };
};

it.each([
  ["LEFT blue RIGHT", 10],
  ["LEFT reddish RIGHT", 13],
  ["LEFT rd RIGHT", 8],
])(
  "applies manual edits with rich and inline formatting: %s",
  async (edited, boundary) => {
    const { content, sync, apply } = await setup(edited);
    await apply();
    expect(content.replaceText).toHaveBeenCalledWith(
      { index: 0, length: source.length },
      edited,
    );
    expect(content.formatText.mock.calls).toEqual([
      [{ index: 0, length: 5 }, { color: "#000000" }],
      [
        { index: 5, length: boundary - 5 },
        { color: "#ff0000", fontWeight: "bold" },
      ],
      [
        { index: boundary, length: edited.length - boundary },
        { color: "#000000" },
      ],
    ]);
    expect(content.formatParagraph).toHaveBeenCalledWith(
      { index: 0, length: edited.length },
      base,
    );
    expect(sync).toHaveBeenCalledTimes(1);
  },
);

it("rejects ambiguous edits with structured details before any Canva mutation", async () => {
  const { content, sync, apply } = await setup("completely rewritten");
  await expect(apply()).rejects.toMatchObject({
    code: "FORMATTING_EDIT_CONFLICT",
    details: { blockId: "local-block-1", reason: expect.any(String) },
  });
  expect(content.replaceText).not.toHaveBeenCalled();
  expect(content.formatParagraph).not.toHaveBeenCalled();
  expect(content.formatText).not.toHaveBeenCalled();
  expect(sync).not.toHaveBeenCalled();
});

it("rejects a manual paragraph merge that would overwrite rich styles", () => {
  expect(() =>
    planProjectedFormatting(
      {
        id: "block",
        source: "a\nb",
        translated: "a\nb",
        editedTranslation: "ab",
        validation: "PASS",
        errors: [],
        warnings: [],
        targetFormattingRegions: [
          { id: "fmt-0", start: 0, end: 2 },
          { id: "fmt-1", start: 2, end: 3 },
        ],
      },
      snapshotFormattingRegions([
        { text: "a\n", formatting: base },
        { text: "b", formatting: { ...base, fontSize: 24 } },
      ]),
    ),
  ).toThrow("FORMATTING_EDIT_CONFLICT");
});
