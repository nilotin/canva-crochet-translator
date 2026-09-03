import { TokenVerificationError } from "@canva/app-middleware";
import { z } from "zod";
import type { CopyOperationStore } from "../connect/copy_operation_store.js";
import type { CanvaTokenVerificationService } from "../token_verification.js";
import { verifyCanvaIdentity } from "../token_verification.js";
import {
  ELIGIBLE_AUTO_ACKNOWLEDGE_WARNING_CODES,
  type WarningPreferencesStore,
} from "./store.js";

const getSchema = z
  .object({
    designToken: z.string().min(1),
  })
  .strict();

const saveSchema = z
  .object({
    designToken: z.string().min(1),
    autoAcknowledgedWarningCodes: z
      .array(z.enum(ELIGIBLE_AUTO_ACKNOWLEDGE_WARNING_CODES))
      .max(ELIGIBLE_AUTO_ACKNOWLEDGE_WARNING_CODES.length),
  })
  .strict();

const bearer = (value: string | undefined) =>
  /^Bearer\s+(\S+)$/u.exec(value ?? "")?.[1];

type Dependencies = {
  verification: CanvaTokenVerificationService;
  copyStore?: CopyOperationStore;
  warningPreferencesStore?: WarningPreferencesStore;
};

// Mirrors bulk_preferences/controller.ts's trustedTarget: the design
// token still has to resolve to a verified *target* (copied) design, so
// only someone who has actually gone through the translation flow can
// read or write their own warning preferences. The resulting preference,
// though, is intentionally NOT scoped by that design -- see store.ts.
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
        body: { error: "Warning-preferences persistence unavailable." },
      };

export const getWarningPreferences = async (
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
      await dependencies.warningPreferencesStore?.getPreferences({
        userId: trusted.identity.userId,
        targetLanguage: trusted.target.targetLanguage,
      });

    return {
      status: 200,
      body: {
        preferences: preferences
          ? {
              autoAcknowledgedWarningCodes:
                preferences.autoAcknowledgedWarningCodes,
              updatedAt: preferences.updatedAt,
            }
          : null,
      },
    };
  } catch (cause) {
    return failure(cause);
  }
};

export const saveWarningPreferences = async (
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

    if (!dependencies.warningPreferencesStore) {
      return {
        status: 503,
        body: { error: "Warning-preferences persistence unavailable." },
      };
    }

    await dependencies.warningPreferencesStore.savePreferences({
      userId: trusted.identity.userId,
      targetLanguage: trusted.target.targetLanguage,
      autoAcknowledgedWarningCodes: [
        ...new Set(input.data.autoAcknowledgedWarningCodes),
      ],
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
