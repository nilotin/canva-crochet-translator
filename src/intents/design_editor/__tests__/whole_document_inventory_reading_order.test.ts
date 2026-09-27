import {
  collectTextRangeEntries,
  collectTextRanges,
  readWholeDocumentInventory,
} from "../whole_document_inventory";

const range = (text: string) => ({
  readPlaintext: () => text,
  readTextRegions: () => [{ text, formatting: {} }],
});

type Box = { top?: number; left?: number; width?: number; height?: number; rotation?: number };

const text = (value: string, geometry: Box) => ({
  type: "text",
  text: range(value),
  ...geometry,
});

const group = (geometry: Box, children: unknown[]) => ({
  type: "group",
  ...geometry,
  contents: { toArray: () => children },
});

const readPage = async (elements: unknown[]) => {
  const page = {
    type: "absolute",
    id: "p",
    locked: false,
    elements: { toArray: () => elements },
  };
  const pageRef = { type: "absolute" };
  const openPage = jest.fn(async (_ref, callback) => {
    await callback({ page, helpers: {} });
    return { status: "executed" as const };
  });
  const openDesign = jest.fn(async (_options, callback) => {
    await callback({
      pageRefs: { toArray: () => [pageRef] },
      helpers: { openPage },
      sync: jest.fn(),
    });
  });
  const inventory = await readWholeDocumentInventory({
    openDesign: openDesign as never,
  });
  expect(inventory.pages).toHaveLength(1);
  return inventory.pages.flatMap(({ blocks }) =>
    blocks.map(({ id, sourceText, order, readingOrder }) => ({
      id,
      sourceText,
      order,
      readingOrder,
    })),
  );
};

const column = (top: number, height = 40) => ({ top, left: 20, width: 500, height });

describe("whole document inventory: reading order", () => {
  it("adds readingOrder for a single column in reversed SDK order, keeping order and ids raw", async () => {
    expect(
      await readPage([
        text("13) 5 sıra 16x", column(200)),
        text("12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.", column(100)),
        text("Başlık", column(10)),
      ]),
    ).toEqual([
      { id: "page-p-block-1", sourceText: "13) 5 sıra 16x", order: 0, readingOrder: 2 },
      {
        id: "page-p-block-2",
        sourceText: "12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.",
        order: 1,
        readingOrder: 1,
      },
      { id: "page-p-block-3", sourceText: "Başlık", order: 2, readingOrder: 0 },
    ]);
  });

  it("ranks only the blocks it sends: blank text boxes are skipped and never ordered", async () => {
    const blocks = await readPage([
      text("B", column(100)),
      text("   ", { top: 100, left: 20, width: 500, height: 40 }),
      text("A", column(10)),
    ]);
    expect(blocks.map(({ sourceText, order, readingOrder }) => [sourceText, order, readingOrder])).toEqual([
      ["B", 0, 1],
      ["A", 2, 0],
    ]);
  });

  it("places group children by the group's offset when they lie inside the group", async () => {
    expect(
      (
        await readPage([
          text("Last", column(400)),
          group({ top: 100, left: 20, width: 500, height: 200 }, [
            text("Second", { top: 110, left: 0, width: 500, height: 40 }),
            { type: "shape" },
            text("First", { top: 10, left: 0, width: 500, height: 40 }),
          ]),
        ])
      ).map(({ sourceText, order, readingOrder }) => [sourceText, order, readingOrder]),
    ).toEqual([
      ["Last", 0, 2],
      ["Second", 1, 1],
      ["First", 2, 0],
    ]);
  });

  it.each([
    [
      "two columns",
      [text("Left", { top: 10, left: 0, width: 200, height: 300 }), text("Right", { top: 10, left: 300, width: 200, height: 300 })],
    ],
    ["side-by-side blocks", [text("A", { top: 10, left: 0, width: 200, height: 40 }), text("B", { top: 12, left: 300, width: 200, height: 40 })]],
    ["equal coordinates", [text("A", column(10)), text("B", column(10))]],
    ["missing geometry", [text("A", column(10)), text("B", { top: 100 })]],
    ["a rotated box", [text("A", column(10)), text("B", { ...column(100), rotation: 30 })]],
    [
      "a group child outside the group's box",
      [text("A", column(10)), group({ top: 100, left: 20, width: 500, height: 60 }, [text("B", { top: 400, left: 0, width: 500, height: 40 })])],
    ],
    [
      "a rotated group",
      [text("A", column(10)), group({ top: 100, left: 20, width: 500, height: 60, rotation: 45 }, [text("B", { top: 0, left: 0, width: 500, height: 40 })])],
    ],
  ])("omits readingOrder on every block of the page for %s", async (_label, elements) => {
    const blocks = await readPage(elements);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((block) => !("readingOrder" in block) || block.readingOrder === undefined)).toBe(true);
    expect(blocks.map(({ order }) => order)).toEqual(blocks.map((_block, index) => index));
  });

  it("is deterministic for the same page state", async () => {
    const elements = [text("B", column(100)), text("A", column(10)), text("C", column(200))];
    expect(await readPage(elements)).toEqual(await readPage(elements));
  });

  it("keeps collectTextRanges' SDK order identical to collectTextRangeEntries'", () => {
    const elements = [
      text("x", column(300)),
      group({ top: 0, left: 0, width: 600, height: 200 }, [text("y", column(10)), text("z", column(100))]),
      text("w", column(250)),
    ] as never[];
    expect(collectTextRanges(elements).map((entry) => entry.readPlaintext())).toEqual(["x", "y", "z", "w"]);
    expect(collectTextRangeEntries(elements).map(({ range: entry }) => entry.readPlaintext())).toEqual([
      "x",
      "y",
      "z",
      "w",
    ]);
  });
});
