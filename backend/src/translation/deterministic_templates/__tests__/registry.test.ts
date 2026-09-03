import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JsonDeterministicTemplateRegistry } from "../registry.js";

const temporaryDirectories: string[] = [];

const temporaryDirectory = async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "deterministic-template-registry-"),
  );
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("deterministic template registry", () => {
  it("returns an exact fingerprint match", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "registry.json");

    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        templates: [
          {
            fingerprint: "page-content-v1-known",
            kind: "front_cover",
            translations: {
              en: ["Synthetic English title"],
              es: ["Título sintético"],
            },
          },
        ],
      }),
      "utf8",
    );

    const registry = new JsonDeterministicTemplateRegistry(path);

    await expect(
      registry.findByFingerprint("page-content-v1-known"),
    ).resolves.toMatchObject({
      fingerprint: "page-content-v1-known",
      kind: "front_cover",
      translations: {
        en: ["Synthetic English title"],
        es: ["Título sintético"],
      },
    });
  });

  it("summarizes registered templates without exposing their translations", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "registry.json");

    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        templates: [
          {
            fingerprint: "page-content-v1-known",
            kind: "front_cover",
            translations: {
              en: ["Synthetic English title", "Second block"],
              es: ["Título sintético"],
            },
          },
        ],
      }),
      "utf8",
    );

    const registry = new JsonDeterministicTemplateRegistry(path);
    const summaries = await registry.listTemplateSummaries();

    expect(summaries).toEqual([
      {
        fingerprint: "page-content-v1-known",
        kind: "front_cover",
        blockCounts: { en: 2, es: 1 },
      },
    ]);
    // Never the translated/customer text itself.
    expect(JSON.stringify(summaries)).not.toContain("Synthetic");
    expect(JSON.stringify(summaries)).not.toContain("sintético");
  });

  it("does not fuzzy-match a changed fingerprint", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "registry.json");

    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        templates: [
          {
            fingerprint: "page-content-v1-known",
            kind: "closing",
            translations: {
              en: ["Synthetic ending"],
              es: ["Final sintético"],
            },
          },
        ],
      }),
      "utf8",
    );

    const registry = new JsonDeterministicTemplateRegistry(path);

    await expect(
      registry.findByFingerprint("page-content-v1-changed"),
    ).resolves.toBeUndefined();
  });

  it("behaves as an empty registry when the private file is missing", async () => {
    const directory = await temporaryDirectory();

    const registry = new JsonDeterministicTemplateRegistry(
      join(directory, "missing.json"),
    );

    await expect(
      registry.findByFingerprint("page-content-v1-known"),
    ).resolves.toBeUndefined();
  });

  it("stays silent (no diagnostic) when the registry file is simply missing", async () => {
    const directory = await temporaryDirectory();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const registry = new JsonDeterministicTemplateRegistry(
      join(directory, "missing.json"),
    );
    await registry.findByFingerprint("page-content-v1-known");

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("behaves as an empty registry when the private file contains malformed JSON", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "registry.json");

    await writeFile(path, '{"version":1,"templates":', "utf8");

    const registry = new JsonDeterministicTemplateRegistry(path);

    await expect(
      registry.findByFingerprint("page-content-v1-known"),
    ).resolves.toBeUndefined();
  });

  it("logs a development diagnostic (without file content) for malformed JSON", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "registry.json");
    await writeFile(path, '{"version":1,"templates":', "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const registry = new JsonDeterministicTemplateRegistry(path);
    await registry.findByFingerprint("page-content-v1-known");

    expect(warn).toHaveBeenCalledTimes(1);
    const loggedPayload = JSON.stringify(warn.mock.calls[0]);
    expect(loggedPayload).not.toContain("templates");
    warn.mockRestore();
  });

  it("behaves as an empty registry when the private file is invalid", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "registry.json");

    await writeFile(path, '{"version":1,"templates":"invalid"}', "utf8");

    const registry = new JsonDeterministicTemplateRegistry(path);

    await expect(
      registry.findByFingerprint("page-content-v1-known"),
    ).resolves.toBeUndefined();
  });

  it("logs a development diagnostic (without registry content) for a schema failure", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "registry.json");
    await writeFile(path, '{"version":1,"templates":"invalid"}', "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const registry = new JsonDeterministicTemplateRegistry(path);
    await registry.findByFingerprint("page-content-v1-known");

    expect(warn).toHaveBeenCalledTimes(1);
    const loggedPayload = JSON.stringify(warn.mock.calls[0]);
    expect(loggedPayload).not.toContain("invalid");
    warn.mockRestore();
  });
});

describe("deterministic template registry upsertTemplate", () => {
  it("adds a new template record and it becomes immediately findable", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "registry.json");
    const registry = new JsonDeterministicTemplateRegistry(path);

    await registry.upsertTemplate({
      fingerprint: "page-content-v1-new",
      kind: "front_cover",
      translations: { en: ["Synthetic"], es: ["Sintético"] },
    });

    await expect(
      registry.findByFingerprint("page-content-v1-new"),
    ).resolves.toMatchObject({
      fingerprint: "page-content-v1-new",
      kind: "front_cover",
    });
  });

  it("replaces an existing record for the same fingerprint rather than duplicating it", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "registry.json");
    const registry = new JsonDeterministicTemplateRegistry(path);

    await registry.upsertTemplate({
      fingerprint: "page-content-v1-same",
      kind: "front_cover",
      translations: { en: ["Old"], es: ["Viejo"] },
    });
    await registry.upsertTemplate({
      fingerprint: "page-content-v1-same",
      kind: "front_cover",
      translations: { en: ["New"], es: ["Nuevo"] },
    });

    const summaries = await registry.listTemplateSummaries();
    expect(summaries).toHaveLength(1);

    await expect(
      registry.findByFingerprint("page-content-v1-same"),
    ).resolves.toMatchObject({ translations: { en: ["New"], es: ["Nuevo"] } });
  });

  it("leaves other fingerprints untouched (never reattaches by kind)", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "registry.json");
    const registry = new JsonDeterministicTemplateRegistry(path);

    await registry.upsertTemplate({
      fingerprint: "page-content-v1-old-stale",
      kind: "front_cover",
      translations: { en: ["Stale"], es: ["Obsoleto"] },
    });
    await registry.upsertTemplate({
      fingerprint: "page-content-v1-new-live",
      kind: "front_cover",
      translations: { en: ["Fresh"], es: ["Nuevo"] },
    });

    const summaries = await registry.listTemplateSummaries();
    expect(summaries.map((summary) => summary.fingerprint).sort()).toEqual([
      "page-content-v1-new-live",
      "page-content-v1-old-stale",
    ]);
  });

  it("persists provenance metadata (schemaVersion, sourceBlockCount, sourceBlockHashes) round-trip", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "registry.json");
    const registry = new JsonDeterministicTemplateRegistry(path);

    await registry.upsertTemplate({
      fingerprint: "page-content-v1-provenance",
      kind: "materials_reference",
      translations: { en: ["A", "B"], es: ["C", "D"] },
      schemaVersion: 1,
      sourceBlockCount: 2,
      sourceBlockHashes: ["hash-1", "hash-2"],
      generatedAt: "2026-09-02T00:00:00.000Z",
      approvedBy: "qa-reviewer",
    });

    await expect(
      new JsonDeterministicTemplateRegistry(path).findByFingerprint(
        "page-content-v1-provenance",
      ),
    ).resolves.toMatchObject({
      schemaVersion: 1,
      sourceBlockCount: 2,
      sourceBlockHashes: ["hash-1", "hash-2"],
      approvedBy: "qa-reviewer",
    });
  });

  it("rejects an invalid record rather than writing it", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "registry.json");
    const registry = new JsonDeterministicTemplateRegistry(path);

    await expect(
      registry.upsertTemplate({
        fingerprint: "page-content-v1-bad",
        // @ts-expect-error -- deliberately invalid kind for this test
        kind: "not_a_real_kind",
        translations: { en: [], es: [] },
      }),
    ).rejects.toThrow();

    await expect(
      registry.findByFingerprint("page-content-v1-bad"),
    ).resolves.toBeUndefined();
  });

  it("remains valid for pre-existing records with no provenance fields (backward compatible)", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "registry.json");

    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        templates: [
          {
            fingerprint: "page-content-v1-legacy",
            kind: "closing",
            translations: { en: ["Legacy"], es: ["Antiguo"] },
          },
        ],
      }),
      "utf8",
    );

    const registry = new JsonDeterministicTemplateRegistry(path);

    await registry.upsertTemplate({
      fingerprint: "page-content-v1-new-with-provenance",
      kind: "front_cover",
      translations: { en: ["New"], es: ["Nuevo"] },
      schemaVersion: 1,
      sourceBlockCount: 1,
      sourceBlockHashes: ["hash-1"],
    });

    const summaries = await registry.listTemplateSummaries();
    expect(summaries).toHaveLength(2);
    await expect(
      registry.findByFingerprint("page-content-v1-legacy"),
    ).resolves.toMatchObject({ fingerprint: "page-content-v1-legacy" });
  });
});

describe("deterministic template registry replaceTemplateForKind", () => {
  it("retires the old fingerprint for the same kind and preserves other kinds", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "registry.json");
    const registry = new JsonDeterministicTemplateRegistry(path);

    await registry.upsertTemplate({
      fingerprint: "page-content-v1-old-front",
      kind: "front_cover",
      translations: { en: ["Old front"], es: ["Portada vieja"] },
    });

    await registry.upsertTemplate({
      fingerprint: "page-content-v1-closing",
      kind: "closing",
      translations: { en: ["Closing"], es: ["Cierre"] },
    });

    await registry.replaceTemplateForKind({
      fingerprint: "page-content-v1-new-front",
      kind: "front_cover",
      translations: { en: ["New front"], es: ["Portada nueva"] },
    });

    await expect(
      registry.findByFingerprint("page-content-v1-old-front"),
    ).resolves.toBeUndefined();

    await expect(
      registry.findByFingerprint("page-content-v1-new-front"),
    ).resolves.toMatchObject({
      fingerprint: "page-content-v1-new-front",
      kind: "front_cover",
      translations: {
        en: ["New front"],
        es: ["Portada nueva"],
      },
    });

    await expect(
      registry.findByFingerprint("page-content-v1-closing"),
    ).resolves.toMatchObject({
      kind: "closing",
    });

    const summaries = await registry.listTemplateSummaries();

    expect(summaries).toHaveLength(2);
    expect(
      summaries.filter((template) => template.kind === "front_cover"),
    ).toHaveLength(1);
  });

  it("refuses to reuse a fingerprint that is already registered for another kind", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "registry.json");
    const registry = new JsonDeterministicTemplateRegistry(path);

    await registry.upsertTemplate({
      fingerprint: "page-content-v1-collision",
      kind: "closing",
      translations: { en: ["Closing"], es: ["Cierre"] },
    });

    await expect(
      registry.replaceTemplateForKind({
        fingerprint: "page-content-v1-collision",
        kind: "front_cover",
        translations: { en: ["Front"], es: ["Portada"] },
      }),
    ).rejects.toThrow(
      'Fingerprint "page-content-v1-collision" is already registered for kind "closing".',
    );

    await expect(
      registry.findByFingerprint("page-content-v1-collision"),
    ).resolves.toMatchObject({
      kind: "closing",
      translations: {
        en: ["Closing"],
        es: ["Cierre"],
      },
    });

    const summaries = await registry.listTemplateSummaries();
    expect(summaries).toHaveLength(1);
  });
});
