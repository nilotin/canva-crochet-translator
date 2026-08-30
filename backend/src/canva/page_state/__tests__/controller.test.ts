import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MemoryCopyOperationStore } from "../../connect/copy_operation_store.js";
import type { CanvaTokenVerificationService } from "../../token_verification.js";
import {
  getPageTranslationState,
  listPageTranslationStates,
  savePageTranslationState,
} from "../controller.js";
import { MemoryPageTranslationStateStore } from "../store.js";

const verification = (
  designId = "target-design",
  userId = "user-1",
): CanvaTokenVerificationService => ({
  verifyDesignToken: vi.fn().mockResolvedValue({ designId, appId: "app" }),
  verifyUserToken: vi
    .fn()
    .mockResolvedValue({ userId, brandId: "brand", appId: "app" }),
});

const setup = async () => {
  const copyStore = new MemoryCopyOperationStore();
  await copyStore.save({
    operationId: randomUUID(),
    userId: "user-1",
    sourceDesignId: "source-design",
    copiedDesignId: "target-design",
    targetLanguage: "en",
    sourceTitle: "Source",
    editUrl: "https://www.canva.com/design/target-design/edit",
    status: "copy_created",
    createdAt: new Date().toISOString(),
  });
  return {
    copyStore,
    pageStore: new MemoryPageTranslationStateStore(),
  };
};

const reviewBody = {
  designToken: "fresh-design-token",
  pageIdentity: "page:one",
  pipelineRevision: "translation-pipeline-v4",
  sourceSnapshotDigest: "source-digest",
  expectedAppliedSnapshotDigest: "target-digest",
  status: "reviewed" as const,
  blocks: [
    {
      id: "local-block-1",
      source: "6x",
      translated: "6sc",
      editedTranslation: "edited 6sc",
      validation: "PASS" as const,
      errors: [],
      warnings: [],
      targetFormattingRegions: [{ id: "fmt-0", start: 0, end: 3 }],
    },
  ],
};

describe("page-state controller", () => {
  it("saves and returns only the freshly verified target's state", async () => {
    const stores = await setup();
    const dependencies = { verification: verification(), ...stores };
    await expect(
      savePageTranslationState(
        dependencies,
        reviewBody,
        "Bearer fresh-user-token",
      ),
    ).resolves.toMatchObject({ status: 200 });
    const result = await getPageTranslationState(
      dependencies,
      { designToken: "fresh-design-token", pageIdentity: "page:one" },
      "Bearer fresh-user-token",
    );
    expect(result).toMatchObject({
      status: 200,
      body: {
        appliedCount: 0,
        progressSummary: {
          applied: 0,
          reviewed: 1,
          needsReview: 0,
          blocked: 0,
        },
        state: {
          status: "reviewed",
          sourceSnapshotDigest: "source-digest",
          blocks: [
            {
              editedTranslation: "edited 6sc",
              targetFormattingRegions: [{ id: "fmt-0", start: 0, end: 3 }],
            },
          ],
        },
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("user-1");
    expect(JSON.stringify(result.body)).not.toContain("target-design");
    expect(JSON.stringify(result.body)).not.toContain("fresh-");
  });

  it("counts only unique applied page records", async () => {
    const stores = await setup();
    const dependencies = { verification: verification(), ...stores };
    for (const pageIdentity of ["page:one", "page:two"]) {
      await savePageTranslationState(
        dependencies,
        {
          ...reviewBody,
          pageIdentity,
          status: "applied",
          appliedSnapshotDigest: `applied-${pageIdentity}`,
        },
        "Bearer user-token",
      );
    }
    const result = await getPageTranslationState(
      dependencies,
      { designToken: "token", pageIdentity: "page:one" },
      "Bearer user-token",
    );
    expect(result).toMatchObject({
      body: {
        appliedCount: 2,
        progressSummary: {
          applied: 2,
          reviewed: 0,
          needsReview: 0,
          blocked: 0,
        },
      },
    });
  });

  it("lists only lightweight page identities and statuses for the verified target", async () => {
    const stores = await setup();
    const dependencies = { verification: verification(), ...stores };

    await savePageTranslationState(
      dependencies,
      {
        ...reviewBody,
        pageIdentity: "page:first",
        status: "applied",
        appliedSnapshotDigest: "applied-first",
      },
      "Bearer user-token",
    );

    await savePageTranslationState(
      dependencies,
      {
        ...reviewBody,
        pageIdentity: "page:second",
        status: "needs_review",
      },
      "Bearer user-token",
    );

    const result = await listPageTranslationStates(
      dependencies,
      { designToken: "fresh-design-token" },
      "Bearer fresh-user-token",
    );

    expect(result).toEqual({
      status: 200,
      body: {
        states: [
          { pageIdentity: "page:first", status: "applied" },
          { pageIdentity: "page:second", status: "needs_review" },
        ],
      },
    });

    expect(JSON.stringify(result.body)).not.toContain("sourceSnapshotDigest");
    expect(JSON.stringify(result.body)).not.toContain("blocks");
  });

  it("blocks another user, unrelated design, and non-target requests", async () => {
    const stores = await setup();
    for (const service of [
      verification("target-design", "other-user"),
      verification("unrelated-design", "user-1"),
      verification("source-design", "user-1"),
    ]) {
      const result = await savePageTranslationState(
        { verification: service, ...stores },
        reviewBody,
        "Bearer user-token",
      );
      expect(result.status).toBe(403);
    }
    await expect(
      stores.pageStore.listPageStates({
        userId: "user-1",
        targetDesignId: "target-design",
        targetLanguage: "en",
      }),
    ).resolves.toEqual([]);
  });
});
