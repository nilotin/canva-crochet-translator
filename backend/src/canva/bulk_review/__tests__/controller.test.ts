import { describe, expect, it } from "vitest";
import {
  getBulkReview,
  listBulkReviews,
  saveBulkReview,
} from "../controller.js";
import { MemoryBulkReviewStore } from "../store.js";
import { MemoryCopyOperationStore } from "../../connect/copy_operation_store.js";

const verification = () =>
  ({
    verifyDesignToken: async (token: string) => ({
      designId: token === "source-design-token" ? "source-1" : "target-1",
    }),
    verifyUserToken: async (token: string) => ({
      userId: token === "other-user-token" ? "user-2" : "user-1",
    }),
  }) as never;

const setup = async () => {
  const copyStore = new MemoryCopyOperationStore();
  const bulkReviewStore = new MemoryBulkReviewStore();

  await copyStore.save({
    operationId: "11111111-1111-4111-8111-111111111111",
    userId: "user-1",
    sourceDesignId: "source-1",
    copiedDesignId: "target-1",
    targetLanguage: "en",
    sourceTitle: "Pattern",
    editUrl: "https://example.invalid/edit",
    status: "copy_created",
    createdAt: new Date().toISOString(),
  });

  return { copyStore, bulkReviewStore };
};

const saveBody = {
  designToken: "target-design-token",
  pageId: "page-1",
  fingerprint: "page-content-v1-abc",
  status: "ready" as const,
  blocks: [
    {
      id: "bulk-block-1",
      source: "Kulak",
      translated: "Ear",
      editedTranslation: "Ear",
      validation: "PASS" as const,
      errors: [],
      warnings: [],
    },
  ],
};

describe("bulk review controller", () => {
  it("saves and restores a review for a verified target", async () => {
    const stores = await setup();
    const dependencies = {
      verification: verification(),
      ...stores,
    };

    await expect(
      saveBulkReview(dependencies, saveBody, "Bearer user-token"),
    ).resolves.toEqual({
      status: 200,
      body: { saved: true },
    });

    const result = await getBulkReview(
      dependencies,
      {
        designToken: "target-design-token",
        pageId: "page-1",
      },
      "Bearer user-token",
    );

    expect(result.status).toBe(200);

    expect(result.body).toMatchObject({
      review: {
        pageId: "page-1",
        fingerprint: "page-content-v1-abc",
        status: "ready",
        blocks: [
          {
            source: "Kulak",
            editedTranslation: "Ear",
          },
        ],
      },
    });
  });

  it("returns lightweight summaries from list", async () => {
    const stores = await setup();
    const dependencies = {
      verification: verification(),
      ...stores,
    };

    await saveBulkReview(dependencies, saveBody, "Bearer user-token");

    const result = await listBulkReviews(
      dependencies,
      { designToken: "target-design-token" },
      "Bearer user-token",
    );

    expect(result.status).toBe(200);

    expect(result.body).toMatchObject({
      reviews: [
        {
          pageId: "page-1",
          fingerprint: "page-content-v1-abc",
          status: "ready",
        },
      ],
    });

    expect(JSON.stringify(result.body)).not.toContain('"blocks"');
    expect(JSON.stringify(result.body)).not.toContain('"source"');
    expect(JSON.stringify(result.body)).not.toContain('"translated"');
  });

  it("rejects source designs and unrelated users", async () => {
    const stores = await setup();
    const dependencies = {
      verification: verification(),
      ...stores,
    };

    const sourceResult = await listBulkReviews(
      dependencies,
      { designToken: "source-design-token" },
      "Bearer user-token",
    );

    expect(sourceResult).toEqual({
      status: 403,
      body: { error: "Target not verified." },
    });

    const otherUserResult = await listBulkReviews(
      dependencies,
      { designToken: "target-design-token" },
      "Bearer other-user-token",
    );

    expect(otherUserResult).toEqual({
      status: 403,
      body: { error: "Target not verified." },
    });
  });

  it("rejects malformed save requests", async () => {
    const stores = await setup();

    const result = await saveBulkReview(
      {
        verification: verification(),
        ...stores,
      },
      {
        designToken: "target-design-token",
        pageId: "",
      },
      "Bearer user-token",
    );

    expect(result).toEqual({
      status: 400,
      body: { error: "Invalid request." },
    });
  });
});
