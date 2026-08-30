import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { reviewBlockSchema } from "../page_state/store.js";

export const persistedBulkReviewSchema = z
  .object({
    userId: z.string().min(1),
    targetDesignId: z.string().min(1),
    targetLanguage: z.enum(["en", "es"]),
    pageId: z.string().min(1).max(500),
    fingerprint: z.string().min(1).max(200),

    pipelineRevision: z.string().min(1).max(200).optional(),
    status: z.enum(["ready", "needs_review", "blocked"]),
    blocks: z.array(reviewBlockSchema).max(1_000),
    updatedAt: z.string().datetime(),
  })
  .strict();

const fileSchema = z
  .object({
    version: z.literal(1),
    reviews: z.array(persistedBulkReviewSchema),
  })
  .strict();

export type PersistedBulkReview = z.infer<typeof persistedBulkReviewSchema>;

type BulkReviewKey = {
  userId: string;
  targetDesignId: string;
  targetLanguage: "en" | "es";
  pageId?: string;
};

export interface BulkReviewStore {
  getReview(
    input: Required<BulkReviewKey>,
  ): Promise<PersistedBulkReview | undefined>;

  listReviews(
    input: Omit<BulkReviewKey, "pageId">,
  ): Promise<PersistedBulkReview[]>;

  saveReview(review: PersistedBulkReview): Promise<void>;
}

export class BulkReviewStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BulkReviewStoreError";
  }
}

const keyMatches = (
  review: PersistedBulkReview,
  input: BulkReviewKey,
): boolean =>
  review.userId === input.userId &&
  review.targetDesignId === input.targetDesignId &&
  review.targetLanguage === input.targetLanguage &&
  (input.pageId === undefined || review.pageId === input.pageId);

export class MemoryBulkReviewStore implements BulkReviewStore {
  private reviews: PersistedBulkReview[] = [];

  async getReview(input: Required<BulkReviewKey>) {
    return this.reviews.find((review) => keyMatches(review, input));
  }

  async listReviews(input: Omit<BulkReviewKey, "pageId">) {
    return this.reviews.filter((review) => keyMatches(review, input));
  }

  async saveReview(review: PersistedBulkReview) {
    const parsed = persistedBulkReviewSchema.safeParse(review);

    if (!parsed.success) {
      throw new BulkReviewStoreError("Invalid bulk review.");
    }

    this.reviews = this.reviews.filter(
      (item) =>
        !keyMatches(item, {
          userId: parsed.data.userId,
          targetDesignId: parsed.data.targetDesignId,
          targetLanguage: parsed.data.targetLanguage,
          pageId: parsed.data.pageId,
        }),
    );

    this.reviews.push(parsed.data);
  }
}

export class JsonBulkReviewStore implements BulkReviewStore {
  readonly path: string;

  private writeQueue: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = resolve(path);
  }

  async getReview(input: Required<BulkReviewKey>) {
    return (await this.read()).reviews.find((review) =>
      keyMatches(review, input),
    );
  }

  async listReviews(input: Omit<BulkReviewKey, "pageId">) {
    return (await this.read()).reviews.filter((review) =>
      keyMatches(review, input),
    );
  }

  async saveReview(review: PersistedBulkReview): Promise<void> {
    const parsed = persistedBulkReviewSchema.safeParse(review);

    if (!parsed.success) {
      throw new BulkReviewStoreError("Invalid bulk review.");
    }

    const queued = this.writeQueue.then(async () => {
      const current = await this.read();

      const reviews = current.reviews.filter(
        (item) =>
          !keyMatches(item, {
            userId: parsed.data.userId,
            targetDesignId: parsed.data.targetDesignId,
            targetLanguage: parsed.data.targetLanguage,
            pageId: parsed.data.pageId,
          }),
      );

      reviews.push(parsed.data);

      await mkdir(dirname(this.path), { recursive: true });

      const temporaryPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;

      await writeFile(
        temporaryPath,
        `${JSON.stringify({ version: 1, reviews }, null, 2)}\n`,
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
        return { version: 1 as const, reviews: [] };
      }

      throw new BulkReviewStoreError("Could not read bulk-review store.");
    }

    try {
      return fileSchema.parse(JSON.parse(content));
    } catch {
      throw new BulkReviewStoreError("Bulk-review store is corrupt.");
    }
  }
}
