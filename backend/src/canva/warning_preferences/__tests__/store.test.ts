import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  JsonWarningPreferencesStore,
  MemoryWarningPreferencesStore,
  type PersistedWarningPreferences,
} from "../store.js";

const directories: string[] = [];

const pathForTest = async () => {
  const directory = await mkdtemp(join(tmpdir(), "crochet-warning-preferences-"));
  directories.push(directory);
  return join(directory, "preferences.json");
};

const preferences = (
  overrides: Partial<PersistedWarningPreferences> = {},
): PersistedWarningPreferences => ({
  userId: "user-1",
  targetLanguage: "en",
  autoAcknowledgedWarningCodes: ["MANUAL_REVIEW_RECOMMENDED"],
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

describe("warning preferences store", () => {
  it("restores auto-acknowledged warning codes across JSON store instances", async () => {
    const path = await pathForTest();

    await new JsonWarningPreferencesStore(path).savePreferences(
      preferences(),
    );

    await expect(
      new JsonWarningPreferencesStore(path).getPreferences({
        userId: "user-1",
        targetLanguage: "en",
      }),
    ).resolves.toMatchObject({
      autoAcknowledgedWarningCodes: ["MANUAL_REVIEW_RECOMMENDED"],
    });
  });

  it("replaces preferences for the same user and language (reload/resume)", async () => {
    const store = new MemoryWarningPreferencesStore();

    await store.savePreferences(preferences());
    await store.savePreferences(
      preferences({ updatedAt: new Date().toISOString() }),
    );

    await expect(
      store.getPreferences({ userId: "user-1", targetLanguage: "en" }),
    ).resolves.toMatchObject({
      autoAcknowledgedWarningCodes: ["MANUAL_REVIEW_RECOMMENDED"],
    });
  });

  it("is not scoped to any single Canva design", async () => {
    // The schema itself has no targetDesignId field -- this is a
    // compile-time guarantee as much as a runtime one, but assert the
    // runtime shape too: a saved preference is visible regardless of
    // which target design the user is currently working in.
    const store = new MemoryWarningPreferencesStore();
    await store.savePreferences(preferences());

    await expect(
      store.getPreferences({ userId: "user-1", targetLanguage: "en" }),
    ).resolves.toMatchObject({
      autoAcknowledgedWarningCodes: ["MANUAL_REVIEW_RECOMMENDED"],
    });
  });

  it("isolates users and languages", async () => {
    const store = new MemoryWarningPreferencesStore();
    await store.savePreferences(preferences());

    for (const key of [
      { userId: "user-2", targetLanguage: "en" as const },
      { userId: "user-1", targetLanguage: "es" as const },
    ]) {
      await expect(store.getPreferences(key)).resolves.toBeUndefined();
    }
  });

  it("rejects warning codes outside the eligible allowlist", async () => {
    const store = new MemoryWarningPreferencesStore();

    await expect(
      store.savePreferences({
        ...preferences(),
        // @ts-expect-error -- deliberately invalid for the test
        autoAcknowledgedWarningCodes: ["SEMANTIC_ANCHOR_MISSING"],
      }),
    ).rejects.toThrow();
  });

  it("allows the preference to be cleared explicitly", async () => {
    const store = new MemoryWarningPreferencesStore();

    await store.savePreferences(preferences());
    await store.savePreferences(
      preferences({
        autoAcknowledgedWarningCodes: [],
        updatedAt: new Date().toISOString(),
      }),
    );

    await expect(
      store.getPreferences({ userId: "user-1", targetLanguage: "en" }),
    ).resolves.toMatchObject({ autoAcknowledgedWarningCodes: [] });
  });
});
