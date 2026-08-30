import { TokenVerificationError } from "@canva/app-middleware";
import { z } from "zod";
import type { CanvaTokenVerificationService } from "../token_verification.js";
import { verifyCanvaIdentity } from "../token_verification.js";
import { CanvaConnectAuth, CanvaConnectAuthError } from "./auth.js";
import { CanvaConnectApiError } from "./client.js";
import { CanvaCopyOperations } from "./copy_operations.js";
import type { CopyOperationStore } from "./copy_operation_store.js";
import type { PageTranslationStateStore } from "../page_state/store.js";
import type { BulkReviewStore } from "../bulk_review/store.js";
import type { BulkPreferencesStore } from "../bulk_preferences/store.js";

const copySchema = z
  .object({
    designToken: z.string().min(1),
    targetLanguage: z.enum(["en", "es"]),
    sourceTitle: z.string().max(250).optional(),
  })
  .strict();

const authSchema = z.object({ designToken: z.string().min(1) }).strict();

const bearer = (value: string | undefined) =>
  /^Bearer\s+(\S+)$/u.exec(value ?? "")?.[1];

export type ConnectDependencies = {
  tokenVerification: CanvaTokenVerificationService;
  operations?: CanvaCopyOperations;
  store?: CopyOperationStore;
  pageStateStore?: PageTranslationStateStore;
  bulkReviewStore?: BulkReviewStore;
  bulkPreferencesStore?: BulkPreferencesStore;
  auth?: CanvaConnectAuth;
};

export const copyDesign = async (
  dependencies: ConnectDependencies,
  body: unknown,
  authorization: string | undefined,
) => {
  const userToken = bearer(authorization);
  const input = copySchema.safeParse(body);
  if (!userToken)
    return {
      status: 401,
      body: {
        error: {
          code: "VERIFICATION_FAILED",
          message: "Canva verification failed.",
        },
      },
    };
  if (!input.success)
    return {
      status: 400,
      body: {
        error: { code: "INVALID_REQUEST", message: "Invalid request body." },
      },
    };
  if (!dependencies.operations)
    return {
      status: 503,
      body: {
        error: {
          code: "CONNECT_NOT_CONFIGURED",
          message: "Canva Connect is not configured.",
        },
      },
    };
  try {
    const identity = await verifyCanvaIdentity(
      dependencies.tokenVerification,
      input.data.designToken,
      userToken,
    );
    const result = await dependencies.operations.create({
      designId: identity.designId,
      userId: identity.userId,
      language: input.data.targetLanguage,
      sourceTitle: input.data.sourceTitle,
    });
    return { status: 200, body: result };
  } catch (cause) {
    if (cause instanceof TokenVerificationError)
      return {
        status: 401,
        body: {
          error: {
            code: "VERIFICATION_FAILED",
            message: "Canva verification failed.",
          },
        },
      };
    if (cause instanceof CanvaConnectAuthError)
      return {
        status: 401,
        body: { error: { code: cause.code, message: cause.message } },
      };
    if (cause instanceof CanvaConnectApiError) {
      const status =
        cause.code === "AUTH_REQUIRED"
          ? 401
          : cause.code === "SOURCE_NOT_FOUND"
            ? 404
            : cause.code === "RATE_LIMITED"
              ? 429
              : 502;
      return {
        status,
        body: { error: { code: cause.code, message: cause.message } },
      };
    }
    console.error("Canva copy operation failed.");
    return {
      status: 503,
      body: {
        error: {
          code: "COPY_FAILED",
          message: "Could not create the Canva design copy.",
        },
      },
    };
  }
};

export const startConnectAuthorization = async (
  dependencies: ConnectDependencies,
  body: unknown,
  authorization: string | undefined,
) => {
  const userToken = bearer(authorization);
  const input = authSchema.safeParse(body);
  if (!userToken || !input.success)
    return {
      status: userToken ? 400 : 401,
      body: {
        error: {
          code: "VERIFICATION_FAILED",
          message: "Canva verification failed.",
        },
      },
    };
  if (!dependencies.auth)
    return {
      status: 503,
      body: {
        error: {
          code: "CONNECT_NOT_CONFIGURED",
          message: "Canva Connect is not configured.",
        },
      },
    };
  try {
    const identity = await verifyCanvaIdentity(
      dependencies.tokenVerification,
      input.data.designToken,
      userToken,
    );
    return {
      status: 200,
      body: { authorizationUrl: dependencies.auth.start(identity.userId) },
    };
  } catch {
    return {
      status: 401,
      body: {
        error: {
          code: "VERIFICATION_FAILED",
          message: "Canva verification failed.",
        },
      },
    };
  }
};
