import { describe, expect, it } from "@jest/globals";

import {
  reconcileReviewReadingOrder,
} from "../review_reading_order";
import type {
  CanvaTranslationBlock,
  FormattingRegionSnapshot,
} from "../translation_review";

const live = (
  id: string,
  sourceText: string,
  order: number,
): CanvaTranslationBlock => ({
  localId: id,
  sourceText,
  order,
});

const snapshot = (
  text: string,
  color = "#000000",
): FormattingRegionSnapshot[] => [
  {
    index: 0,
    length: text.length,
    text,
    formatting: { color },
  },
];

const inventory = (
  id: string,
  sourceText: string,
  order: number,
  readingOrder: number | undefined,
  color = "#000000",
) => ({
  id,
  sourceText,
  order,
  formattingRegions: snapshot(sourceText, color),
  ...(readingOrder === undefined ? {} : { readingOrder }),
});

describe("reconcileReviewReadingOrder", () => {
  it("maps trusted inventory reading order onto local review ids", () => {
    const blocks = [
      live("local-block-1", "13) 5 sıra 16x", 0),
      live(
        "local-block-2",
        "12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.",
        1,
      ),
    ];

    const formatting = new Map([
      ["local-block-1", snapshot("13) 5 sıra 16x")],
      [
        "local-block-2",
        snapshot("12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz."),
      ],
    ]);

    const result = reconcileReviewReadingOrder(
      blocks,
      formatting,
      [
        inventory("page-p-block-1", "13) 5 sıra 16x", 0, 1),
        inventory(
          "page-p-block-2",
          "12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.",
          1,
          0,
        ),
      ],
    );

    expect(result).toEqual([
      { ...blocks[0], readingOrder: 1 },
      { ...blocks[1], readingOrder: 0 },
    ]);
  });

  it("does not depend on inventory array order", () => {
    const blocks = [
      live("local-block-1", "A", 0),
      live("local-block-2", "B", 1),
    ];

    const formatting = new Map([
      ["local-block-1", snapshot("A")],
      ["local-block-2", snapshot("B")],
    ]);

    expect(
      reconcileReviewReadingOrder(
        blocks,
        formatting,
        [
          inventory("inventory-b", "B", 1, 0),
          inventory("inventory-a", "A", 0, 1),
        ],
      ),
    ).toEqual([
      { ...blocks[0], readingOrder: 1 },
      { ...blocks[1], readingOrder: 0 },
    ]);
  });

  it("fails closed when inventory reading order is incomplete", () => {
    const blocks = [
      live("local-block-1", "A", 0),
      live("local-block-2", "B", 1),
    ];

    const result = reconcileReviewReadingOrder(
      blocks,
      new Map([
        ["local-block-1", snapshot("A")],
        ["local-block-2", snapshot("B")],
      ]),
      [
        inventory("a", "A", 0, 0),
        inventory("b", "B", 1, undefined),
      ],
    );

    expect(result).toBe(blocks);
  });

  it("fails closed on block-count mismatch", () => {
    const blocks = [
      live("local-block-1", "A", 0),
      live("local-block-2", "B", 1),
    ];

    expect(
      reconcileReviewReadingOrder(
        blocks,
        new Map([
          ["local-block-1", snapshot("A")],
          ["local-block-2", snapshot("B")],
        ]),
        [inventory("a", "A", 0, 0)],
      ),
    ).toBe(blocks);
  });

  it("fails closed on source-text mismatch", () => {
    const blocks = [
      live("local-block-1", "A", 0),
      live("local-block-2", "B", 1),
    ];

    expect(
      reconcileReviewReadingOrder(
        blocks,
        new Map([
          ["local-block-1", snapshot("A")],
          ["local-block-2", snapshot("B")],
        ]),
        [
          inventory("a", "A", 0, 0),
          inventory("b", "changed", 1, 1),
        ],
      ),
    ).toBe(blocks);
  });

  it("fails closed on formatting mismatch", () => {
    const blocks = [
      live("local-block-1", "A", 0),
      live("local-block-2", "B", 1),
    ];

    expect(
      reconcileReviewReadingOrder(
        blocks,
        new Map([
          ["local-block-1", snapshot("A")],
          ["local-block-2", snapshot("B", "#ff0000")],
        ]),
        [
          inventory("a", "A", 0, 0),
          inventory("b", "B", 1, 1),
        ],
      ),
    ).toBe(blocks);
  });

  it("fails closed on duplicate identical fingerprints", () => {
    const blocks = [
      live("local-block-1", "Turn.", 0),
      live("local-block-2", "Turn.", 1),
    ];

    expect(
      reconcileReviewReadingOrder(
        blocks,
        new Map([
          ["local-block-1", snapshot("Turn.")],
          ["local-block-2", snapshot("Turn.")],
        ]),
        [
          inventory("a", "Turn.", 0, 0),
          inventory("b", "Turn.", 1, 1),
        ],
      ),
    ).toBe(blocks);
  });

  it("can disambiguate duplicate text using formatting", () => {
    const blocks = [
      live("local-block-1", "Turn.", 0),
      live("local-block-2", "Turn.", 1),
    ];

    const result = reconcileReviewReadingOrder(
      blocks,
      new Map([
        ["local-block-1", snapshot("Turn.", "#111111")],
        ["local-block-2", snapshot("Turn.", "#222222")],
      ]),
      [
        inventory("a", "Turn.", 0, 1, "#222222"),
        inventory("b", "Turn.", 1, 0, "#111111"),
      ],
    );

    expect(result).toEqual([
      { ...blocks[0], readingOrder: 0 },
      { ...blocks[1], readingOrder: 1 },
    ]);
  });

  it("fails closed when a live formatting snapshot is missing", () => {
    const blocks = [
      live("local-block-1", "A", 0),
      live("local-block-2", "B", 1),
    ];

    expect(
      reconcileReviewReadingOrder(
        blocks,
        new Map([["local-block-1", snapshot("A")]]),
        [
          inventory("a", "A", 0, 0),
          inventory("b", "B", 1, 1),
        ],
      ),
    ).toBe(blocks);
  });

  it("does not mutate either input", () => {
    const blocks = [
      live("local-block-1", "A", 0),
      live("local-block-2", "B", 1),
    ];

    const inventoryBlocks = [
      inventory("a", "A", 0, 0),
      inventory("b", "B", 1, 1),
    ];

    const blocksBefore = JSON.stringify(blocks);
    const inventoryBefore = JSON.stringify(inventoryBlocks);

    reconcileReviewReadingOrder(
      blocks,
      new Map([
        ["local-block-1", snapshot("A")],
        ["local-block-2", snapshot("B")],
      ]),
      inventoryBlocks,
    );

    expect(JSON.stringify(blocks)).toBe(blocksBefore);
    expect(JSON.stringify(inventoryBlocks)).toBe(inventoryBefore);
  });
});
