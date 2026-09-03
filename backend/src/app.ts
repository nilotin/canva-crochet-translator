import { TokenVerificationError } from "@canva/app-middleware";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { ZodError } from "zod";
import { resolveDesignContext } from "./canva/design_context.js";
import { resolveTargetContext } from "./canva/target_context.js";
import {
  type CanvaTokenVerificationService,
  verifyCanvaIdentity,
} from "./canva/token_verification.js";
import {
  copyDesign,
  startConnectAuthorization,
  type ConnectDependencies,
} from "./canva/connect/controller.js";
import { CanvaConnectAuth } from "./canva/connect/auth.js";
import {
  CorsOriginRejectedError,
  createCorsOptions,
  parseAllowedOrigins,
} from "./http/cors.js";
import {
  createTranslationProvider,
  TranslationProviderError,
} from "./translation/providers/index.js";
import { translateBlocks } from "./translation/translator.js";
import { translateRequestSchema } from "./translation/types.js";
import { buildDeterministicTranslationResult } from "./translation/deterministic_bypass.js";
import {
  JsonDeterministicTemplateRegistry,
  type DeterministicTemplateRegistry,
} from "./translation/deterministic_templates/registry.js";
import {
  getPageTranslationState,
  listPageTranslationStates,
  savePageTranslationState,
} from "./canva/page_state/controller.js";
import {
  getBulkReview,
  listBulkReviews,
  saveBulkReview,
} from "./canva/bulk_review/controller.js";
import {
  getBulkPreferences,
  saveBulkPreferences,
} from "./canva/bulk_preferences/controller.js";
import {
  getWarningPreferences,
  saveWarningPreferences,
} from "./canva/warning_preferences/controller.js";

type BackendDependencies = {
  canvaTokenVerification: CanvaTokenVerificationService;
  canvaConnect?: Omit<ConnectDependencies, "tokenVerification">;
  deterministicTemplateRegistry?: DeterministicTemplateRegistry;
};

export const createBackendApp = ({
  canvaTokenVerification,
  canvaConnect = {},
  deterministicTemplateRegistry = new JsonDeterministicTemplateRegistry(
    process.env.DETERMINISTIC_TEMPLATE_REGISTRY_PATH ??
      fileURLToPath(
        new URL(
          "../../.data/private-deterministic-templates.json",
          import.meta.url,
        ),
      ),
  ),
}: BackendDependencies) => {
  const app = express();
  const allowedOrigins = parseAllowedOrigins(
    process.env.ALLOWED_ORIGINS ?? "http://localhost:8080",
  );

  app.disable("x-powered-by");
  app.use(cors(createCorsOptions(allowedOrigins)));
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      next: express.NextFunction,
    ) => {
      if (error instanceof CorsOriginRejectedError) {
        response.status(403).json({ error: "Origin not allowed." });
        return;
      }
      next(error);
    },
  );
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/health/translation", async (_request, response) => {
    try {
      const readiness = await createTranslationProvider().checkReadiness();
      response.status(readiness.ok ? 200 : 503).json(readiness);
    } catch (cause) {
      const error =
        cause instanceof TranslationProviderError
          ? cause
          : new TranslationProviderError(
              "CONFIGURATION_ERROR",
              "Translation provider configuration is invalid.",
            );
      response.status(503).json({
        ok: false,
        provider: process.env.TRANSLATION_PROVIDER ?? "openai",
        model: process.env.OPENAI_MODEL ?? "",
        error: { code: error.code, message: error.message },
      });
    }
  });

  app.post("/api/canva/design-context", async (request, response) => {
    const result = await resolveDesignContext(
      canvaTokenVerification,
      request.body,
      request.header("authorization"),
    );
    response.status(result.status).json(result.body);
  });

  app.post("/api/canva/target-context", async (request, response) => {
    const result = await resolveTargetContext(
      canvaTokenVerification,
      canvaConnect.store ?? canvaConnect.operations?.store,
      request.body,
      request.header("authorization"),
    );
    response.status(result.status).json(result.body);
  });

  const connectDependencies = {
    tokenVerification: canvaTokenVerification,
    ...canvaConnect,
  };

  app.post("/api/canva/connect/oauth/authorize", async (request, response) => {
    const result = await startConnectAuthorization(
      connectDependencies,
      request.body,
      request.header("authorization"),
    );
    response.status(result.status).json(result.body);
  });

  app.get("/api/canva/connect/oauth/callback", async (request, response) => {
    const {
      code,
      state,
      error,
      error_description: errorDescription,
    } = request.query;

    if (
      !(connectDependencies.auth instanceof CanvaConnectAuth) ||
      typeof code !== "string" ||
      typeof state !== "string"
    ) {
      console.error("Canva OAuth callback rejected before token exchange.", {
        hasCode: typeof code === "string",
        hasState: typeof state === "string",
        error: typeof error === "string" ? error : undefined,
        errorDescription:
          typeof errorDescription === "string" ? errorDescription : undefined,
        authConfigured: connectDependencies.auth instanceof CanvaConnectAuth,
      });

      response
        .status(400)
        .type("text")
        .send("Canva authorization could not be completed.");
      return;
    }
    try {
      await connectDependencies.auth.complete(code, state);
      response
        .type("text")
        .send(
          "Canva authorization complete. Return to Crochet Translator and retry the copy.",
        );
    } catch (cause) {
      console.error("Canva OAuth callback failed.", {
        name: cause instanceof Error ? cause.name : typeof cause,
        message: cause instanceof Error ? cause.message : String(cause),
        code:
          cause && typeof cause === "object" && "code" in cause
            ? cause.code
            : undefined,
        status:
          cause && typeof cause === "object" && "status" in cause
            ? cause.status
            : undefined,
      });

      response
        .status(400)
        .type("text")
        .send("Canva authorization could not be completed.");
    }
  });

  app.post("/api/canva/designs/copy", async (request, response) => {
    const result = await copyDesign(
      connectDependencies,
      request.body,
      request.header("authorization"),
    );
    response.status(result.status).json(result.body);
  });

  app.post("/api/canva/bulk-review/get", async (request, response) => {
    const result = await getBulkReview(
      {
        verification: canvaTokenVerification,
        copyStore: canvaConnect.store ?? canvaConnect.operations?.store,
        bulkReviewStore: canvaConnect.bulkReviewStore,
      },
      request.body,
      request.header("authorization"),
    );

    response.status(result.status).json(result.body);
  });

  app.post("/api/canva/bulk-review/list", async (request, response) => {
    const result = await listBulkReviews(
      {
        verification: canvaTokenVerification,
        copyStore: canvaConnect.store ?? canvaConnect.operations?.store,
        bulkReviewStore: canvaConnect.bulkReviewStore,
      },
      request.body,
      request.header("authorization"),
    );

    response.status(result.status).json(result.body);
  });

  app.post("/api/canva/bulk-review/save", async (request, response) => {
    const result = await saveBulkReview(
      {
        verification: canvaTokenVerification,
        copyStore: canvaConnect.store ?? canvaConnect.operations?.store,
        bulkReviewStore: canvaConnect.bulkReviewStore,
      },
      request.body,
      request.header("authorization"),
    );

    response.status(result.status).json(result.body);
  });

  app.post("/api/canva/bulk-preferences/get", async (request, response) => {
    const result = await getBulkPreferences(
      {
        verification: canvaTokenVerification,
        copyStore: canvaConnect.store ?? canvaConnect.operations?.store,
        bulkPreferencesStore: canvaConnect.bulkPreferencesStore,
      },
      request.body,
      request.header("authorization"),
    );

    response.status(result.status).json(result.body);
  });

  app.post("/api/canva/bulk-preferences/save", async (request, response) => {
    const result = await saveBulkPreferences(
      {
        verification: canvaTokenVerification,
        copyStore: canvaConnect.store ?? canvaConnect.operations?.store,
        bulkPreferencesStore: canvaConnect.bulkPreferencesStore,
      },
      request.body,
      request.header("authorization"),
    );

    response.status(result.status).json(result.body);
  });

  app.post("/api/canva/warning-preferences/get", async (request, response) => {
    const result = await getWarningPreferences(
      {
        verification: canvaTokenVerification,
        copyStore: canvaConnect.store ?? canvaConnect.operations?.store,
        warningPreferencesStore: canvaConnect.warningPreferencesStore,
      },
      request.body,
      request.header("authorization"),
    );

    response.status(result.status).json(result.body);
  });

  app.post("/api/canva/warning-preferences/save", async (request, response) => {
    const result = await saveWarningPreferences(
      {
        verification: canvaTokenVerification,
        copyStore: canvaConnect.store ?? canvaConnect.operations?.store,
        warningPreferencesStore: canvaConnect.warningPreferencesStore,
      },
      request.body,
      request.header("authorization"),
    );

    response.status(result.status).json(result.body);
  });

  app.post("/api/canva/page-state/get", async (request, response) => {
    const result = await getPageTranslationState(
      {
        verification: canvaTokenVerification,
        copyStore: canvaConnect.store ?? canvaConnect.operations?.store,
        pageStore: canvaConnect.pageStateStore,
      },
      request.body,
      request.header("authorization"),
    );
    response.status(result.status).json(result.body);
  });

  app.post("/api/canva/page-state/list", async (request, response) => {
    const result = await listPageTranslationStates(
      {
        verification: canvaTokenVerification,
        copyStore: canvaConnect.store ?? canvaConnect.operations?.store,
        pageStore: canvaConnect.pageStateStore,
      },
      request.body,
      request.header("authorization"),
    );

    response.status(result.status).json(result.body);
  });

  app.post("/api/canva/page-state/save", async (request, response) => {
    const result = await savePageTranslationState(
      {
        verification: canvaTokenVerification,
        copyStore: canvaConnect.store ?? canvaConnect.operations?.store,
        pageStore: canvaConnect.pageStateStore,
      },
      request.body,
      request.header("authorization"),
    );
    response.status(result.status).json(result.body);
  });

  const translateRateLimiter = rateLimit({
    windowMs: 60_000,
    limit: Number.parseInt(
      process.env.TRANSLATE_RATE_LIMIT_MAX ?? "60",
      10,
    ),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, response) => {
      response.status(429).json({
        error: "Too many translation requests.",
      });
    },
  });

  app.post(
    "/api/translate",
    translateRateLimiter,
    async (request, response) => {
    const userToken = /^Bearer\s+(\S+)$/u.exec(
      request.header("authorization") ?? "",
    )?.[1];

    if (!userToken) {
      response.status(401).json({ error: "Canva verification failed." });
      return;
    }

    let input;
    try {
      input = translateRequestSchema.parse(request.body);
    } catch (cause) {
      if (cause instanceof ZodError) {
        response.status(400).json({
          error: "Invalid request body.",
          issues: cause.issues.map(({ code, message, path }) => ({
            code,
            message,
            path,
          })),
        });
        return;
      }
      throw cause;
    }

    let identity;

    try {
      identity = await verifyCanvaIdentity(
        canvaTokenVerification,
        input.designToken,
        userToken,
      );
    } catch (cause) {
      if (cause instanceof TokenVerificationError) {
        response.status(401).json({ error: "Canva verification failed." });
        return;
      }

      response.status(503).json({ error: "Canva verification unavailable." });
      return;
    }

    try {
      if (input.templateCandidate && input.pageFingerprint) {
        const copyStore = canvaConnect.store ?? canvaConnect.operations?.store;
        const target = await copyStore?.findByTargetDesign({
          userId: identity.userId,
          targetDesignId: identity.designId,
        });

        if (target?.targetLanguage === input.targetLanguage) {
          const template =
            await deterministicTemplateRegistry.findByFingerprint(
              input.pageFingerprint,
            );

          const deterministicTranslations =
            template?.translations[input.targetLanguage];

          if (
            deterministicTranslations &&
            deterministicTranslations.length === input.blocks.length
          ) {
            response.json({
              translations: input.blocks.map((block, index) =>
                buildDeterministicTranslationResult(
                  block,
                  deterministicTranslations[index]!,
                  input.targetLanguage,
                ),
              ),
            });
            return;
          }

          // Development-only diagnostics for why the exact-match
          // deterministic bypass was skipped. Never log block/translation
          // text -- only structural, non-sensitive facts (a fingerprint is
          // an opaque hash, not customer content; template "kind" is a
          // fixed enum, not customer content). The exact-match requirement
          // itself is unchanged: this only makes a silent fallthrough
          // observable.
          if (process.env.NODE_ENV !== "production") {
            if (!template) {
              console.warn("Deterministic template bypass skipped.", {
                reason: "fingerprint_not_registered",
                pageFingerprint: input.pageFingerprint,
              });
            } else if (!deterministicTranslations) {
              console.warn("Deterministic template bypass skipped.", {
                reason: "no_translations_for_target_language",
                pageFingerprint: input.pageFingerprint,
                templateKind: template.kind,
                targetLanguage: input.targetLanguage,
              });
            } else {
              console.warn("Deterministic template bypass skipped.", {
                reason: "block_count_mismatch",
                pageFingerprint: input.pageFingerprint,
                templateKind: template.kind,
                expectedBlockCount: deterministicTranslations.length,
                actualBlockCount: input.blocks.length,
              });
            }
          }
        } else if (process.env.NODE_ENV !== "production") {
          console.warn("Deterministic template bypass skipped.", {
            reason: target
              ? "target_language_mismatch"
              : "no_matching_copy_target_record",
            pageFingerprint: input.pageFingerprint,
          });
        }
      }

      const translations = await translateBlocks(
        input.blocks,
        input.targetLanguage,
        { contentKind: input.contentKind },
      );
      response.json({ translations });
    } catch (cause) {
      if (cause instanceof ZodError) {
        response.status(400).json({
          error: "Invalid request body.",
          issues: cause.issues.map(({ code, message, path }) => ({
            code,
            message,
            path,
          })),
        });
        return;
      }

      const diagnostic =
        cause instanceof Error ? cause.message : "Unknown error";
      console.error("Translation request failed:", diagnostic);
      response.status(500).json({ error: "Translation service unavailable." });
    }
    },
  );

  app.use((_request, response) => {
    response.status(404).json({ error: "Not found." });
  });

  return app;
};
