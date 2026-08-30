import { describe, expect, it } from "vitest";
import {
  getBulkPreferences,
  saveBulkPreferences,
} from "../controller.js";
import { MemoryBulkPreferencesStore } from "../store.js";
import { MemoryCopyOperationStore } from "../../connect/copy_operation_store.js";

const verification = () =>
  ({
    verifyDesignToken: async (token: string) => ({
      appId: "app-1",
      designId:
        token === "source-design-token" ? "source-1" : "target-1",
    }),
    verifyUserToken: async (token: string) => ({
      appId: "app-1",
      userId: token === "other-user-token" ? "user-2" : "user-1",
      brandId: "brand-1",
    }),
  }) as never;

const setup = async () => {
  const copyStore = new MemoryCopyOperationStore();
  const bulkPreferencesStore = new MemoryBulkPreferencesStore();

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

  return { copyStore, bulkPreferencesStore };
};

describe("bulk preferences controller", () => {
  it("saves and restores exclusions for a verified target", async () => {
    const stores = await setup();
    const dependencies = {
      verification: verification(),
      ...stores,
    };

    await expect(
      saveBulkPreferences(
        dependencies,
        {
          designToken: "target-design-token",
          excludedPageIds: ["page-3", "page-7"],
        },
        "Bearer user-token",
      ),
    ).resolves.toEqual({
      status: 200,
      body: { saved: true },
    });

    const result = await getBulkPreferences(
      dependencies,
      {
        designToken: "target-design-token",
      },
      "Bearer user-token",
    );

    expect(result).toMatchObject({
      status: 200,
      body: {
        preferences: {
          excludedPageIds: ["page-3", "page-7"],
        },
      },
    });
  });

  it("allows exclusions to be cleared", async () => {
    const stores = await setup();
    const dependencies = {
      verification: verification(),
      ...stores,
    };

    await saveBulkPreferences(
      dependencies,
      {
        designToken: "target-design-token",
        excludedPageIds: ["page-3"],
      },
      "Bearer user-token",
    );

    await saveBulkPreferences(
      dependencies,
      {
        designToken: "target-design-token",
        excludedPageIds: [],
      },
      "Bearer user-token",
    );

    const result = await getBulkPreferences(
      dependencies,
      {
        designToken: "target-design-token",
      },
      "Bearer user-token",
    );

    expect(result).toMatchObject({
      status: 200,
      body: {
        preferences: {
          excludedPageIds: [],
        },
      },
    });
  });

  it("rejects persistence from the source design", async () => {
    const stores = await setup();

    const result = await saveBulkPreferences(
      {
        verification: verification(),
        ...stores,
      },
      {
        designToken: "source-design-token",
        excludedPageIds: ["page-3"],
      },
      "Bearer user-token",
    );

    expect(result.status).toBe(403);
  });

  it("isolates preferences from another user", async () => {
    const stores = await setup();

    const result = await getBulkPreferences(
      {
        verification: verification(),
        ...stores,
      },
      {
        designToken: "target-design-token",
      },
      "Bearer other-user-token",
    );

    expect(result.status).toBe(403);
  });
  it("returns 503 when the target is verified but preference storage is unavailable", async () => {
    const { copyStore } = await setup();

    const result = await saveBulkPreferences(
      {
        verification: verification(),
        copyStore,
      },
      {
        designToken: "target-design-token",
        excludedPageIds: ["page-3"],
      },
      "Bearer user-token",
    );

    expect(result).toEqual({
      status: 503,
      body: { error: "Bulk-preferences persistence unavailable." },
    });
  });

});
