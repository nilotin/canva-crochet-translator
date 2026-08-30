import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  JsonBulkPreferencesStore,
  MemoryBulkPreferencesStore,
  type PersistedBulkPreferences,
} from "../store.js";

const directories: string[] = [];

const pathForTest = async () => {
  const directory = await mkdtemp(join(tmpdir(), "crochet-bulk-preferences-"));
  directories.push(directory);
  return join(directory, "preferences.json");
};

const preferences = (
  overrides: Partial<PersistedBulkPreferences> = {},
): PersistedBulkPreferences => ({
  userId: "user-1",
  targetDesignId: "target-1",
  targetLanguage: "en",
  excludedPageIds: ["page-3", "page-7"],
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

describe("bulk preferences store", () => {
  it("restores excluded page IDs across JSON store instances", async () => {
    const path = await pathForTest();

    await new JsonBulkPreferencesStore(path).savePreferences(preferences());

    await expect(
      new JsonBulkPreferencesStore(path).getPreferences({
        userId: "user-1",
        targetDesignId: "target-1",
        targetLanguage: "en",
      }),
    ).resolves.toMatchObject({
      excludedPageIds: ["page-3", "page-7"],
    });
  });

  it("replaces preferences for the same target and language", async () => {
    const store = new MemoryBulkPreferencesStore();

    await store.savePreferences(preferences());
    await store.savePreferences(
      preferences({
        excludedPageIds: ["page-9"],
        updatedAt: new Date().toISOString(),
      }),
    );

    await expect(
      store.getPreferences({
        userId: "user-1",
        targetDesignId: "target-1",
        targetLanguage: "en",
      }),
    ).resolves.toMatchObject({
      excludedPageIds: ["page-9"],
    });
  });

  it("isolates users, targets, and languages", async () => {
    const store = new MemoryBulkPreferencesStore();
    await store.savePreferences(preferences());

    for (const key of [
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
      await expect(store.getPreferences(key)).resolves.toBeUndefined();
    }
  });

  it("allows exclusions to be cleared explicitly", async () => {
    const store = new MemoryBulkPreferencesStore();

    await store.savePreferences(preferences());
    await store.savePreferences(
      preferences({
        excludedPageIds: [],
        updatedAt: new Date().toISOString(),
      }),
    );

    await expect(
      store.getPreferences({
        userId: "user-1",
        targetDesignId: "target-1",
        targetLanguage: "en",
      }),
    ).resolves.toMatchObject({
      excludedPageIds: [],
    });
  });
});
