import { describe, expect, it } from "vitest";
import {
  getWarningPreferences,
  saveWarningPreferences,
} from "../controller.js";
import { MemoryWarningPreferencesStore } from "../store.js";
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
  const warningPreferencesStore = new MemoryWarningPreferencesStore();

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

  return { copyStore, warningPreferencesStore };
};

describe("warning preferences controller", () => {
  it("saves and restores an approved warning family for a verified target", async () => {
    const stores = await setup();
    const dependencies = { verification: verification(), ...stores };

    await expect(
      saveWarningPreferences(
        dependencies,
        {
          designToken: "target-design-token",
          autoAcknowledgedWarningCodes: ["MANUAL_REVIEW_RECOMMENDED"],
        },
        "Bearer user-token",
      ),
    ).resolves.toEqual({ status: 200, body: { saved: true } });

    const result = await getWarningPreferences(
      dependencies,
      { designToken: "target-design-token" },
      "Bearer user-token",
    );

    expect(result).toMatchObject({
      status: 200,
      body: {
        preferences: {
          autoAcknowledgedWarningCodes: ["MANUAL_REVIEW_RECOMMENDED"],
        },
      },
    });
  });

  it("persists across reload/resume (a fresh get after save)", async () => {
    const stores = await setup();
    const dependencies = { verification: verification(), ...stores };

    await saveWarningPreferences(
      dependencies,
      {
        designToken: "target-design-token",
        autoAcknowledgedWarningCodes: ["MANUAL_REVIEW_RECOMMENDED"],
      },
      "Bearer user-token",
    );

    // Simulate a resumed session: a brand-new get call, same identity.
    const result = await getWarningPreferences(
      { verification: verification(), ...stores },
      { designToken: "target-design-token" },
      "Bearer user-token",
    );

    expect(result).toMatchObject({
      status: 200,
      body: {
        preferences: {
          autoAcknowledgedWarningCodes: ["MANUAL_REVIEW_RECOMMENDED"],
        },
      },
    });
  });

  it("rejects warning codes outside the eligible allowlist at the request boundary", async () => {
    const stores = await setup();

    const result = await saveWarningPreferences(
      { verification: verification(), ...stores },
      {
        designToken: "target-design-token",
        autoAcknowledgedWarningCodes: ["SEMANTIC_ANCHOR_MISSING"],
      },
      "Bearer user-token",
    );

    expect(result.status).toBe(400);
  });

  it("rejects persistence from the source design", async () => {
    const stores = await setup();

    const result = await saveWarningPreferences(
      { verification: verification(), ...stores },
      {
        designToken: "source-design-token",
        autoAcknowledgedWarningCodes: ["MANUAL_REVIEW_RECOMMENDED"],
      },
      "Bearer user-token",
    );

    expect(result.status).toBe(403);
  });

  it("isolates preferences from another user", async () => {
    const stores = await setup();

    await saveWarningPreferences(
      { verification: verification(), ...stores },
      {
        designToken: "target-design-token",
        autoAcknowledgedWarningCodes: ["MANUAL_REVIEW_RECOMMENDED"],
      },
      "Bearer user-token",
    );

    const result = await getWarningPreferences(
      { verification: verification(), ...stores },
      { designToken: "target-design-token" },
      "Bearer other-user-token",
    );

    expect(result.status).toBe(403);
  });

  it("returns 503 when the target is verified but preference storage is unavailable", async () => {
    const { copyStore } = await setup();

    const result = await saveWarningPreferences(
      { verification: verification(), copyStore },
      {
        designToken: "target-design-token",
        autoAcknowledgedWarningCodes: ["MANUAL_REVIEW_RECOMMENDED"],
      },
      "Bearer user-token",
    );

    expect(result).toEqual({
      status: 503,
      body: { error: "Warning-preferences persistence unavailable." },
    });
  });
});
