import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

// The set of warning codes this feature is allowed to let a user
// permanently pre-approve. This is the actual safety boundary (enforced
// by the zod schema below, not just the frontend allowlist in
// bulk_review_state.ts): only routine, low-risk "needs_review" warning
// families belong here.
//
// MANUAL_REVIEW_RECOMMENDED is the existing warning code emitted for
// generic spatial/directional concept-combination reviews (e.g.
// "iç" + "sıra", "iç" + "dış") -- see
// backend/src/translation/validator.ts's findHighRiskInstructionConcepts
// check. It is reused here rather than inventing a parallel code.
//
// Deliberately excluded (see backend/src/translation/types.ts):
//   - SUSPICIOUSLY_SHORT_TRANSLATION, UNUSUALLY_LARGE_EXPANSION,
//     POSSIBLE_GLOSSARY_MISMATCH, TARGET_LANGUAGE_FLUENCY_REVIEW: each
//     depends on the specific translated text, not a routine concept
//     combination -- not safe to blanket pre-approve.
//   - SEMANTIC_ANCHOR_MISSING: covers critical placement-loss concepts
//     (front/above/below and similar). It also appears in ValidationCode
//     (hard error) and is escalated there by criticalPlacement in
//     semantic_anchors.ts -- never eligible, even in its soft-warning
//     form.
//   - Any INTEGRITY_BLOCK_CODES-family code: those are hard blockers by
//     construction and can never reach a needs_review warning through
//     normalizeReviewBlockSeverity in the first place.
export const ELIGIBLE_AUTO_ACKNOWLEDGE_WARNING_CODES = [
  "MANUAL_REVIEW_RECOMMENDED",
] as const;

export type EligibleAutoAcknowledgeWarningCode =
  (typeof ELIGIBLE_AUTO_ACKNOWLEDGE_WARNING_CODES)[number];

export const persistedWarningPreferencesSchema = z
  .object({
    userId: z.string().min(1),
    targetLanguage: z.enum(["en", "es"]),
    autoAcknowledgedWarningCodes: z
      .array(z.enum(ELIGIBLE_AUTO_ACKNOWLEDGE_WARNING_CODES))
      .max(ELIGIBLE_AUTO_ACKNOWLEDGE_WARNING_CODES.length),
    updatedAt: z.string().datetime(),
  })
  .strict();

const fileSchema = z
  .object({
    version: z.literal(1),
    preferences: z.array(persistedWarningPreferencesSchema),
  })
  .strict();

export type PersistedWarningPreferences = z.infer<
  typeof persistedWarningPreferencesSchema
>;

// Deliberately NOT keyed by targetDesignId: this preference means "I
// already decided how I want this warning family handled," not "for this
// one Canva design." Target language is included because warning
// semantics (and glossary/notation review) can differ by language.
export type WarningPreferencesKey = {
  userId: string;
  targetLanguage: "en" | "es";
};

export interface WarningPreferencesStore {
  getPreferences(
    input: WarningPreferencesKey,
  ): Promise<PersistedWarningPreferences | undefined>;

  savePreferences(preferences: PersistedWarningPreferences): Promise<void>;
}

export class WarningPreferencesStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WarningPreferencesStoreError";
  }
}

const keyMatches = (
  preferences: PersistedWarningPreferences,
  input: WarningPreferencesKey,
): boolean =>
  preferences.userId === input.userId &&
  preferences.targetLanguage === input.targetLanguage;

export class MemoryWarningPreferencesStore implements WarningPreferencesStore {
  private preferences: PersistedWarningPreferences[] = [];

  async getPreferences(input: WarningPreferencesKey) {
    return this.preferences.find((item) => keyMatches(item, input));
  }

  async savePreferences(preferences: PersistedWarningPreferences) {
    const parsed = persistedWarningPreferencesSchema.safeParse(preferences);

    if (!parsed.success) {
      throw new WarningPreferencesStoreError("Invalid warning preferences.");
    }

    this.preferences = this.preferences.filter(
      (item) => !keyMatches(item, parsed.data),
    );

    this.preferences.push(parsed.data);
  }
}

export class JsonWarningPreferencesStore implements WarningPreferencesStore {
  readonly path: string;

  private writeQueue: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = resolve(path);
  }

  async getPreferences(input: WarningPreferencesKey) {
    return (await this.read()).preferences.find((item) =>
      keyMatches(item, input),
    );
  }

  async savePreferences(
    preferences: PersistedWarningPreferences,
  ): Promise<void> {
    const parsed = persistedWarningPreferencesSchema.safeParse(preferences);

    if (!parsed.success) {
      throw new WarningPreferencesStoreError("Invalid warning preferences.");
    }

    const queued = this.writeQueue.then(async () => {
      const current = await this.read();

      const next = current.preferences.filter(
        (item) => !keyMatches(item, parsed.data),
      );

      next.push(parsed.data);

      await mkdir(dirname(this.path), { recursive: true });

      const temporaryPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;

      await writeFile(
        temporaryPath,
        `${JSON.stringify(
          {
            version: 1,
            preferences: next,
          },
          null,
          2,
        )}\n`,
        {
          encoding: "utf8",
          mode: 0o600,
        },
      );

      await rename(temporaryPath, this.path);
    });

    this.writeQueue = queued.catch(() => undefined);

    return queued;
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
          preferences: [],
        };
      }

      throw new WarningPreferencesStoreError(
        "Could not read warning-preferences store.",
      );
    }

    try {
      return fileSchema.parse(JSON.parse(content));
    } catch {
      throw new WarningPreferencesStoreError(
        "Warning-preferences store is corrupt.",
      );
    }
  }
}
