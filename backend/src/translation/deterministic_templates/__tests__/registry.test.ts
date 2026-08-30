import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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

  it("behaves as an empty registry when the private file contains malformed JSON", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "registry.json");

    await writeFile(path, '{"version":1,"templates":', "utf8");

    const registry = new JsonDeterministicTemplateRegistry(path);

    await expect(
      registry.findByFingerprint("page-content-v1-known"),
    ).resolves.toBeUndefined();
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
});
