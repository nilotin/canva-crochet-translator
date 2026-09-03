// CLI: explicitly regenerate one deterministic template registry record
// from a captured source snapshot plus human-approved translations.
//
// Usage:
//   tsx src/translation/deterministic_templates/generate_template.ts \
//     --snapshot <path to a TemplateSourceSnapshot JSON file> \
//     --translations <path to an ApprovedTemplateTranslations JSON file> \
//     [--approved-by "Name or reference"] \
//     [--registry-path <path>]
//
// Where the snapshot comes from: captureTemplateCandidateSnapshot()
// (src/intents/design_editor/whole_document_classification.ts, frontend,
// development-only) run against the real Canva runtime, then saved to a
// local JSON file. This CLI has no Canva access itself.
//
// Where the translations come from: a human. This tool never invents
// them and never calls an LLM/provider -- see generation.ts for the
// full safety contract this enforces (exact fingerprint shape, exact
// block-count match per language, at least one language required).
//
// This is the ONLY intended way to write to the private deterministic
// template registry. A record is not active until this command
// completes successfully and the running backend re-reads (or is
// restarted to pick up) the registry file.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  buildDeterministicTemplateRecord,
  DeterministicTemplateGenerationError,
  type ApprovedTemplateTranslations,
  type TemplateSourceSnapshot,
} from "./generation.js";
import { JsonDeterministicTemplateRegistry } from "./registry.js";

const parseArgs = (argv: readonly string[]): Record<string, string> => {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}.`);
    }
    args[key] = value;
    index += 1;
  }
  return args;
};

const defaultRegistryPath = (): string =>
  process.env.DETERMINISTIC_TEMPLATE_REGISTRY_PATH ??
  fileURLToPath(
    new URL(
      "../../../../.data/private-deterministic-templates.json",
      import.meta.url,
    ),
  );

const readJson = async <T>(path: string, label: string): Promise<T> => {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (cause) {
    throw new Error(
      `Could not read ${label} file at "${path}": ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }

  try {
    return JSON.parse(content) as T;
  } catch (cause) {
    throw new Error(
      `${label} file at "${path}" is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
};

try {
  const args = parseArgs(process.argv.slice(2));

  if (!args.snapshot || !args.translations) {
    throw new Error(
      "Usage: --snapshot <path> --translations <path> [--approved-by <name>] [--registry-path <path>]",
    );
  }

  const snapshot = await readJson<TemplateSourceSnapshot>(
    args.snapshot,
    "snapshot",
  );
  const approvedTranslations = await readJson<ApprovedTemplateTranslations>(
    args.translations,
    "translations",
  );

  const record = buildDeterministicTemplateRecord(
    snapshot,
    approvedTranslations,
    args["approved-by"] ? { approvedBy: args["approved-by"] } : {},
  );

  const registryPath = args["registry-path"] ?? defaultRegistryPath();
  const registry = new JsonDeterministicTemplateRegistry(registryPath);

  await registry.replaceTemplateForKind(record);

  // Safe summary only -- structural facts, never source text or
  // translated text (see the module comment in generation.ts).
  console.log("Deterministic template record generated and saved.");
  console.log(
    JSON.stringify(
      {
        registryPath,
        fingerprint: record.fingerprint,
        kind: record.kind,
        sourceBlockCount: record.sourceBlockCount,
        languagesSaved: (["en", "es"] as const).filter(
          (language) => record.translations[language].length > 0,
        ),
        generatedAt: record.generatedAt,
        approvedBy: record.approvedBy,
      },
      null,
      2,
    ),
  );
} catch (cause) {
  const message =
    cause instanceof DeterministicTemplateGenerationError
      ? cause.message
      : cause instanceof Error
        ? cause.message
        : "Unknown error";

  console.error(`Deterministic template generation failed: ${message}`);
  process.exitCode = 1;
}
