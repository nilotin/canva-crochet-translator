import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const diagnosticSchema = z
  .object({ code: z.string().min(1).max(100), message: z.string().max(2_000) })
  .strict();

export const reviewBlockSchema = z
  .object({
    id: z.string().min(1).max(200),
    source: z.string().max(20_000),
    translated: z.string().max(20_000),
    editedTranslation: z.string().max(20_000),
    validation: z.enum(["PASS", "WARNING", "BLOCK"]),
    errors: z.array(diagnosticSchema).max(100),
    warnings: z.array(diagnosticSchema).max(100),
    targetFormattingRegions: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            start: z.number().int().nonnegative(),
            end: z.number().int().nonnegative(),
          })
          .strict()
          .refine(({ start, end }) => end >= start, {
            message:
              "Formatting region end must be greater than or equal to start.",
          }),
      )
      .max(1_000)
      .optional(),
  })
  .strict();

export const persistedPageStateSchema = z
  .object({
    userId: z.string().min(1),
    targetDesignId: z.string().min(1),
    targetLanguage: z.enum(["en", "es"]),
    pageIdentity: z.string().min(1).max(500),
    pipelineRevision: z.string().min(1).max(100).optional(),
    sourceSnapshotDigest: z.string().min(1).max(200),
    expectedAppliedSnapshotDigest: z.string().min(1).max(200),
    appliedSnapshotDigest: z.string().min(1).max(200).optional(),
    snapshotMode: z.enum(["current_page", "whole_document"]).optional(),
    status: z.enum(["reviewed", "needs_review", "blocked", "applied"]),
    blocks: z.array(reviewBlockSchema).max(1_000),
    appliedAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((state, context) => {
    if (
      state.status === "applied" &&
      (!state.appliedAt || !state.appliedSnapshotDigest)
    ) {
      context.addIssue({
        code: "custom",
        message: "Applied page state requires applied timestamps and digest.",
      });
    }
    if (
      state.status !== "applied" &&
      (state.appliedAt || state.appliedSnapshotDigest)
    ) {
      context.addIssue({
        code: "custom",
        message: "Non-applied page state cannot contain applied fields.",
      });
    }
  });

const fileSchema = z
  .object({ version: z.literal(1), states: z.array(persistedPageStateSchema) })
  .strict();

export type PersistedPageTranslationState = z.infer<
  typeof persistedPageStateSchema
>;

export interface PageTranslationStateStore {
  getPageState(input: {
    userId: string;
    targetDesignId: string;
    targetLanguage: "en" | "es";
    pageIdentity: string;
  }): Promise<PersistedPageTranslationState | undefined>;
  listPageStates(input: {
    userId: string;
    targetDesignId: string;
    targetLanguage: "en" | "es";
  }): Promise<PersistedPageTranslationState[]>;
  savePageState(state: PersistedPageTranslationState): Promise<void>;
}

export class PageStateStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageStateStoreError";
  }
}

const keyMatches = (
  state: PersistedPageTranslationState,
  input: {
    userId: string;
    targetDesignId: string;
    targetLanguage: "en" | "es";
    pageIdentity?: string;
  },
) =>
  state.userId === input.userId &&
  state.targetDesignId === input.targetDesignId &&
  state.targetLanguage === input.targetLanguage &&
  (input.pageIdentity === undefined ||
    state.pageIdentity === input.pageIdentity);

export class MemoryPageTranslationStateStore
  implements PageTranslationStateStore
{
  private states: PersistedPageTranslationState[] = [];

  async getPageState(
    input: Parameters<PageTranslationStateStore["getPageState"]>[0],
  ) {
    return this.states.find((state) => keyMatches(state, input));
  }

  async listPageStates(
    input: Parameters<PageTranslationStateStore["listPageStates"]>[0],
  ) {
    return this.states.filter((state) => keyMatches(state, input));
  }

  async savePageState(state: PersistedPageTranslationState) {
    const parsed = persistedPageStateSchema.safeParse(state);
    if (!parsed.success) throw new PageStateStoreError("Invalid page state.");
    this.states = this.states.filter(
      (item) =>
        !keyMatches(item, {
          ...parsed.data,
          pageIdentity: parsed.data.pageIdentity,
        }),
    );
    this.states.push(parsed.data);
  }
}

export class JsonPageTranslationStateStore
  implements PageTranslationStateStore
{
  readonly path: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = resolve(path);
  }

  async getPageState(
    input: Parameters<PageTranslationStateStore["getPageState"]>[0],
  ) {
    return (await this.read()).states.find((state) => keyMatches(state, input));
  }

  async listPageStates(
    input: Parameters<PageTranslationStateStore["listPageStates"]>[0],
  ) {
    return (await this.read()).states.filter((state) =>
      keyMatches(state, input),
    );
  }

  async savePageState(state: PersistedPageTranslationState): Promise<void> {
    const parsed = persistedPageStateSchema.safeParse(state);
    if (!parsed.success) throw new PageStateStoreError("Invalid page state.");
    const queued = this.writeQueue.then(async () => {
      const current = await this.read();
      const states = current.states.filter(
        (item) =>
          !keyMatches(item, {
            ...parsed.data,
            pageIdentity: parsed.data.pageIdentity,
          }),
      );
      states.push(parsed.data);
      await mkdir(dirname(this.path), { recursive: true });
      const temporaryPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(
        temporaryPath,
        `${JSON.stringify({ version: 1, states }, null, 2)}\n`,
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
        return { version: 1 as const, states: [] };
      }
      throw new PageStateStoreError("Could not read page-state store.");
    }
    try {
      return fileSchema.parse(JSON.parse(content));
    } catch {
      throw new PageStateStoreError("Page-state store is corrupt.");
    }
  }
}
