import { describe, expect, it } from "vitest";
import { compareRegistryFingerprints } from "../registry_diagnostics.js";

describe("compareRegistryFingerprints", () => {
  it("reports observed fingerprints that have no registry entry", () => {
    const result = compareRegistryFingerprints(
      [
        {
          fingerprint: "page-content-v1-known",
          kind: "front_cover",
          blockCounts: { en: 2, es: 2 },
        },
      ],
      [
        "page-content-v1-known",
        "page-content-v1-f5b0572e8967695e",
        "page-content-v1-1261c14d8cfb624b",
      ],
    );

    expect(result.unregisteredFingerprints).toEqual([
      "page-content-v1-f5b0572e8967695e",
      "page-content-v1-1261c14d8cfb624b",
    ]);
  });

  it("reports registered templates that were never observed", () => {
    const result = compareRegistryFingerprints(
      [
        {
          fingerprint: "page-content-v1-known",
          kind: "front_cover",
          blockCounts: { en: 2, es: 2 },
        },
        {
          fingerprint: "page-content-v1-stale",
          kind: "closing",
          blockCounts: { en: 4, es: 4 },
        },
      ],
      ["page-content-v1-known"],
    );

    expect(result.orphanedTemplates).toEqual([
      {
        fingerprint: "page-content-v1-stale",
        kind: "closing",
        blockCounts: { en: 4, es: 4 },
      },
    ]);
  });

  it("reports nothing when every observed fingerprint is registered and every registered one was observed", () => {
    const result = compareRegistryFingerprints(
      [
        {
          fingerprint: "page-content-v1-known",
          kind: "front_cover",
          blockCounts: { en: 2, es: 2 },
        },
      ],
      ["page-content-v1-known"],
    );

    expect(result.unregisteredFingerprints).toEqual([]);
    expect(result.orphanedTemplates).toEqual([]);
  });

  it("de-duplicates repeated observed fingerprints", () => {
    const result = compareRegistryFingerprints(
      [],
      [
        "page-content-v1-a",
        "page-content-v1-a",
        "page-content-v1-b",
      ],
    );

    expect(result.unregisteredFingerprints).toEqual([
      "page-content-v1-a",
      "page-content-v1-b",
    ]);
  });

  it("never touches or requires translation content, only fingerprint/kind/count metadata", () => {
    // Reproduces the real E2E symptom: three template candidates, all
    // reported as fingerprint_not_registered, against the actual current
    // registry contents (three unrelated, previously-registered templates).
    const result = compareRegistryFingerprints(
      [
        {
          fingerprint: "page-content-v1-2c4d77bb60f3304d",
          kind: "front_cover",
          blockCounts: { en: 2, es: 2 },
        },
        {
          fingerprint: "page-content-v1-3f23ed57bab41245",
          kind: "materials_reference",
          blockCounts: { en: 4, es: 4 },
        },
        {
          fingerprint: "page-content-v1-90eafa786fd21b9a",
          kind: "closing",
          blockCounts: { en: 4, es: 4 },
        },
      ],
      [
        "page-content-v1-f5b0572e8967695e",
        "page-content-v1-1261c14d8cfb624b",
        "page-content-v1-cdcb2c2c37c7e632",
      ],
    );

    expect(result.unregisteredFingerprints).toEqual([
      "page-content-v1-f5b0572e8967695e",
      "page-content-v1-1261c14d8cfb624b",
      "page-content-v1-cdcb2c2c37c7e632",
    ]);
    expect(result.orphanedTemplates.map((t) => t.fingerprint)).toEqual([
      "page-content-v1-2c4d77bb60f3304d",
      "page-content-v1-3f23ed57bab41245",
      "page-content-v1-90eafa786fd21b9a",
    ]);
  });
});
