import { TokenVerificationError } from "@canva/app-middleware";
import { z } from "zod";
import type { CopyOperationStore } from "../connect/copy_operation_store.js";
import type { CanvaTokenVerificationService } from "../token_verification.js";
import { verifyCanvaIdentity } from "../token_verification.js";
import type { BulkPreferencesStore } from "./store.js";

const getSchema = z
  .object({
    designToken: z.string().min(1),
  })
  .strict();

const saveSchema = z
  .object({
    designToken: z.string().min(1),
    excludedPageIds: z.array(z.string().min(1).max(500)).max(10_000),
  })
  .strict();

const bearer = (value: string | undefined) =>
  /^Bearer\s+(\S+)$/u.exec(value ?? "")?.[1];

type Dependencies = {
  verification: CanvaTokenVerificationService;
  copyStore?: CopyOperationStore;
  bulkPreferencesStore?: BulkPreferencesStore;
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
        body: { error: "Bulk-preferences persistence unavailable." },
      };

export const getBulkPreferences = async (
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

    const preferences =
      await dependencies.bulkPreferencesStore?.getPreferences({
        userId: trusted.identity.userId,
        targetDesignId: trusted.identity.designId,
        targetLanguage: trusted.target.targetLanguage,
      });

    return {
      status: 200,
      body: {
        preferences: preferences
          ? {
              excludedPageIds: preferences.excludedPageIds,
              updatedAt: preferences.updatedAt,
            }
          : null,
      },
    };
  } catch (cause) {
    return failure(cause);
  }
};

export const saveBulkPreferences = async (
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

    if (!trusted) {
      return {
        status: 403,
        body: { error: "Target not verified." },
      };
    }

    if (!dependencies.bulkPreferencesStore) {
      return {
        status: 503,
        body: { error: "Bulk-preferences persistence unavailable." },
      };
    }

    await dependencies.bulkPreferencesStore.savePreferences({
      userId: trusted.identity.userId,
      targetDesignId: trusted.identity.designId,
      targetLanguage: trusted.target.targetLanguage,
      excludedPageIds: [...new Set(input.data.excludedPageIds)],
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
