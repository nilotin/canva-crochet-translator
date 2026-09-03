import type { getDesignToken } from "@canva/design";
import type { auth as canvaUserAuth } from "@canva/user";
import {
  loadBulkReview,
  loadBulkReviews,
  loadBulkReviewSummaries,
  saveBulkReview,
} from "../bulk_review_persistence";
import type { PersistedBulkPageReview } from "../bulk_review_state";

const overrides = (fetcher: jest.Mock) => ({
  getDesignToken: async () =>
    ({
      token: "design-jwt",
    }) as Awaited<ReturnType<typeof getDesignToken>>,
  getUserToken: async () =>
    "user-jwt" as Awaited<
      ReturnType<typeof canvaUserAuth.getCanvaUserToken>
    >,
  fetch: fetcher as typeof fetch,
  backendHost: "http://backend",
});

const review: PersistedBulkPageReview = {
  pageId: "page-1",
  fingerprint: "page-content-v1-abc",
  status: "ready",
  blocks: [
    {
      id: "bulk-block-1",
      source: "Kulak",
      translated: "Ear",
      editedTranslation: "Ear",
      validation: "PASS",
      errors: [],
      warnings: [],
    },
  ],
};

describe("bulk review persistence client", () => {
  it("loads a persisted bulk review", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        review: {
          ...review,
          updatedAt: "2026-08-29T20:00:00.000Z",
        },
      }),
    }));

    await expect(loadBulkReview("page-1", overrides(fetcher))).resolves.toEqual(
      review,
    );

    const call = (fetcher.mock.calls as unknown as [string, RequestInit][])[0];
    if (!call) throw new Error("Expected request.");

    const [url, init] = call;

    expect(url).toBe("http://backend/api/canva/bulk-review/get");

    expect(JSON.parse(String(init.body))).toEqual({
      pageId: "page-1",
      designToken: "design-jwt",
    });
  });

  it("loads multiple persisted bulk reviews", async () => {
    const reviewsByPageId = new Map([
      ["page-1", review],
      [
        "page-2",
        {
          ...review,
          pageId: "page-2",
          fingerprint: "page-content-v1-def",
        },
      ],
    ]);

    const fetcher = jest.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        pageId: string;
      };

      const stored = reviewsByPageId.get(body.pageId);

      return {
        ok: true,
        json: async () => ({
          review: stored
            ? {
                ...stored,
                updatedAt: "2026-08-29T20:00:00.000Z",
              }
            : null,
        }),
      };
    });

    await expect(
      loadBulkReviews(["page-1", "page-2"], overrides(fetcher)),
    ).resolves.toEqual([
      review,
      {
        ...review,
        pageId: "page-2",
        fingerprint: "page-content-v1-def",
      },
    ]);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("omits missing persisted reviews from bulk loads", async () => {
    const fetcher = jest.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        pageId: string;
      };

      return {
        ok: true,
        json: async () => ({
          review:
            body.pageId === "page-1"
              ? {
                  ...review,
                  updatedAt: "2026-08-29T20:00:00.000Z",
                }
              : null,
        }),
      };
    });

    await expect(
      loadBulkReviews(["page-1", "missing-page"], overrides(fetcher)),
    ).resolves.toEqual([review]);
  });

  it("loads lightweight bulk review summaries", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        reviews: [
          {
            pageId: "page-1",
            fingerprint: "page-content-v1-abc",
            status: "ready",
            updatedAt: "2026-08-29T20:00:00.000Z",
          },
        ],
      }),
    }));

    await expect(loadBulkReviewSummaries(overrides(fetcher))).resolves.toEqual([
      {
        pageId: "page-1",
        fingerprint: "page-content-v1-abc",
        status: "ready",
        updatedAt: "2026-08-29T20:00:00.000Z",
      },
    ]);
  });

  it("saves bulk reviews with fresh Canva authorization", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({ saved: true }),
    }));

    await saveBulkReview(review, overrides(fetcher));

    const call = (fetcher.mock.calls as unknown as [string, RequestInit][])[0];
    if (!call) throw new Error("Expected request.");

    const [url, init] = call;

    expect(url).toBe("http://backend/api/canva/bulk-review/save");

    expect(JSON.parse(String(init.body))).toEqual({
      pageId: "page-1",
      fingerprint: "page-content-v1-abc",
      pipelineRevision: "translation-pipeline-v6",
      status: "ready",
      acknowledged: false,
      blocks: review.blocks,
      designToken: "design-jwt",
    });

    expect(init.headers).toMatchObject({
      Authorization: "Bearer user-jwt",
    });
  });
});
