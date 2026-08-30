import { describe, expect, it } from "vitest";
import { isOriginAllowed, parseAllowedOrigins } from "../cors.js";

const configuredOrigins = parseAllowedOrigins(
  "http://localhost:8080,https://app-aahogasacqo.canva-apps.com",
);

describe("CORS origin allowlist", () => {
  it("allows the configured localhost origin", () => {
    expect(isOriginAllowed("http://localhost:8080", configuredOrigins)).toBe(
      true,
    );
  });

  it("allows the configured Canva app origin", () => {
    expect(
      isOriginAllowed(
        "https://app-aahogasacqo.canva-apps.com",
        configuredOrigins,
      ),
    ).toBe(true);
  });

  it("rejects an unknown origin instead of reflecting it", () => {
    expect(isOriginAllowed("https://attacker.example", configuredOrigins)).toBe(
      false,
    );
  });

  it("supports requests without an Origin header", () => {
    expect(isOriginAllowed(undefined, configuredOrigins)).toBe(true);
  });

  it("rejects wildcard configuration", () => {
    expect(() => parseAllowedOrigins("*")).toThrow(
      "ALLOWED_ORIGINS must not contain a wildcard.",
    );
  });

  it.each([
    "https://app-aahogasacqo.canva-apps.com/path",
    "https://app-aahogasacqo.canva-apps.com?query=value",
    "not-an-origin",
  ])("rejects non-origin configuration %s", (entry) => {
    expect(() => parseAllowedOrigins(entry)).toThrow(
      "ALLOWED_ORIGINS contains an invalid origin",
    );
  });
});
