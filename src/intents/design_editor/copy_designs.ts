import { getDesignToken } from "@canva/design";
import { requestOpenExternalUrl } from "@canva/platform";
import { auth } from "@canva/user";

export type TargetLanguage = "en" | "es";

export type CopiedDesign = {
  language: TargetLanguage;
  copiedDesignId: string;
  editUrl: string;
  desiredTitle: string;
  reused: boolean;
};

type Dependencies = {
  getDesignToken: () => Promise<{ token: string }>;
  getUserToken: () => Promise<string>;
  fetch: typeof fetch;
  backendHost: string;
};

const defaults = (): Dependencies => ({
  getDesignToken,
  getUserToken: auth.getCanvaUserToken,
  fetch: (...input) => globalThis.fetch(...input),
  backendHost: typeof BACKEND_HOST === "string" ? BACKEND_HOST : "",
});

export class CopyDesignError extends Error {
  constructor(public readonly code: string) {
    super("Could not create the Canva design copy.");
    this.name = "CopyDesignError";
  }
}

const postVerified = async (
  path: string,
  body: Record<string, unknown>,
  overrides: Partial<Dependencies>,
) => {
  const dependencies = { ...defaults(), ...overrides };
  const [{ token: designToken }, userToken] = await Promise.all([
    dependencies.getDesignToken(),
    dependencies.getUserToken(),
  ]);
  const response = await dependencies.fetch(
    `${dependencies.backendHost.replace(/\/$/u, "")}${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ designToken, ...body }),
    },
  );
  const result: unknown = await response.json();
  if (!response.ok) {
    const code =
      typeof result === "object" &&
      result &&
      "error" in result &&
      typeof result.error === "object" &&
      result.error &&
      "code" in result.error &&
      typeof result.error.code === "string"
        ? result.error.code
        : "COPY_FAILED";
    throw new CopyDesignError(code);
  }
  return result;
};

const isCopiedDesign = (value: unknown): value is CopiedDesign =>
  typeof value === "object" &&
  value != null &&
  "language" in value &&
  (value.language === "en" || value.language === "es") &&
  "copiedDesignId" in value &&
  typeof value.copiedDesignId === "string" &&
  "editUrl" in value &&
  typeof value.editUrl === "string" &&
  "desiredTitle" in value &&
  typeof value.desiredTitle === "string" &&
  "reused" in value &&
  typeof value.reused === "boolean";

export const createDesignCopy = async (
  language: TargetLanguage,
  sourceTitle?: string,
  overrides: Partial<Dependencies> = {},
) => {
  const result = await postVerified(
    "/api/canva/designs/copy",
    { targetLanguage: language, sourceTitle },
    overrides,
  );
  if (!isCopiedDesign(result)) throw new CopyDesignError("INVALID_RESPONSE");
  return result;
};

export const startCanvaConnectAuthorization = async (
  overrides: Partial<Dependencies> = {},
) => {
  const result = await postVerified(
    "/api/canva/connect/oauth/authorize",
    {},
    overrides,
  );
  if (
    typeof result !== "object" ||
    result == null ||
    !("authorizationUrl" in result) ||
    typeof result.authorizationUrl !== "string"
  ) {
    throw new CopyDesignError("INVALID_RESPONSE");
  }
  await requestOpenExternalUrl({ url: result.authorizationUrl });
};

export const openCopiedDesign = async (url: string) =>
  requestOpenExternalUrl({ url });
