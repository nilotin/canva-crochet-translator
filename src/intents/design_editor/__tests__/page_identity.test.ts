import { getCurrentPageIdentity } from "../page_identity";

describe("current page identity", () => {
  it("uses Canva's stable page ID when available without reading content", async () => {
    const queryCurrentPage = jest.fn();
    await expect(
      getCurrentPageIdentity({
        getMetadata: async () => ({
          type: "absolute",
          id: "page-123" as never,
        }),
        queryCurrentPage: queryCurrentPage as never,
      }),
    ).resolves.toEqual({ key: "page:page-123", source: "canva_page_id" });
    expect(queryCurrentPage).not.toHaveBeenCalled();
  });

  it("falls back to a stable in-session content fingerprint", async () => {
    const queryCurrentPage = jest.fn(async (_options, callback) =>
      callback({
        contents: [
          { deleted: false, readPlaintext: () => "first" },
          { deleted: false, readPlaintext: () => "second" },
        ],
      }),
    );
    const dependencies = {
      getMetadata: async () => ({
        type: "absolute" as const,
        title: "Page title",
        dimensions: { width: 100, height: 200 },
      }),
      queryCurrentPage: queryCurrentPage as never,
    };
    const first = await getCurrentPageIdentity(dependencies);
    const second = await getCurrentPageIdentity(dependencies);
    expect(first).toEqual(second);
    expect(first.source).toBe("content_fingerprint");
  });
});
