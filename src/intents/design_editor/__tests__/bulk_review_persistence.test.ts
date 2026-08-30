import {
  loadBulkReview,
  loadBulkReviewSummaries,
  saveBulkReview,
} from "../bulk_review_persistence";
import type { PersistedBulkPageReview } from "../bulk_review_state";

const overrides = (fetcher: jest.Mock) => ({
  getDesignToken: async () =>
    ({
      token: "design-jwt",
    }) as Awaited<ReturnType<typeof import("@canva/design").getDesignToken>>,
  getUserToken: async () =>
    "user-jwt" as Awaited<
      ReturnType<typeof import("@canva/user").auth.getCanvaUserToken>
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
      pipelineRevision: "translation-pipeline-v4",
      status: "ready",
      blocks: review.blocks,
      designToken: "design-jwt",
    });

    expect(init.headers).toMatchObject({
      Authorization: "Bearer user-jwt",
    });
  });
});
