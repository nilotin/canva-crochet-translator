import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

export const persistedBulkPreferencesSchema = z
  .object({
    userId: z.string().min(1),
    targetDesignId: z.string().min(1),
    targetLanguage: z.enum(["en", "es"]),
    excludedPageIds: z.array(z.string().min(1).max(500)).max(10_000),
    updatedAt: z.string().datetime(),
  })
  .strict();

const fileSchema = z
  .object({
    version: z.literal(1),
    preferences: z.array(persistedBulkPreferencesSchema),
  })
  .strict();

export type PersistedBulkPreferences = z.infer<
  typeof persistedBulkPreferencesSchema
>;

export type BulkPreferencesKey = {
  userId: string;
  targetDesignId: string;
  targetLanguage: "en" | "es";
};

export interface BulkPreferencesStore {
  getPreferences(
    input: BulkPreferencesKey,
  ): Promise<PersistedBulkPreferences | undefined>;

  savePreferences(preferences: PersistedBulkPreferences): Promise<void>;
}

export class BulkPreferencesStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BulkPreferencesStoreError";
  }
}

const keyMatches = (
  preferences: PersistedBulkPreferences,
  input: BulkPreferencesKey,
): boolean =>
  preferences.userId === input.userId &&
  preferences.targetDesignId === input.targetDesignId &&
  preferences.targetLanguage === input.targetLanguage;

export class MemoryBulkPreferencesStore implements BulkPreferencesStore {
  private preferences: PersistedBulkPreferences[] = [];

  async getPreferences(input: BulkPreferencesKey) {
    return this.preferences.find((item) => keyMatches(item, input));
  }

  async savePreferences(preferences: PersistedBulkPreferences) {
    const parsed = persistedBulkPreferencesSchema.safeParse(preferences);

    if (!parsed.success) {
      throw new BulkPreferencesStoreError("Invalid bulk preferences.");
    }

    this.preferences = this.preferences.filter(
      (item) => !keyMatches(item, parsed.data),
    );

    this.preferences.push(parsed.data);
  }
}

export class JsonBulkPreferencesStore implements BulkPreferencesStore {
  readonly path: string;

  private writeQueue: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = resolve(path);
  }

  async getPreferences(input: BulkPreferencesKey) {
    return (await this.read()).preferences.find((item) =>
      keyMatches(item, input),
    );
  }

  async savePreferences(
    preferences: PersistedBulkPreferences,
  ): Promise<void> {
    const parsed = persistedBulkPreferencesSchema.safeParse(preferences);

    if (!parsed.success) {
      throw new BulkPreferencesStoreError("Invalid bulk preferences.");
    }

    const queued = this.writeQueue.then(async () => {
      const current = await this.read();

      const next = current.preferences.filter(
        (item) => !keyMatches(item, parsed.data),
      );

      next.push(parsed.data);

      await mkdir(dirname(this.path), { recursive: true });

      const temporaryPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;

      await writeFile(
        temporaryPath,
        `${JSON.stringify(
          {
            version: 1,
            preferences: next,
          },
          null,
          2,
        )}\n`,
        {
          encoding: "utf8",
          mode: 0o600,
        },
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
        return {
          version: 1 as const,
          preferences: [],
        };
      }

      throw new BulkPreferencesStoreError(
        "Could not read bulk-preferences store.",
      );
    }

    try {
      return fileSchema.parse(JSON.parse(content));
    } catch {
      throw new BulkPreferencesStoreError(
        "Bulk-preferences store is corrupt.",
      );
    }
  }
}
