import { getDesignToken } from "@canva/design";
import { auth } from "@canva/user";

export type PersistedWarningPreferences = {
  autoAcknowledgedWarningCodes: string[];
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

export const loadWarningPreferences = async (
  overrides: Partial<Dependencies> = {},
): Promise<PersistedWarningPreferences> => {
  const response = await authorizedRequest(
    "/api/canva/warning-preferences/get",
    {},
    overrides,
  );

  if (!response.ok) {
    throw new Error("Could not load warning preferences.");
  }

  const result = (await response.json()) as {
    preferences:
      | {
          autoAcknowledgedWarningCodes: string[];
          updatedAt: string;
        }
      | null;
  };

  return {
    autoAcknowledgedWarningCodes:
      result.preferences?.autoAcknowledgedWarningCodes ?? [],
    updatedAt: result.preferences?.updatedAt,
  };
};

export const saveWarningPreferences = async (
  autoAcknowledgedWarningCodes: ReadonlySet<string>,
  overrides: Partial<Dependencies> = {},
): Promise<void> => {
  const response = await authorizedRequest(
    "/api/canva/warning-preferences/save",
    {
      autoAcknowledgedWarningCodes: [...autoAcknowledgedWarningCodes],
    },
    overrides,
  );

  if (!response.ok) {
    throw new Error("Could not save warning preferences.");
  }
};
