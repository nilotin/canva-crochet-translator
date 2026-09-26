import {
  captureCurrentPageFormattingSnapshotExport,
  serializeCurrentPageFormattingSnapshotExport,
  CurrentPageFormattingSnapshotExportUnavailableError,
} from "../current_page_formatting_snapshot_export";

describe("current-page formatting snapshot export", () => {
  it("is unavailable in production and never reads Canva", async () => {
    const getMetadata = jest.fn();
    const queryCurrentPage = jest.fn();

    await expect(
      captureCurrentPageFormattingSnapshotExport({
        isDevelopment: false,
        getMetadata: getMetadata as never,
        queryCurrentPage: queryCurrentPage as never,
      }),
    ).rejects.toThrow(CurrentPageFormattingSnapshotExportUnavailableError);

    expect(getMetadata).not.toHaveBeenCalled();
    expect(queryCurrentPage).not.toHaveBeenCalled();
  });

  it("captures exact current-page source blocks and formatting regions", async () => {
    const firstText = "2-25) 24 sıra 20x";
    const secondText =
      "26) 13x örüyoruz (kolun üzerindeki dışa doğru kıvırdığımız kısmı öreceğiz).";

    const firstRange = {
      deleted: false,
      readPlaintext: () => firstText,
      readTextRegions: () => [
        {
          text: "2-25)",
          formatting: {
            color: "#c97569",
            fontStyle: "italic",
          },
        },
        {
          text: " 24 sıra 20x",
          formatting: {
            color: "#000000",
          },
        },
      ],
    };

    const secondRange = {
      deleted: false,
      readPlaintext: () => secondText,
      readTextRegions: () => [
        {
          text: "26)",
          formatting: {
            color: "#c97569",
            fontStyle: "italic",
          },
        },
        {
          text: secondText.slice(3),
          formatting: {
            color: "#000000",
          },
        },
      ],
    };

    const getMetadata = jest.fn().mockResolvedValue({
      type: "absolute",
      id: "page-live-14",
      title: "Page 14",
    });

    const queryCurrentPage = jest.fn(async (_options, callback) =>
      callback({
        contents: [firstRange, secondRange],
      }),
    );

    const snapshot = await captureCurrentPageFormattingSnapshotExport({
      isDevelopment: true,
      getMetadata: getMetadata as never,
      queryCurrentPage: queryCurrentPage as never,
    });

    expect(snapshot).toEqual({
      pageId: "page-live-14",
      blocks: [
        {
          order: 0,
          sourceText: firstText,
          formattingRegions: [
            {
              index: 0,
              length: 5,
              text: "2-25)",
              formatting: {
                color: "#c97569",
                fontStyle: "italic",
              },
            },
            {
              index: 5,
              length: 12,
              text: " 24 sıra 20x",
              formatting: {
                color: "#000000",
              },
            },
          ],
        },
        {
          order: 1,
          sourceText: secondText,
          formattingRegions: [
            {
              index: 0,
              length: 3,
              text: "26)",
              formatting: {
                color: "#c97569",
                fontStyle: "italic",
              },
            },
            {
              index: 3,
              length: secondText.length - 3,
              text: secondText.slice(3),
              formatting: {
                color: "#000000",
              },
            },
          ],
        },
      ],
    });

    expect(getMetadata).toHaveBeenCalledTimes(1);
    expect(queryCurrentPage).toHaveBeenCalledTimes(1);
  });

  it("ignores deleted and empty rich-text ranges", async () => {
    const getMetadata = jest.fn().mockResolvedValue({
      type: "absolute",
      id: "page-1",
    });

    const queryCurrentPage = jest.fn(async (_options, callback) =>
      callback({
        contents: [
          {
            deleted: true,
            readPlaintext: () => "deleted",
            readTextRegions: () => [],
          },
          {
            deleted: false,
            readPlaintext: () => "   ",
            readTextRegions: () => [{ text: "   ", formatting: {} }],
          },
          {
            deleted: false,
            readPlaintext: () => "4) 24x",
            readTextRegions: () => [
              { text: "4)", formatting: { fontStyle: "italic" } },
              { text: " 24x", formatting: {} },
            ],
          },
        ],
      }),
    );

    const snapshot = await captureCurrentPageFormattingSnapshotExport({
      isDevelopment: true,
      getMetadata: getMetadata as never,
      queryCurrentPage: queryCurrentPage as never,
    });

    expect(snapshot.blocks).toHaveLength(1);
    expect(snapshot.blocks[0]?.order).toBe(2);
    expect(snapshot.blocks[0]?.sourceText).toBe("4) 24x");
  });

  it("serializes the snapshot without altering formatting data", () => {
    const snapshot = {
      pageId: "page-live-14",
      blocks: [
        {
          order: 0,
          sourceText: "2) 24x",
          formattingRegions: [
            {
              index: 0,
              length: 2,
              text: "2)",
              formatting: { fontStyle: "italic" as const },
            },
            {
              index: 2,
              length: 4,
              text: " 24x",
              formatting: { color: "#000000" },
            },
          ],
        },
      ],
    };

    expect(
      JSON.parse(serializeCurrentPageFormattingSnapshotExport(snapshot)),
    ).toEqual(snapshot);
  });
});
