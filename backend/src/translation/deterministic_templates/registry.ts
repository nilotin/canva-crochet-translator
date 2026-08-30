import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const templateDefinitionSchema = z
  .object({
    fingerprint: z.string().min(1).max(500),
    kind: z.enum(["front_cover", "materials_reference", "closing"]),
    translations: z.object({
      en: z.array(z.string()).max(100),
      es: z.array(z.string()).max(100),
    }),
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

export type DeterministicTemplateRegistry = {
  findByFingerprint(
    fingerprint: string,
  ): Promise<DeterministicTemplateDefinition | undefined>;
};

export class JsonDeterministicTemplateRegistry
  implements DeterministicTemplateRegistry
{
  readonly path: string;

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

  private async read() {
    let content: string;

    try {
      content = await readFile(this.path, "utf8");
    } catch (cause) {
      if (
        cause instanceof Error &&
        "code" in cause &&
        cause.code === "ENOENT"
      ) {
        return {
          version: 1 as const,
          templates: [],
        };
      }

      return {
        version: 1 as const,
        templates: [],
      };
    }

    let decoded: unknown;

    try {
      decoded = JSON.parse(content);
    } catch {
      return {
        version: 1 as const,
        templates: [],
      };
    }

    const parsed = registryFileSchema.safeParse(decoded);

    if (!parsed.success) {
      return {
        version: 1 as const,
        templates: [],
      };
    }

    return parsed.data;
  }
}
