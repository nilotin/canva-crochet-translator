import type { CorsOptions } from "cors";

export class CorsOriginRejectedError extends Error {
  constructor() {
    super("Request origin is not allowed.");
    this.name = "CorsOriginRejectedError";
  }
}

export const parseAllowedOrigins = (value: string): ReadonlySet<string> => {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    throw new Error("ALLOWED_ORIGINS must contain at least one origin.");
  }

  const origins = new Set<string>();
  for (const entry of entries) {
    if (entry === "*") {
      throw new Error("ALLOWED_ORIGINS must not contain a wildcard.");
    }

    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(`ALLOWED_ORIGINS contains an invalid origin: ${entry}`);
    }

    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.origin !== entry ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error(`ALLOWED_ORIGINS contains an invalid origin: ${entry}`);
    }
    origins.add(url.origin);
  }

  return origins;
};

export const isOriginAllowed = (
  origin: string | undefined,
  allowedOrigins: ReadonlySet<string>,
) => origin === undefined || allowedOrigins.has(origin);

export const createCorsOptions = (
  allowedOrigins: ReadonlySet<string>,
): CorsOptions => ({
  methods: ["GET", "POST"],
  origin: (origin, callback) => {
    if (isOriginAllowed(origin, allowedOrigins)) {
      callback(null, true);
      return;
    }
    callback(new CorsOriginRejectedError());
  },
});
