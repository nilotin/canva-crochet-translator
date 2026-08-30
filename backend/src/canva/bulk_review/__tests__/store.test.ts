import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BulkReviewStoreError,
  JsonBulkReviewStore,
  type PersistedBulkReview,
} from "../store.js";

const directories: string[] = [];

const pathForTest = async () => {
  const directory = await mkdtemp(join(tmpdir(), "crochet-bulk-review-"));
  directories.push(directory);
  return join(directory, "reviews.json");
};

const review = (
  overrides: Partial<PersistedBulkReview> = {},
): PersistedBulkReview => ({
  userId: "user-1",
  targetDesignId: "target-1",
  targetLanguage: "en",
  pageId: "page-1",
  fingerprint: "page-content-v1-abc",

  pipelineRevision: "translation-pipeline-v4",
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
      targetFormattingRegions: [
        {
          id: "fmt-0",
          start: 0,
          end: 3,
        },
      ],
    },
  ],
  updatedAt: new Date().toISOString(),
  ...overrides,
});

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("durable bulk review store", () => {
  it("restores a bulk review across store instances", async () => {
    const path = await pathForTest();

    await new JsonBulkReviewStore(path).saveReview(
      review({
        status: "needs_review",
        blocks: [
          {
            ...review().blocks[0]!,
            editedTranslation: "Manual edit",
            validation: "WARNING",
          },
        ],
      }),
    );

    const restored = await new JsonBulkReviewStore(path).getReview({
      userId: "user-1",
      targetDesignId: "target-1",
      targetLanguage: "en",
      pageId: "page-1",
    });

    expect(restored).toMatchObject({
      pageId: "page-1",
      fingerprint: "page-content-v1-abc",
      status: "needs_review",
      blocks: [
        {
          editedTranslation: "Manual edit",
          validation: "WARNING",
        },
      ],
    });
  });

  it("replaces the previous review for the same page key", async () => {
    const path = await pathForTest();
    const store = new JsonBulkReviewStore(path);

    await store.saveReview(review());

    await store.saveReview(
      review({
        fingerprint: "page-content-v1-new",
        status: "blocked",
        updatedAt: new Date().toISOString(),
      }),
    );

    const reviews = await new JsonBulkReviewStore(path).listReviews({
      userId: "user-1",
      targetDesignId: "target-1",
      targetLanguage: "en",
    });

    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      fingerprint: "page-content-v1-new",
      status: "blocked",
    });
  });

  it("isolates users, target designs, and languages", async () => {
    const path = await pathForTest();
    const store = new JsonBulkReviewStore(path);

    await store.saveReview(review());

    for (const input of [
      {
        userId: "user-2",
        targetDesignId: "target-1",
        targetLanguage: "en" as const,
      },
      {
        userId: "user-1",
        targetDesignId: "target-2",
        targetLanguage: "en" as const,
      },
      {
        userId: "user-1",
        targetDesignId: "target-1",
        targetLanguage: "es" as const,
      },
    ]) {
      await expect(store.listReviews(input)).resolves.toEqual([]);
    }
  });

  it("handles missing files and rejects corrupt or malformed records", async () => {
    const missing = await pathForTest();

    await expect(
      new JsonBulkReviewStore(missing).listReviews({
        userId: "user",
        targetDesignId: "target",
        targetLanguage: "en",
      }),
    ).resolves.toEqual([]);

    const corrupt = await pathForTest();
    await writeFile(corrupt, "bad-json", "utf8");

    await expect(
      new JsonBulkReviewStore(corrupt).listReviews({
        userId: "user",
        targetDesignId: "target",
        targetLanguage: "en",
      }),
    ).rejects.toBeInstanceOf(BulkReviewStoreError);

    const malformed = await pathForTest();

    await writeFile(
      malformed,
      JSON.stringify({
        version: 1,
        reviews: [{ status: "ready" }],
      }),
      "utf8",
    );

    await expect(
      new JsonBulkReviewStore(malformed).listReviews({
        userId: "user",
        targetDesignId: "target",
        targetLanguage: "en",
      }),
    ).rejects.toBeInstanceOf(BulkReviewStoreError);
  });

  it("persists review content without credentials or provider payloads", async () => {
    const path = await pathForTest();

    await new JsonBulkReviewStore(path).saveReview(
      review({
        blocks: [
          {
            ...review().blocks[0]!,
            editedTranslation: "Edited ear",
          },
        ],
      }),
    );

    const content = await readFile(path, "utf8");

    expect(content).toContain("Edited ear");
    expect(content).toContain('"pipelineRevision": "translation-pipeline-v4"');
    expect(content).not.toMatch(
      /jwt|access.?token|refresh.?token|secret|openai|authorization/iu,
    );
  });
});
