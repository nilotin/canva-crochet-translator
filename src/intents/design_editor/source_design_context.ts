import { getDesignMetadata, getDesignToken } from "@canva/design";
import { auth } from "@canva/user";

export type SourceDesignContext = {
  verified: boolean;
  title?: string;
  pageCount?: number;
};

export type SourceContextFailureStage =
  | "design_token_failed"
  | "user_token_failed"
  | "metadata_failed"
  | "backend_request_failed"
  | "backend_verification_failed";

type SourceMetadata = {
  title?: string;
  pageMetadata: Iterable<unknown>;
};

type SourceContextDependencies = {
  getDesignToken: () => Promise<{ token: string }>;
  getUserToken: () => Promise<string>;
  getMetadata: () => Promise<SourceMetadata>;
  fetch: typeof fetch;
  backendHost: string;
  isDevelopment: boolean;
  logger: Pick<Console, "error" | "warn">;
};

type VerifiedContextResponse = {
  verified: true;
};

export class SourceDesignContextError extends Error {
  constructor(
    public readonly stage: Exclude<
      SourceContextFailureStage,
      "metadata_failed"
    >,
    public readonly httpStatus?: number,
  ) {
    super(`Source design initialization failed at ${stage}.`);
    this.name = "SourceDesignContextError";
  }
}

const getDefaultDependencies = (): SourceContextDependencies => ({
  getDesignToken,
  getUserToken: auth.getCanvaUserToken,
  getMetadata: getDesignMetadata,
  fetch: (...input) => globalThis.fetch(...input),
  // Canva App Scripts injects BACKEND_HOST from CANVA_BACKEND_HOST.
  backendHost: typeof BACKEND_HOST === "string" ? BACKEND_HOST : "",
  isDevelopment: process.env.NODE_ENV !== "production",
  logger: console,
});

const isVerifiedContextResponse = (
  value: unknown,
): value is VerifiedContextResponse =>
  typeof value === "object" &&
  value != null &&
  "verified" in value &&
  value.verified === true;

const sanitizeMessage = (cause: unknown, secrets: readonly string[]) => {
  const error = cause instanceof Error ? cause : new Error("Unknown error");
  let message = error.message.replace(
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu,
    "[redacted-jwt]",
  );
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join("[redacted-token]");
  }
  return { errorName: error.name, errorMessage: message };
};

const logDiagnostic = (
  dependencies: SourceContextDependencies,
  stage: SourceContextFailureStage,
  cause: unknown,
  secrets: readonly string[] = [],
  httpStatus?: number,
) => {
  if (!dependencies.isDevelopment) return;
  const details = sanitizeMessage(cause, secrets);
  const diagnostic = {
    stage,
    ...details,
    ...(httpStatus === undefined ? {} : { httpStatus }),
  };
  if (stage === "metadata_failed") {
    dependencies.logger.warn("Canva source context warning", diagnostic);
  } else {
    dependencies.logger.error("Canva source context error", diagnostic);
  }
};

export const buildDesignContextUrl = (backendHost: string) =>
  `${backendHost.replace(/\/$/u, "")}/api/canva/design-context`;

export const loadSourceDesignContext = async (
  overrides: Partial<SourceContextDependencies> = {},
): Promise<SourceDesignContext> => {
  const dependencies = { ...getDefaultDependencies(), ...overrides };

  let designToken: string;
  try {
    ({ token: designToken } = await dependencies.getDesignToken());
    if (!designToken) throw new Error("Canva returned an empty design token.");
  } catch (cause) {
    logDiagnostic(dependencies, "design_token_failed", cause);
    throw new SourceDesignContextError("design_token_failed");
  }

  let userToken: string;
  try {
    userToken = await dependencies.getUserToken();
    if (!userToken) throw new Error("Canva returned an empty user token.");
  } catch (cause) {
    logDiagnostic(dependencies, "user_token_failed", cause, [designToken]);
    throw new SourceDesignContextError("user_token_failed");
  }

  let metadata: SourceMetadata | undefined;
  try {
    metadata = await dependencies.getMetadata();
  } catch (cause) {
    logDiagnostic(dependencies, "metadata_failed", cause, [
      designToken,
      userToken,
    ]);
  }

  let response: Response;
  try {
    response = await dependencies.fetch(
      buildDesignContextUrl(dependencies.backendHost),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ designToken }),
      },
    );
  } catch (cause) {
    logDiagnostic(dependencies, "backend_request_failed", cause, [
      designToken,
      userToken,
    ]);
    throw new SourceDesignContextError("backend_request_failed");
  }

  if (!response.ok) {
    logDiagnostic(
      dependencies,
      "backend_verification_failed",
      new Error("Backend rejected Canva design verification."),
      [designToken, userToken],
      response.status,
    );
    throw new SourceDesignContextError(
      "backend_verification_failed",
      response.status,
    );
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch (cause) {
    logDiagnostic(dependencies, "backend_verification_failed", cause, [
      designToken,
      userToken,
    ]);
    throw new SourceDesignContextError("backend_verification_failed");
  }

  if (!isVerifiedContextResponse(result)) {
    logDiagnostic(
      dependencies,
      "backend_verification_failed",
      new Error("Backend returned an invalid verification response."),
      [designToken, userToken],
      response.status,
    );
    throw new SourceDesignContextError(
      "backend_verification_failed",
      response.status,
    );
  }

  return {
    verified: true,
    title: metadata?.title,
    pageCount: metadata ? [...metadata.pageMetadata].length : undefined,
  };
};
