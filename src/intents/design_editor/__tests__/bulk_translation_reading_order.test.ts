import { translatePendingBulkPages } from "../bulk_translation";
import type { WholeDocumentInventory } from "../whole_document_inventory";
import type { BulkReviewQueue } from "../whole_document_queue";

const inventory: WholeDocumentInventory = {
  pages: [
    {
      pageId: "page-1",
      discoveryIndex: 0,
      locked: false,
      blocks: [
        { id: "a", sourceText: "Kulak", order: 0, readingOrder: 1, formattingRegions: [] },
        { id: "b", sourceText: "Kaş", order: 1, readingOrder: 0, formattingRegions: [] },
      ],
    },
    {
      pageId: "page-2",
      discoveryIndex: 1,
      locked: false,
      blocks: [
        { id: "c", sourceText: "Göz", order: 0, formattingRegions: [] },
        { id: "d", sourceText: "Burun", order: 1, formattingRegions: [] },
      ],
    },
  ],
  skippedPages: [],
};

const queue: BulkReviewQueue = {
  entries: [
    { pageId: "page-1", discoveryIndex: 0, fingerprint: "fp-1", status: "pending", blockIds: ["a", "b"] },
    { pageId: "page-2", discoveryIndex: 1, fingerprint: "fp-2", status: "pending", blockIds: ["c", "d"] },
  ],
  counts: { pending: 2, translating: 0, ready: 0, needs_review: 0, blocked: 0, failed: 0 },
};

describe("bulk translation: readingOrder request metadata", () => {
  it("sends readingOrder only where the page has it, in the unchanged array order", async () => {
    const bodies: { blocks: Record<string, unknown>[] }[] = [];
    const fetcher = jest.fn(async (_url: string, request: RequestInit) => {
      const body = JSON.parse(String(request.body));
      bodies.push(body);
      return {
        ok: true,
        json: async () => ({
          translations: body.blocks.map(({ id, text }: { id: string; text: string }) => ({
            id,
            source: text,
            translated: `${text}-en`,
            valid: true,
            errors: [],
            warnings: [],
          })),
        }),
      };
    });

    const result = await translatePendingBulkPages("en", inventory, queue, {
      fetch: fetcher as unknown as typeof fetch,
      getDesignToken: (async () => ({ token: "design-jwt" })) as never,
      getUserToken: (async () => "user-jwt") as never,
      backendHost: "http://backend",
      saveReview: jest.fn(async () => undefined),
    });

    expect(result.failedPages).toBe(0);
    expect(bodies.map(({ blocks }) => blocks)).toEqual([
      [
        { id: "a", text: "Kulak", formattingRegions: [], readingOrder: 1 },
        { id: "b", text: "Kaş", formattingRegions: [], readingOrder: 0 },
      ],
      [
        { id: "c", text: "Göz", formattingRegions: [] },
        { id: "d", text: "Burun", formattingRegions: [] },
      ],
    ]);
    expect(
      bodies.map(({ blocks }) => blocks.map((block) => "readingOrder" in block)),
    ).toEqual([
      [true, true],
      [false, false],
    ]);
  });
});
