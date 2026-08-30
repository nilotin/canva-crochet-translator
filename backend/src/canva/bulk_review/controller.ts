import { TokenVerificationError } from "@canva/app-middleware";
import { z } from "zod";
import type { CopyOperationStore } from "../connect/copy_operation_store.js";
import type { CanvaTokenVerificationService } from "../token_verification.js";
import { verifyCanvaIdentity } from "../token_verification.js";
import { persistedBulkReviewSchema, type BulkReviewStore } from "./store.js";

const getSchema = z
  .object({
    designToken: z.string().min(1),
    pageId: z.string().min(1).max(500),
  })
  .strict();

const listSchema = z
  .object({
    designToken: z.string().min(1),
  })
  .strict();

const saveSchema = z
  .object({
    designToken: z.string().min(1),
    pageId: persistedBulkReviewSchema.shape.pageId,
    fingerprint: persistedBulkReviewSchema.shape.fingerprint,

    pipelineRevision: persistedBulkReviewSchema.shape.pipelineRevision,
    status: persistedBulkReviewSchema.shape.status,
    blocks: persistedBulkReviewSchema.shape.blocks,
  })
  .strict();

const bearer = (value: string | undefined) =>
  /^Bearer\s+(\S+)$/u.exec(value ?? "")?.[1];

type Dependencies = {
  verification: CanvaTokenVerificationService;
  copyStore?: CopyOperationStore;
  bulkReviewStore?: BulkReviewStore;
};

const trustedTarget = async (
  dependencies: Dependencies,
  designToken: string,
  userToken: string,
) => {
  const identity = await verifyCanvaIdentity(
    dependencies.verification,
    designToken,
    userToken,
  );

  const target = await dependencies.copyStore?.findByTargetDesign({
    userId: identity.userId,
    targetDesignId: identity.designId,
  });

  if (!target || target.sourceDesignId === target.copiedDesignId) return;

  return { identity, target };
};

const failure = (cause: unknown) =>
  cause instanceof TokenVerificationError
    ? {
        status: 401,
        body: { error: "Canva verification failed." },
      }
    : {
        status: 503,
        body: { error: "Bulk-review persistence unavailable." },
      };

export const getBulkReview = async (
  dependencies: Dependencies,
  body: unknown,
  authorization: string | undefined,
) => {
  const input = getSchema.safeParse(body);
  const userToken = bearer(authorization);

  if (!input.success || !userToken) {
    return {
      status: userToken ? 400 : 401,
      body: { error: "Invalid request." },
    };
  }

  try {
    const trusted = await trustedTarget(
      dependencies,
      input.data.designToken,
      userToken,
    );

    if (!trusted) {
      return {
        status: 403,
        body: { error: "Target not verified." },
      };
    }

    const review = await dependencies.bulkReviewStore?.getReview({
      userId: trusted.identity.userId,
      targetDesignId: trusted.identity.designId,
      targetLanguage: trusted.target.targetLanguage,
      pageId: input.data.pageId,
    });

    return {
      status: 200,
      body: {
        review: review
          ? {
              pageId: review.pageId,
              fingerprint: review.fingerprint,

              pipelineRevision: review.pipelineRevision,
              status: review.status,
              blocks: review.blocks,
              updatedAt: review.updatedAt,
            }
          : null,
      },
    };
  } catch (cause) {
    return failure(cause);
  }
};

export const listBulkReviews = async (
  dependencies: Dependencies,
  body: unknown,
  authorization: string | undefined,
) => {
  const input = listSchema.safeParse(body);
  const userToken = bearer(authorization);

  if (!input.success || !userToken) {
    return {
      status: userToken ? 400 : 401,
      body: { error: "Invalid request." },
    };
  }

  try {
    const trusted = await trustedTarget(
      dependencies,
      input.data.designToken,
      userToken,
    );

    if (!trusted) {
      return {
        status: 403,
        body: { error: "Target not verified." },
      };
    }

    const reviews =
      (await dependencies.bulkReviewStore?.listReviews({
        userId: trusted.identity.userId,
        targetDesignId: trusted.identity.designId,
        targetLanguage: trusted.target.targetLanguage,
      })) ?? [];

    return {
      status: 200,
      body: {
        reviews: reviews.map((review) => ({
          pageId: review.pageId,
          fingerprint: review.fingerprint,

          pipelineRevision: review.pipelineRevision,
          status: review.status,
          updatedAt: review.updatedAt,
        })),
      },
    };
  } catch (cause) {
    return failure(cause);
  }
};

export const saveBulkReview = async (
  dependencies: Dependencies,
  body: unknown,
  authorization: string | undefined,
) => {
  const input = saveSchema.safeParse(body);
  const userToken = bearer(authorization);

  if (!input.success || !userToken) {
    return {
      status: userToken ? 400 : 401,
      body: { error: "Invalid request." },
    };
  }

  try {
    const trusted = await trustedTarget(
      dependencies,
      input.data.designToken,
      userToken,
    );

    if (!trusted || !dependencies.bulkReviewStore) {
      return {
        status: 403,
        body: { error: "Target not verified." },
      };
    }

    await dependencies.bulkReviewStore.saveReview({
      userId: trusted.identity.userId,
      targetDesignId: trusted.identity.designId,
      targetLanguage: trusted.target.targetLanguage,
      pageId: input.data.pageId,
      fingerprint: input.data.fingerprint,

      pipelineRevision: input.data.pipelineRevision,
      status: input.data.status,
      blocks: input.data.blocks,
      updatedAt: new Date().toISOString(),
    });

    return {
      status: 200,
      body: { saved: true },
    };
  } catch (cause) {
    return failure(cause);
  }
};
