import { readWholeDocumentInventory } from "../whole_document_inventory";

const range = (text: string, regions = [{ text, formatting: {} }]) => ({
  readPlaintext: () => text,
  readTextRegions: () => regions,
});

describe("whole document inventory", () => {
  it("reads supported pages without mutating the design", async () => {
    const sync = jest.fn();

    const firstPage = {
      type: "absolute",
      id: "page-1",
      locked: false,
      elements: {
        toArray: () => [
          {
            type: "text",
            text: range("Top level", [
              {
                text: "Top ",
                formatting: { fontWeight: "bold" },
              },
              {
                text: "level",
                formatting: {},
              },
            ]),
          },
          {
            type: "group",
            contents: {
              toArray: () => [
                {
                  type: "text",
                  text: range("Grouped"),
                },
                {
                  type: "shape",
                },
              ],
            },
          },
          {
            type: "text",
            text: range("   "),
          },
        ],
      },
    };

    const secondPage = {
      type: "absolute",
      id: "page-2",
      locked: true,
      elements: {
        toArray: () => [],
      },
    };

    const pageRefs = [{ type: "absolute" }, { type: "absolute" }];

    const openPage = jest.fn(async (pageRef, callback) => {
      const page = pageRef === pageRefs[0] ? firstPage : secondPage;
      await callback({ page, helpers: {} });
      return { status: "executed" as const };
    });

    const openDesign = jest.fn(async (_options, callback) => {
      await callback({
        pageRefs: {
          toArray: () => pageRefs,
        },
        helpers: { openPage },
        sync,
      });
    });

    const inventory = await readWholeDocumentInventory({
      openDesign: openDesign as never,
    });

    expect(inventory).toEqual({
      pages: [
        {
          pageId: "page-1",
          discoveryIndex: 0,
          locked: false,
          blocks: [
            {
              id: "page-page-1-block-1",
              sourceText: "Top level",
              order: 0,
              formattingRegions: [
                {
                  index: 0,
                  length: 4,
                  text: "Top ",
                  formatting: { fontWeight: "bold" },
                },
                {
                  index: 4,
                  length: 5,
                  text: "level",
                  formatting: {},
                },
              ],
            },
            {
              id: "page-page-1-block-2",
              sourceText: "Grouped",
              order: 1,
              formattingRegions: [
                {
                  index: 0,
                  length: 7,
                  text: "Grouped",
                  formatting: {},
                },
              ],
            },
          ],
        },
        {
          pageId: "page-2",
          discoveryIndex: 1,
          locked: true,
          blocks: [],
        },
      ],
      skippedPages: [],
    });

    expect(openDesign).toHaveBeenCalledWith(
      { type: "all_pages" },
      expect.any(Function),
    );
    expect(openPage).toHaveBeenCalledTimes(2);
    expect(sync).not.toHaveBeenCalled();
  });

  it("records pages that Canva skips", async () => {
    const openDesign = jest.fn(async (_options, callback) => {
      await callback({
        pageRefs: {
          toArray: () => [{ type: "unsupported" }],
        },
        helpers: {
          openPage: async () => ({
            status: "skipped" as const,
            reason: "Unsupported page",
          }),
        },
        sync: jest.fn(),
      });
    });

    await expect(
      readWholeDocumentInventory({
        openDesign: openDesign as never,
      }),
    ).resolves.toEqual({
      pages: [],
      skippedPages: [
        {
          discoveryIndex: 0,
          reason: "Unsupported page",
        },
      ],
    });
  });
});
