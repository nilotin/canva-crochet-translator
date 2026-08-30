import { getDesignToken } from "@canva/design";
import { auth } from "@canva/user";

export type PersistedBulkPreferences = {
  excludedPageIds: string[];
  updatedAt?: string;
};

type Dependencies = {
  getDesignToken: typeof getDesignToken;
  getUserToken: typeof auth.getCanvaUserToken;
  fetch: typeof fetch;
  backendHost: string;
};

const dependencies = (overrides: Partial<Dependencies> = {}): Dependencies => ({
  getDesignToken,
  getUserToken: auth.getCanvaUserToken,
  fetch: (...input) => globalThis.fetch(...input),
  backendHost: typeof BACKEND_HOST === "string" ? BACKEND_HOST : "",
  ...overrides,
});

const authorizedRequest = async (
  path: string,
  body: Record<string, unknown>,
  overrides: Partial<Dependencies> = {},
): Promise<Response> => {
  const deps = dependencies(overrides);
  const [{ token: designToken }, userToken] = await Promise.all([
    deps.getDesignToken(),
    deps.getUserToken(),
  ]);

  return deps.fetch(`${deps.backendHost.replace(/\/$/u, "")}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...body,
      designToken,
    }),
  });
};

export const loadBulkPreferences = async (
  overrides: Partial<Dependencies> = {},
): Promise<PersistedBulkPreferences> => {
  const response = await authorizedRequest(
    "/api/canva/bulk-preferences/get",
    {},
    overrides,
  );

  if (!response.ok) {
    throw new Error("Could not load bulk preferences.");
  }

  const result = (await response.json()) as {
    preferences:
      | {
          excludedPageIds: string[];
          updatedAt: string;
        }
      | null;
  };

  return {
    excludedPageIds: result.preferences?.excludedPageIds ?? [],
    updatedAt: result.preferences?.updatedAt,
  };
};

export const saveBulkPreferences = async (
  excludedPageIds: ReadonlySet<string>,
  overrides: Partial<Dependencies> = {},
): Promise<void> => {
  const response = await authorizedRequest(
    "/api/canva/bulk-preferences/save",
    {
      excludedPageIds: [...excludedPageIds],
    },
    overrides,
  );

  if (!response.ok) {
    throw new Error("Could not save bulk preferences.");
  }
};
