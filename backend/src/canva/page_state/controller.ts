import { TokenVerificationError } from "@canva/app-middleware";
import { z } from "zod";
import type { CopyOperationStore } from "../connect/copy_operation_store.js";
import type { CanvaTokenVerificationService } from "../token_verification.js";
import { verifyCanvaIdentity } from "../token_verification.js";
import {
  persistedPageStateSchema,
  type PageTranslationStateStore,
} from "./store.js";

const baseSchema = z
  .object({
    designToken: z.string().min(1),
    pageIdentity: z.string().min(1).max(500),
  })
  .strict();

const saveSchema = z
  .object({
    designToken: z.string().min(1),
    pageIdentity: z.string().min(1).max(500),
    pipelineRevision: z.string().min(1).max(100),
    sourceSnapshotDigest: z.string().min(1).max(200),
    expectedAppliedSnapshotDigest: z.string().min(1).max(200),
    appliedSnapshotDigest: z.string().min(1).max(200).optional(),
    snapshotMode: z.enum(["current_page", "whole_document"]).optional(),
    status: z.enum(["reviewed", "needs_review", "blocked", "applied"]),
    blocks: persistedPageStateSchema.shape.blocks,
  })
  .strict();

const listSchema = z
  .object({
    designToken: z.string().min(1),
  })
  .strict();

const bearer = (value: string | undefined) =>
  /^Bearer\s+(\S+)$/u.exec(value ?? "")?.[1];

type Dependencies = {
  verification: CanvaTokenVerificationService;
  copyStore?: CopyOperationStore;
  pageStore?: PageTranslationStateStore;
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
    ? { status: 401, body: { error: "Canva verification failed." } }
    : { status: 503, body: { error: "Page-state persistence unavailable." } };

export const getPageTranslationState = async (
  dependencies: Dependencies,
  body: unknown,
  authorization: string | undefined,
) => {
  const input = baseSchema.safeParse(body);
  const userToken = bearer(authorization);
  if (!input.success || !userToken)
    return {
      status: userToken ? 400 : 401,
      body: { error: "Invalid request." },
    };
  try {
    const trusted = await trustedTarget(
      dependencies,
      input.data.designToken,
      userToken,
    );
    if (!trusted)
      return { status: 403, body: { error: "Target not verified." } };
    const key = {
      userId: trusted.identity.userId,
      targetDesignId: trusted.identity.designId,
      targetLanguage: trusted.target.targetLanguage,
    };
    const [state, all] = await Promise.all([
      dependencies.pageStore?.getPageState({
        ...key,
        pageIdentity: input.data.pageIdentity,
      }),
      dependencies.pageStore?.listPageStates(key),
    ]);
    const uniqueStates = new Map(
      (all ?? []).map((state) => [state.pageIdentity, state]),
    );

    const progressSummary = {
      applied: 0,
      reviewed: 0,
      needsReview: 0,
      blocked: 0,
    };

    for (const state of uniqueStates.values()) {
      if (state.status === "applied") progressSummary.applied += 1;
      else if (state.status === "reviewed") progressSummary.reviewed += 1;
      else if (state.status === "needs_review")
        progressSummary.needsReview += 1;
      else if (state.status === "blocked") progressSummary.blocked += 1;
    }

    const appliedCount = progressSummary.applied;
    return {
      status: 200,
      body: {
        state: state
          ? {
              pageIdentity: state.pageIdentity,
              sourceSnapshotDigest: state.sourceSnapshotDigest,
              expectedAppliedSnapshotDigest:
                state.expectedAppliedSnapshotDigest,
              appliedSnapshotDigest: state.appliedSnapshotDigest,
              snapshotMode: state.snapshotMode,
              status: state.status,
              blocks: state.blocks,
              appliedAt: state.appliedAt,
              updatedAt: state.updatedAt,
            }
          : null,
        appliedCount,
        progressSummary,
      },
    };
  } catch (cause) {
    return failure(cause);
  }
};

export const listPageTranslationStates = async (
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
      return { status: 403, body: { error: "Target not verified." } };
    }

    const states =
      (await dependencies.pageStore?.listPageStates({
        userId: trusted.identity.userId,
        targetDesignId: trusted.identity.designId,
        targetLanguage: trusted.target.targetLanguage,
      })) ?? [];

    const unique = new Map(
      states.map((state) => [
        state.pageIdentity,
        {
          pageIdentity: state.pageIdentity,
          status: state.status,
        },
      ]),
    );

    return {
      status: 200,
      body: {
        states: [...unique.values()],
      },
    };
  } catch (cause) {
    return failure(cause);
  }
};

export const savePageTranslationState = async (
  dependencies: Dependencies,
  body: unknown,
  authorization: string | undefined,
) => {
  const input = saveSchema.safeParse(body);
  const userToken = bearer(authorization);
  if (!input.success || !userToken)
    return {
      status: userToken ? 400 : 401,
      body: { error: "Invalid request." },
    };
  try {
    const trusted = await trustedTarget(
      dependencies,
      input.data.designToken,
      userToken,
    );
    if (!trusted || !dependencies.pageStore)
      return { status: 403, body: { error: "Target not verified." } };
    const now = new Date().toISOString();
    await dependencies.pageStore.savePageState({
      userId: trusted.identity.userId,
      targetDesignId: trusted.identity.designId,
      targetLanguage: trusted.target.targetLanguage,
      pageIdentity: input.data.pageIdentity,
      pipelineRevision: input.data.pipelineRevision,
      sourceSnapshotDigest: input.data.sourceSnapshotDigest,
      expectedAppliedSnapshotDigest: input.data.expectedAppliedSnapshotDigest,
      snapshotMode: input.data.snapshotMode,
      ...(input.data.status === "applied"
        ? {
            appliedSnapshotDigest: input.data.appliedSnapshotDigest,
            appliedAt: now,
          }
        : {}),
      status: input.data.status,
      blocks: input.data.blocks,
      updatedAt: now,
    });
    return { status: 200, body: { saved: true } };
  } catch (cause) {
    return failure(cause);
  }
};
