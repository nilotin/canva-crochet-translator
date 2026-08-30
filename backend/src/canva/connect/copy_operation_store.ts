import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { CopyTargetLanguage } from "./types.js";

const persistedCopyOperationSchema = z
  .object({
    operationId: z.string().uuid(),
    userId: z.string().min(1),
    sourceDesignId: z.string().min(1),
    copiedDesignId: z.string().min(1),
    targetLanguage: z.enum(["en", "es"]),
    sourceTitle: z.string(),
    editUrl: z.string().url(),
    status: z.literal("copy_created"),
    createdAt: z.string().datetime(),
  })
  .strict()
  .refine(
    ({ sourceDesignId, copiedDesignId }) => sourceDesignId !== copiedDesignId,
    {
      message: "A source design cannot be its own translation target.",
    },
  );

const storeFileSchema = z
  .object({
    version: z.literal(1),
    operations: z.array(persistedCopyOperationSchema),
  })
  .strict();

export type PersistedCopyOperation = z.infer<
  typeof persistedCopyOperationSchema
>;

export interface CopyOperationStore {
  findByTargetDesign(input: {
    userId: string;
    targetDesignId: string;
  }): Promise<PersistedCopyOperation | undefined>;
  findBySourceLanguage(input: {
    userId: string;
    sourceDesignId: string;
    targetLanguage: CopyTargetLanguage;
  }): Promise<PersistedCopyOperation | undefined>;
  save(operation: PersistedCopyOperation): Promise<void>;
}

export class CopyOperationStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CopyOperationStoreError";
  }
}

export class MemoryCopyOperationStore implements CopyOperationStore {
  private readonly operations: PersistedCopyOperation[] = [];

  async findByTargetDesign({
    userId,
    targetDesignId,
  }: {
    userId: string;
    targetDesignId: string;
  }) {
    return this.operations.find(
      (operation) =>
        operation.userId === userId &&
        operation.copiedDesignId === targetDesignId &&
        operation.sourceDesignId !== operation.copiedDesignId,
    );
  }

  async findBySourceLanguage({
    userId,
    sourceDesignId,
    targetLanguage,
  }: {
    userId: string;
    sourceDesignId: string;
    targetLanguage: CopyTargetLanguage;
  }) {
    return this.operations.find(
      (operation) =>
        operation.userId === userId &&
        operation.sourceDesignId === sourceDesignId &&
        operation.targetLanguage === targetLanguage &&
        operation.sourceDesignId !== operation.copiedDesignId,
    );
  }

  async save(operation: PersistedCopyOperation): Promise<void> {
    const parsed = persistedCopyOperationSchema.safeParse(operation);

    if (!parsed.success)
      throw new CopyOperationStoreError("Invalid copy operation.");

    const index = this.operations.findIndex(
      (item) =>
        item.userId === parsed.data.userId &&
        item.sourceDesignId === parsed.data.sourceDesignId &&
        item.targetLanguage === parsed.data.targetLanguage,
    );

    if (index === -1) {
      this.operations.push(parsed.data);
    } else {
      this.operations[index] = parsed.data;
    }
  }
}

export class JsonCopyOperationStore implements CopyOperationStore {
  readonly path: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = resolve(path);
  }

  async findByTargetDesign({
    userId,
    targetDesignId,
  }: {
    userId: string;
    targetDesignId: string;
  }) {
    const { operations } = await this.read();
    return operations.find(
      (operation) =>
        operation.userId === userId &&
        operation.copiedDesignId === targetDesignId &&
        operation.sourceDesignId !== operation.copiedDesignId,
    );
  }

  async findBySourceLanguage({
    userId,
    sourceDesignId,
    targetLanguage,
  }: {
    userId: string;
    sourceDesignId: string;
    targetLanguage: CopyTargetLanguage;
  }) {
    const { operations } = await this.read();
    return operations.find(
      (operation) =>
        operation.userId === userId &&
        operation.sourceDesignId === sourceDesignId &&
        operation.targetLanguage === targetLanguage &&
        operation.sourceDesignId !== operation.copiedDesignId,
    );
  }

  async save(operation: PersistedCopyOperation): Promise<void> {
    const parsed = persistedCopyOperationSchema.safeParse(operation);

    if (!parsed.success)
      throw new CopyOperationStoreError("Invalid copy operation.");

    const queued = this.writeQueue.then(async () => {
      const current = await this.read();

      const nextOperations = current.operations.filter(
        (item) =>
          !(
            item.userId === parsed.data.userId &&
            item.sourceDesignId === parsed.data.sourceDesignId &&
            item.targetLanguage === parsed.data.targetLanguage
          ),
      );

      await mkdir(dirname(this.path), { recursive: true });

      const temporaryPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;

      await writeFile(
        temporaryPath,
        `${JSON.stringify(
          {
            version: 1,
            operations: [...nextOperations, parsed.data],
          },
          null,
          2,
        )}\n`,
        { encoding: "utf8", mode: 0o600 },
      );

      await rename(temporaryPath, this.path);
    });

    this.writeQueue = queued.catch(() => undefined);

    return queued;
  }

  private async read() {
    let content: string;
    try {
      content = await readFile(this.path, "utf8");
    } catch (cause) {
      if (
        cause instanceof Error &&
        "code" in cause &&
        cause.code === "ENOENT"
      ) {
        return { version: 1 as const, operations: [] };
      }
      throw new CopyOperationStoreError("Could not read copy-operation store.");
    }
    try {
      return storeFileSchema.parse(JSON.parse(content));
    } catch {
      throw new CopyOperationStoreError("Copy-operation store is corrupt.");
    }
  }
}
