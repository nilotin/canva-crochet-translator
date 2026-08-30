import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTargetContext } from "../../target_context.js";
import type { CanvaTokenVerificationService } from "../../token_verification.js";
import {
  CopyOperationStoreError,
  JsonCopyOperationStore,
} from "../copy_operation_store.js";
import { CanvaCopyOperations } from "../copy_operations.js";

const temporaryDirectories: string[] = [];

const createPath = async () => {
  const directory = await mkdtemp(join(tmpdir(), "crochet-copy-store-"));
  temporaryDirectories.push(directory);
  return { directory, path: join(directory, "operations.json") };
};

const verification = (
  designId: string,
  userId = "user-1",
): CanvaTokenVerificationService => ({
  verifyDesignToken: vi.fn().mockResolvedValue({ designId, appId: "app" }),
  verifyUserToken: vi
    .fn()
    .mockResolvedValue({ userId, brandId: "brand", appId: "app" }),
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("durable Canva copy-operation store", () => {
  it.each(["en", "es"] as const)(
    "recognizes a persisted %s target from a fresh store instance",
    async (targetLanguage) => {
      const { path } = await createPath();
      const copier = {
        copyEntireDesign: vi.fn().mockResolvedValue({
          copiedDesignId: `copy-${targetLanguage}`,
          editUrl: `https://www.canva.com/design/copy-${targetLanguage}/edit`,
        }),
      };
      await new CanvaCopyOperations(
        copier,
        new JsonCopyOperationStore(path),
      ).create({
        designId: "source-design",
        userId: "user-1",
        language: targetLanguage,
        sourceTitle: "Masal Doll Turkish",
      });

      const restartedStore = new JsonCopyOperationStore(path);
      const result = await resolveTargetContext(
        verification(`copy-${targetLanguage}`),
        restartedStore,
        { designToken: "fresh-design-token" },
        "Bearer fresh-user-token",
      );
      expect(result).toMatchObject({
        status: 200,
        body: {
          isTranslationTarget: true,
          language: targetLanguage,
          sourceTitle: "Masal Doll Turkish",
          contextId: expect.any(String),
        },
      });
      expect(JSON.stringify(result.body)).not.toContain("copy-");
      expect(JSON.stringify(result.body)).not.toContain("token");
    },
  );

  it("reuses a completed copy after a restart", async () => {
    const { path } = await createPath();
    const firstCopier = {
      copyEntireDesign: vi.fn().mockResolvedValue({
        copiedDesignId: "persisted-copy",
        editUrl: "https://www.canva.com/design/persisted-copy/edit",
      }),
    };
    const input = {
      designId: "source",
      userId: "user",
      language: "en" as const,
      sourceTitle: "Source",
    };
    await new CanvaCopyOperations(
      firstCopier,
      new JsonCopyOperationStore(path),
    ).create(input);
    const restartedCopier = { copyEntireDesign: vi.fn() };
    const result = await new CanvaCopyOperations(
      restartedCopier,
      new JsonCopyOperationStore(path),
    ).create(input);

    expect(result).toMatchObject({
      copiedDesignId: "persisted-copy",
      reused: true,
    });
    expect(restartedCopier.copyEntireDesign).not.toHaveBeenCalled();
  });

  it("does not expose a target to another user, an unrelated design, or its source", async () => {
    const { path } = await createPath();
    const operations = new CanvaCopyOperations(
      {
        copyEntireDesign: vi.fn().mockResolvedValue({
          copiedDesignId: "copy",
          editUrl: "https://www.canva.com/design/copy/edit",
        }),
      },
      new JsonCopyOperationStore(path),
    );
    await operations.create({
      designId: "source",
      userId: "owner",
      language: "en",
    });
    const restarted = new JsonCopyOperationStore(path);
    await expect(
      restarted.findByTargetDesign({ userId: "other", targetDesignId: "copy" }),
    ).resolves.toBeUndefined();
    await expect(
      restarted.findByTargetDesign({
        userId: "owner",
        targetDesignId: "other",
      }),
    ).resolves.toBeUndefined();
    await expect(
      restarted.findByTargetDesign({
        userId: "owner",
        targetDesignId: "source",
      }),
    ).resolves.toBeUndefined();
  });

  it("initializes safely when the store file is missing", async () => {
    const { path } = await createPath();
    await expect(
      new JsonCopyOperationStore(path).findByTargetDesign({
        userId: "user",
        targetDesignId: "design",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a source design being stored as its own target", async () => {
    const { path } = await createPath();
    await expect(
      new JsonCopyOperationStore(path).save({
        operationId: "65f2b47f-b077-47f2-b3f5-d89b91a8fdaa",
        userId: "user",
        sourceDesignId: "same-design",
        copiedDesignId: "same-design",
        targetLanguage: "en",
        sourceTitle: "Source",
        editUrl: "https://www.canva.com/design/same-design/edit",
        status: "copy_created",
        createdAt: new Date().toISOString(),
      }),
    ).rejects.toBeInstanceOf(CopyOperationStoreError);
  });

  it("fails closed when the persisted file is corrupt or malformed", async () => {
    const corrupt = await createPath();
    await writeFile(corrupt.path, "not-json", "utf8");
    await expect(
      new JsonCopyOperationStore(corrupt.path).findByTargetDesign({
        userId: "user",
        targetDesignId: "design",
      }),
    ).rejects.toBeInstanceOf(CopyOperationStoreError);

    const malformed = await createPath();
    await writeFile(
      malformed.path,
      JSON.stringify({
        version: 1,
        operations: [
          {
            operationId: "not-a-uuid",
            userId: "user",
            sourceDesignId: "same",
            copiedDesignId: "same",
            targetLanguage: "en",
            sourceTitle: "Source",
            editUrl: "https://www.canva.com/edit",
            status: "copy_created",
            createdAt: new Date().toISOString(),
          },
        ],
      }),
      "utf8",
    );
    await expect(
      new JsonCopyOperationStore(malformed.path).findByTargetDesign({
        userId: "user",
        targetDesignId: "same",
      }),
    ).rejects.toBeInstanceOf(CopyOperationStoreError);
  });

  it("writes atomically and persists no credentials or tokens", async () => {
    const { directory, path } = await createPath();
    const operations = new CanvaCopyOperations(
      {
        copyEntireDesign: vi.fn().mockResolvedValue({
          copiedDesignId: "copy",
          editUrl: "https://www.canva.com/design/copy/edit",
        }),
      },
      new JsonCopyOperationStore(path),
    );
    await operations.create({
      designId: "source",
      userId: "user",
      language: "es",
      sourceTitle: "Source",
    });
    const content = await readFile(path, "utf8");
    expect(JSON.parse(content)).toMatchObject({
      version: 1,
      operations: [
        {
          status: "copy_created",
          sourceDesignId: "source",
          copiedDesignId: "copy",
          targetLanguage: "es",
        },
      ],
    });
    expect(content).not.toMatch(
      /jwt|access.?token|refresh.?token|secret|openai/iu,
    );
    expect(
      (await readdir(directory)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("does not persist a failed copy as successful", async () => {
    const { path } = await createPath();
    const store = new JsonCopyOperationStore(path);
    const operations = new CanvaCopyOperations(
      { copyEntireDesign: vi.fn().mockRejectedValue(new Error("failed")) },
      store,
    );
    await expect(
      operations.create({
        designId: "source",
        userId: "user",
        language: "en",
      }),
    ).rejects.toThrow("failed");
    await expect(
      store.findBySourceLanguage({
        userId: "user",
        sourceDesignId: "source",
        targetLanguage: "en",
      }),
    ).resolves.toBeUndefined();
  });
});
