import { getDesignMetadata, getDesignToken } from "@canva/design";
import { auth } from "@canva/user";
import type { TargetLanguage } from "./copy_designs";

export type TranslationTargetContext = {
  isTranslationTarget: true;
  language: TargetLanguage;
  sourceTitle: string;
  contextId: string;
  pageCount?: number;
};

export type DesignRole =
  | TranslationTargetContext
  | { isTranslationTarget: false };

type Dependencies = {
  getDesignToken: () => Promise<{ token: string }>;
  getUserToken: () => Promise<string>;
  getMetadata: () => Promise<{ pageMetadata: Iterable<unknown> }>;
  fetch: typeof fetch;
  backendHost: string;
};

export const loadTargetContext = async (
  overrides: Partial<Dependencies> = {},
): Promise<DesignRole> => {
  const dependencies: Dependencies = {
    getDesignToken,
    getUserToken: auth.getCanvaUserToken,
    getMetadata: getDesignMetadata,
    fetch: (...input) => globalThis.fetch(...input),
    backendHost: typeof BACKEND_HOST === "string" ? BACKEND_HOST : "",
    ...overrides,
  };
  const [{ token: designToken }, userToken, metadata] = await Promise.all([
    dependencies.getDesignToken(),
    dependencies.getUserToken(),
    dependencies.getMetadata().catch(() => undefined),
  ]);
  const response = await dependencies.fetch(
    `${dependencies.backendHost.replace(/\/$/u, "")}/api/canva/target-context`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ designToken }),
    },
  );
  if (!response.ok)
    throw new Error("Could not determine the Canva design role.");
  const result: unknown = await response.json();
  if (
    typeof result !== "object" ||
    result == null ||
    !("isTranslationTarget" in result)
  ) {
    throw new Error("Invalid target context response.");
  }
  if (result.isTranslationTarget === false)
    return { isTranslationTarget: false };
  if (
    result.isTranslationTarget === true &&
    "language" in result &&
    (result.language === "en" || result.language === "es") &&
    "sourceTitle" in result &&
    typeof result.sourceTitle === "string" &&
    "contextId" in result &&
    typeof result.contextId === "string"
  ) {
    return {
      isTranslationTarget: true,
      language: result.language,
      sourceTitle: result.sourceTitle,
      contextId: result.contextId,
      pageCount: metadata ? [...metadata.pageMetadata].length : undefined,
    };
  }
  throw new Error("Invalid target context response.");
};
