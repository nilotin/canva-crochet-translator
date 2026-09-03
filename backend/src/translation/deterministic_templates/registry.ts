import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

export const DETERMINISTIC_TEMPLATE_KINDS = [
  "front_cover",
  "materials_reference",
  "closing",
] as const;

export const DETERMINISTIC_TEMPLATE_SCHEMA_VERSION = 1;

// NOTE: this registry deliberately does NOT store approved/registered
// target formatting ranges. An earlier attempt added an optional
// targetFormattingRegions field here (plus matching support in
// generation.ts and deterministic_bypass.ts) so a human could hand-supply
// exact target character ranges per template record. That was removed:
// it required a human to compute correct character offsets for
// differently-sized translated strings by hand (exactly the failure mode
// this whole feature exists to avoid), it had no test coverage, and it
// was strictly redundant with deterministic_bypass.ts's existing
// computed-and-bounds-checked projection (projectDeterministicFormattingRegions),
// which is safe on its own and blocks (returns no target ranges) rather
// than guessing when projection cannot be trusted. See
// deterministic_bypass.ts for the actual formatting-safety mechanism.
const templateDefinitionSchema = z
  .object({
    fingerprint: z.string().min(1).max(500),
    kind: z.enum(DETERMINISTIC_TEMPLATE_KINDS),
    translations: z.object({
      en: z.array(z.string()).max(100),
      es: z.array(z.string()).max(100),
    }),
    // Provenance metadata (all optional, for backward compatibility with
    // records already on disk that predate this feature). Populated only
    // by the explicit regeneration workflow in ./generation.ts -- never
    // hand-edited, never inferred at runtime.
    //
    // sourceBlockHashes deliberately holds per-block hashes of the source
    // text, never the source text itself: this lets a human verify that a
    // registered record still corresponds to a given live source page
    // (by recomputing hashes from a fresh capture and comparing) without
    // the private registry file ever storing raw Turkish source content.
    schemaVersion: z.literal(DETERMINISTIC_TEMPLATE_SCHEMA_VERSION).optional(),
    sourceBlockCount: z.number().int().nonnegative().max(100).optional(),
    sourceBlockHashes: z.array(z.string().min(1).max(200)).max(100).optional(),
    generatedAt: z.string().datetime().optional(),
    approvedBy: z.string().min(1).max(200).optional(),
  })
  .strict();

const registryFileSchema = z
  .object({
    version: z.literal(1),
    templates: z.array(templateDefinitionSchema).max(1_000),
  })
  .strict();

export type DeterministicTemplateDefinition = z.infer<
  typeof templateDefinitionSchema
>;

// A safe, content-free summary of one registered template: just enough to
// diagnose a fingerprint mismatch (which real-run "fingerprint_not_registered"
// diagnostics in app.ts already report per miss) against what the registry
// actually holds -- never the translations/customer text.
export type RegisteredTemplateSummary = {
  fingerprint: string;
  kind: DeterministicTemplateDefinition["kind"];
  blockCounts: { en: number; es: number };
};

export type DeterministicTemplateRegistry = {
  findByFingerprint(
    fingerprint: string,
  ): Promise<DeterministicTemplateDefinition | undefined>;
  listTemplateSummaries(): Promise<RegisteredTemplateSummary[]>;
  // Writes (inserts or replaces, keyed by fingerprint) one template
  // record. Only ever called by the explicit regeneration workflow in
  // ./generation.ts -- runtime request handling (app.ts) never writes to
  // the registry. Replacing by fingerprint (not by kind) is deliberate:
  // it is what keeps this from ever "reattaching" a translation to a
  // fingerprint the human did not explicitly approve it for.
  upsertTemplate(template: DeterministicTemplateDefinition): Promise<void>;
  replaceTemplateForKind(
    template: DeterministicTemplateDefinition,
  ): Promise<void>;
};

export class JsonDeterministicTemplateRegistry
  implements DeterministicTemplateRegistry
{
  readonly path: string;

  private writeQueue: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = resolve(path);
  }

  async findByFingerprint(
    fingerprint: string,
  ): Promise<DeterministicTemplateDefinition | undefined> {
    const registry = await this.read();
    return registry.templates.find(
      (template) => template.fingerprint === fingerprint,
    );
  }

  // Inserts or replaces (by exact fingerprint) one template record, using
  // the same atomic temp-file-rename write pattern as the other private
  // stores in this codebase (bulk_preferences, warning_preferences). Only
  // ever invoked by the explicit CLI/regeneration workflow in
  // ./generation.ts -- never by request handling.
  async upsertTemplate(
    template: DeterministicTemplateDefinition,
  ): Promise<void> {
    const parsed = templateDefinitionSchema.safeParse(template);

    if (!parsed.success) {
      throw new Error("Invalid deterministic template record.");
    }

    const queued = this.writeQueue.then(async () => {
      const current = await this.read();

      const next = current.templates.filter(
        (existing) => existing.fingerprint !== parsed.data.fingerprint,
      );

      next.push(parsed.data);

      await mkdir(dirname(this.path), { recursive: true });

      const temporaryPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;

      await writeFile(
        temporaryPath,
        `${JSON.stringify({ version: 1, templates: next }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );

      await rename(temporaryPath, this.path);
    });

    this.writeQueue = queued.catch(() => undefined);

    return queued;
  }

  async replaceTemplateForKind(
    template: DeterministicTemplateDefinition,
  ): Promise<void> {
    const parsed = templateDefinitionSchema.safeParse(template);

    if (!parsed.success) {
      throw new Error("Invalid deterministic template record.");
    }

    const queued = this.writeQueue.then(async () => {
      const current = await this.read();

      const fingerprintCollision = current.templates.find(
        (existing) =>
          existing.fingerprint === parsed.data.fingerprint &&
          existing.kind !== parsed.data.kind,
      );

      if (fingerprintCollision) {
        throw new Error(
          `Fingerprint "${parsed.data.fingerprint}" is already registered for kind "${fingerprintCollision.kind}".`,
        );
      }

      const next = current.templates.filter(
        (existing) =>
          existing.kind !== parsed.data.kind &&
          existing.fingerprint !== parsed.data.fingerprint,
      );

      next.push(parsed.data);

      await mkdir(dirname(this.path), { recursive: true });

      const temporaryPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;

      await writeFile(
        temporaryPath,
        `${JSON.stringify({ version: 1, templates: next }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );

      await rename(temporaryPath, this.path);
    });

    this.writeQueue = queued.catch(() => undefined);

    return queued;
  }

  async listTemplateSummaries(): Promise<RegisteredTemplateSummary[]> {
    const registry = await this.read();
    return registry.templates.map((template) => ({
      fingerprint: template.fingerprint,
      kind: template.kind,
      blockCounts: {
        en: template.translations.en.length,
        es: template.translations.es.length,
      },
    }));
  }

  private async read() {
    const empty = { version: 1 as const, templates: [] };
    let content: string;

    try {
      content = await readFile(this.path, "utf8");
    } catch (cause) {
      const isMissingFile =
        cause instanceof Error && "code" in cause && cause.code === "ENOENT";

      if (!isMissingFile) {
        // A missing file is the expected, silent "no templates configured"
        // state. Any other failure (permissions, disk, a bad
        // DETERMINISTIC_TEMPLATE_REGISTRY_PATH) is a misconfiguration that
        // would otherwise silently disable every deterministic template
        // match with no signal at all -- surface it, without logging the
        // registry's contents.
        console.warn(
          "Deterministic template registry could not be read; " +
            "falling back to an empty registry.",
          { path: this.path, error: cause instanceof Error ? cause.message : String(cause) },
        );
      }

      return empty;
    }

    let decoded: unknown;

    try {
      decoded = JSON.parse(content);
    } catch (cause) {
      console.warn(
        "Deterministic template registry contains invalid JSON; " +
          "falling back to an empty registry.",
        { path: this.path, error: cause instanceof Error ? cause.message : String(cause) },
      );
      return empty;
    }

    const parsed = registryFileSchema.safeParse(decoded);

    if (!parsed.success) {
      console.warn(
        "Deterministic template registry failed schema validation; " +
          "falling back to an empty registry.",
        { path: this.path, issues: parsed.error.issues.length },
      );
      return empty;
    }

    return parsed.data;
  }
}
