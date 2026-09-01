import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  JsonPageTranslationStateStore,
  PageStateStoreError,
  type PersistedPageTranslationState,
} from "../store.js";

const directories: string[] = [];
const pathForTest = async () => {
  const directory = await mkdtemp(join(tmpdir(), "crochet-page-state-"));
  directories.push(directory);
  return join(directory, "states.json");
};

const state = (
  overrides: Partial<PersistedPageTranslationState> = {},
): PersistedPageTranslationState => ({
  userId: "user-1",
  targetDesignId: "target-1",
  targetLanguage: "en",
  pageIdentity: "page:one",
  sourceSnapshotDigest: "source-digest",
  expectedAppliedSnapshotDigest: "expected-digest",
  status: "reviewed",
  blocks: [
    {
      id: "local-block-1",
      source: "6x",
      translated: "6sc",
      editedTranslation: "6 sc edited",
      validation: "PASS",
      errors: [],
      warnings: [],
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

describe("durable page translation state", () => {
  it.each([
    ["reviewed", "PASS"],
    ["needs_review", "WARNING"],
    ["blocked", "BLOCK"],
  ] as const)(
    "persists %s state and edited text across instances",
    async (status, validation) => {
      const path = await pathForTest();
      const first = new JsonPageTranslationStateStore(path);
      await first.savePageState(
        state({
          status,
          blocks: [
            {
              ...state().blocks[0]!,
              validation,
              editedTranslation: "manual edit",
            },
          ],
        }),
      );
      const restored = await new JsonPageTranslationStateStore(
        path,
      ).getPageState({
        userId: "user-1",
        targetDesignId: "target-1",
        targetLanguage: "en",
        pageIdentity: "page:one",
      });
      expect(restored).toMatchObject({
        status,
        sourceSnapshotDigest: "source-digest",
        blocks: [{ validation, editedTranslation: "manual edit" }],
      });
    },
  );

  it("persists applied digests and counts unique applied pages after restart", async () => {
    const path = await pathForTest();
    const store = new JsonPageTranslationStateStore(path);
    const applied = {
      status: "applied" as const,
      appliedSnapshotDigest: "applied-digest",
      appliedAt: new Date().toISOString(),
    };
    await store.savePageState(state(applied));
    await store.savePageState(
      state({ ...applied, updatedAt: new Date().toISOString() }),
    );
    await store.savePageState(state({ ...applied, pageIdentity: "page:two" }));
    const states = await new JsonPageTranslationStateStore(path).listPageStates(
      {
        userId: "user-1",
        targetDesignId: "target-1",
        targetLanguage: "en",
      },
    );
    expect(states).toHaveLength(2);
    expect(states.filter(({ status }) => status === "applied")).toHaveLength(2);
  });

  it("persists whole-document snapshot mode and accepts legacy records without it", async () => {
    const path = await pathForTest();
    const store = new JsonPageTranslationStateStore(path);

    await store.savePageState(
      state({
        status: "applied",
        snapshotMode: "whole_document",
        appliedSnapshotDigest: "whole-document-digest",
        appliedAt: new Date().toISOString(),
      }),
    );

    await store.savePageState(
      state({
        pageIdentity: "page:legacy",
      }),
    );

    const restored = await new JsonPageTranslationStateStore(
      path,
    ).listPageStates({
      userId: "user-1",
      targetDesignId: "target-1",
      targetLanguage: "en",
    });

    expect(restored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pageIdentity: "page:one",
          snapshotMode: "whole_document",
          appliedSnapshotDigest: "whole-document-digest",
        }),
        expect.objectContaining({
          pageIdentity: "page:legacy",
        }),
      ]),
    );

    const legacy = restored.find(
      ({ pageIdentity }) => pageIdentity === "page:legacy",
    );

    expect(legacy?.snapshotMode).toBeUndefined();
  });

  it("isolates users, target designs, and languages", async () => {
    const path = await pathForTest();
    const store = new JsonPageTranslationStateStore(path);
    await store.savePageState(state());
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
      await expect(store.listPageStates(input)).resolves.toEqual([]);
    }
  });

  it("handles a missing file and rejects corrupt or malformed records", async () => {
    const missing = await pathForTest();
    await expect(
      new JsonPageTranslationStateStore(missing).listPageStates({
        userId: "user",
        targetDesignId: "target",
        targetLanguage: "en",
      }),
    ).resolves.toEqual([]);

    const corrupt = await pathForTest();
    await writeFile(corrupt, "bad-json", "utf8");
    await expect(
      new JsonPageTranslationStateStore(corrupt).listPageStates({
        userId: "user",
        targetDesignId: "target",
        targetLanguage: "en",
      }),
    ).rejects.toBeInstanceOf(PageStateStoreError);

    const malformed = await pathForTest();
    await writeFile(
      malformed,
      JSON.stringify({ version: 1, states: [{ status: "applied" }] }),
      "utf8",
    );
    await expect(
      new JsonPageTranslationStateStore(malformed).listPageStates({
        userId: "user",
        targetDesignId: "target",
        targetLanguage: "en",
      }),
    ).rejects.toBeInstanceOf(PageStateStoreError);
  });

  it("persists design content but no credentials or provider payloads", async () => {
    const path = await pathForTest();
    await new JsonPageTranslationStateStore(path).savePageState(state());
    const content = await readFile(path, "utf8");
    expect(content).toContain("6 sc edited");
    expect(content).not.toMatch(
      /jwt|access.?token|refresh.?token|secret|openai|authorization/iu,
    );
  });
});
