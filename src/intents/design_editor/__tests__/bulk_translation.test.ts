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
        {
          id: "bulk-block-1",
          sourceText: "Kulak",
          order: 0,
          formattingRegions: [],
        },
      ],
    },
    {
      pageId: "page-2",
      discoveryIndex: 1,
      locked: false,
      blocks: [
        {
          id: "bulk-block-2",
          sourceText: "Kaş",
          order: 0,
          formattingRegions: [],
        },
      ],
    },
  ],
  skippedPages: [],
};

const queue: BulkReviewQueue = {
  entries: [
    {
      pageId: "page-1",
      discoveryIndex: 0,
      fingerprint: "fp-1",
      status: "pending",
      blockIds: ["bulk-block-1"],
    },
    {
      pageId: "page-2",
      discoveryIndex: 1,
      fingerprint: "fp-2",
      status: "ready",
      blockIds: ["bulk-block-2"],
    },
  ],
  counts: {
    pending: 1,
    translating: 0,
    ready: 1,
    needs_review: 0,
    blocked: 0,
    failed: 0,
  },
};

const translationAuth = {
  getDesignToken: (async () => ({ token: "design-jwt" })) as never,
  getUserToken: (async () => "user-jwt") as never,
};

describe("bulk translation", () => {
  it("translates only pending pages and persists each completed review", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "bulk-block-1",
            source: "Kulak",
            translated: "Ear",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));

    const saveReview = jest.fn(async () => undefined);

    const result = await translatePendingBulkPages("en", inventory, queue, {
      fetch: fetcher as unknown as typeof fetch,
      ...translationAuth,
      backendHost: "http://backend",
      saveReview,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);

    const call = (
      fetcher.mock.calls as unknown as [string, RequestInit][]
    )[0];

    if (!call) throw new Error("Expected a translation request.");

    const [, request] = call;
    const body = JSON.parse(String(request.body));

    expect((request.headers as Record<string, string>).Authorization).toBe(
      "Bearer user-jwt",
    );
    expect(body.designToken).toBe("design-jwt");

    expect(saveReview).toHaveBeenCalledWith({
      pageId: "page-1",
      fingerprint: "fp-1",
      status: "ready",
      blocks: [
        expect.objectContaining({
          id: "bulk-block-1",
          source: "Kulak",
          translated: "Ear",
          editedTranslation: "Ear",
          validation: "PASS",
        }),
      ],
    });

    expect(result.queue.entries.map(({ status }) => status)).toEqual([
      "ready",
      "ready",
    ]);

    expect(result.translatedPages).toBe(1);
    expect(result.failedPages).toBe(0);
  });

  it("sends template candidate metadata to the authenticated backend", async () => {
    const templateInventory: WholeDocumentInventory = {
      pages: [
        {
          pageId: "template-page",
          discoveryIndex: 0,
          locked: false,
          blocks: [
            {
              id: "template-block",
              sourceText: "Synthetic template source",
              order: 0,
              formattingRegions: [],
            },
          ],
        },
      ],
      skippedPages: [],
    };

    const templateQueue: BulkReviewQueue = {
      entries: [
        {
          pageId: "template-page",
          discoveryIndex: 0,
          fingerprint: "page-content-v1-synthetic-template",
          status: "pending",
          blockIds: ["template-block"],
          templateCandidate: true,
        },
      ],
      counts: {
        pending: 1,
        translating: 0,
        ready: 0,
        needs_review: 0,
        blocked: 0,
        failed: 0,
      },
    };

    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "template-block",
            source: "Synthetic template source",
            translated: "Synthetic translated template",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));

    const saveReview = jest.fn(async () => undefined);

    const result = await translatePendingBulkPages(
      "en",
      templateInventory,
      templateQueue,
      {
        fetch: fetcher as unknown as typeof fetch,
        ...translationAuth,
        backendHost: "http://backend",
        saveReview,
      },
    );

    expect(fetcher).toHaveBeenCalledTimes(1);

    const call = (
      fetcher.mock.calls as unknown as [string, RequestInit][]
    )[0];

    if (!call) throw new Error("Expected a translation request.");

    const body = JSON.parse(String(call[1].body));

    expect(body).toMatchObject({
      designToken: "design-jwt",
      targetLanguage: "en",
      templateCandidate: true,
      pageFingerprint: "page-content-v1-synthetic-template",
    });

    expect(result.queue.entries[0]?.status).toBe("ready");
    expect(result.translatedPages).toBe(1);
    expect(result.failedPages).toBe(0);
  });

  it("keeps backend deterministic responses subject to formatting safety checks", async () => {
    const templateInventory: WholeDocumentInventory = {
      pages: [
        {
          pageId: "template-page",
          discoveryIndex: 0,
          locked: false,
          blocks: [
            {
              id: "template-block",
              sourceText: "Synthetic Title",
              order: 0,
              formattingRegions: [
                {
                  index: 0,
                  length: 9,
                  text: "Synthetic",
                  formatting: {
                    fontWeight: "bold",
                  },
                },
                {
                  index: 9,
                  length: 6,
                  text: " Title",
                  formatting: {},
                },
              ],
            },
          ],
        },
      ],
      skippedPages: [],
    };

    const templateQueue: BulkReviewQueue = {
      entries: [
        {
          pageId: "template-page",
          discoveryIndex: 0,
          fingerprint: "page-content-v1-synthetic-template",
          status: "pending",
          blockIds: ["template-block"],
          templateCandidate: true,
        },
      ],
      counts: {
        pending: 1,
        translating: 0,
        ready: 0,
        needs_review: 0,
        blocked: 0,
        failed: 0,
      },
    };

    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "template-block",
            source: "Synthetic Title",
            translated: "Synthetic Heading",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));

    const saveReview = jest.fn(async () => undefined);

    const result = await translatePendingBulkPages(
      "en",
      templateInventory,
      templateQueue,
      {
        fetch: fetcher as unknown as typeof fetch,
        ...translationAuth,
        backendHost: "http://backend",
        saveReview,
      },
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(saveReview).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: "template-page",
        status: "blocked",
        blocks: expect.arrayContaining([
          expect.objectContaining({
            id: "template-block",
            validation: "BLOCK",
            errors: expect.arrayContaining([
              expect.objectContaining({
                code: "FORMATTING_MAPPING_REQUIRED",
              }),
            ]),
          }),
        ]),
      }),
    );

    expect(result.queue.entries[0]?.status).toBe("blocked");
  });

  it("continues after a failed pending page", async () => {
    const twoPending: BulkReviewQueue = {
      entries: queue.entries.map((entry) => ({
        ...entry,
        status: "pending" as const,
      })),
      counts: {
        pending: 2,
        translating: 0,
        ready: 0,
        needs_review: 0,
        blocked: 0,
        failed: 0,
      },
    };

    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          translations: [
            {
              id: "bulk-block-2",
              source: "Kaş",
              translated: "Eyebrow",
              valid: true,
              errors: [],
              warnings: [],
            },
          ],
        }),
      });

    const saveReview = jest.fn(async () => undefined);

    const result = await translatePendingBulkPages(
      "en",
      inventory,
      twoPending,
      {
        fetch: fetcher as unknown as typeof fetch,
      ...translationAuth,
        backendHost: "http://backend",
        saveReview,
      },
    );

    expect(result.queue.entries.map(({ status }) => status)).toEqual([
      "failed",
      "ready",
    ]);

    expect(result.translatedPages).toBe(1);
    expect(result.failedPages).toBe(1);
    expect(saveReview).toHaveBeenCalledTimes(1);
  });

  it("marks persistence failure as failed instead of pretending the page is resumable", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "bulk-block-1",
            source: "Kulak",
            translated: "Ear",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));

    const result = await translatePendingBulkPages("en", inventory, queue, {
      fetch: fetcher as unknown as typeof fetch,
      ...translationAuth,
      backendHost: "http://backend",
      saveReview: async () => {
        throw new Error("Persistence unavailable.");
      },
    });

    expect(result.queue.entries[0]?.status).toBe("failed");
    expect(result.translatedPages).toBe(0);
    expect(result.failedPages).toBe(1);
  });
});
