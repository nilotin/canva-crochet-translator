/**
 * Recording provider for corpus replay (test support only).
 *
 * Implements the production `TranslationProvider` interface with three
 * hermetic behaviors:
 *
 *  - none:   any provider contact throws. Tripwire for zero-provider cases.
 *  - oracle: answers by EXACT block text (never by call index), so a later
 *            stage that sends different fragments produces a loud, specific
 *            miss instead of a silently shifted answer.
 *  - echo:   returns every block unchanged.
 *
 * It records every call in order, including attempts that were refused. It
 * stores prompt hashes, never prompts. It reads no environment variable, uses
 * no clock, and makes no network access.
 *
 * Import rules (enforced by harness_selftest.test.ts): only the production
 * `provider.js` interface types (type import), plus `./schema.js` and
 * `./canonicalize.js`.
 *
 * Decisions:
 *  - Refusals reject the returned promise, like any provider failure. The
 *    spy ALSO records a violation, so a caller that swallows the rejection
 *    still cannot make the run look clean: call `assertClean()`.
 *  - An oracle call with any missing block fails as a whole. No partial
 *    answer is returned.
 */
import type {
  ProviderReadiness,
  TranslationProvider,
  TranslationProviderRequest,
  TranslationProviderResult,
} from "../../providers/provider.js";
import { sha256Hex } from "./canonicalize.js";
import {
  providerConfigSchema,
  type ProviderCallTrace,
  type ProviderConfig,
} from "./schema.js";

export type SpyMode = ProviderConfig["mode"];

export type OracleMissDetail = {
  callIndex: number;
  blockId: string;
  blockText: string;
};

export type SpyViolation =
  | {
      kind: "tripwire";
      operation: "translate" | "checkReadiness";
      /** Index of the recorded call, or null for checkReadiness. */
      callIndex: number | null;
    }
  | ({ kind: "oracle-miss" } & OracleMissDetail);

export class ProviderTripwireError extends Error {
  constructor(
    readonly operation: "translate" | "checkReadiness",
    readonly callIndex: number | null,
  ) {
    super(
      `Provider contact in "none" mode (${operation}${
        callIndex === null ? "" : `, call #${callIndex}`
      }). ` +
        "This case is recorded as zero-provider, so the pipeline must resolve it without any provider. " +
        "A provider is now being asked to translate text that previously never reached one.",
    );
    this.name = "ProviderTripwireError";
  }
}

const excerpt = (text: string): string =>
  text.length > 120 ? `${text.slice(0, 120)}...` : text;

export class OracleMissError extends Error {
  readonly misses: readonly OracleMissDetail[];

  constructor(misses: readonly OracleMissDetail[]) {
    const first = misses[0];
    super(
      `Oracle has no entry for ${misses.length} block(s) in this call. ` +
        (first === undefined
          ? ""
          : `First: block "${first.blockId}" text ${JSON.stringify(excerpt(first.blockText))}. `) +
        "The pipeline sent provider text that was not recorded for this case. " +
        "Either behavior changed (review the trace diff) or the oracle entries need an intentional update.",
    );
    this.name = "OracleMissError";
    this.misses = misses.map((miss) => ({ ...miss }));
  }
}

const cloneCall = (call: ProviderCallTrace): ProviderCallTrace => ({
  targetLanguage: call.targetLanguage,
  blockIds: [...call.blockIds],
  blockTexts: [...call.blockTexts],
  systemPromptSha256: call.systemPromptSha256,
  userPromptSha256: call.userPromptSha256,
});

export class SpyProvider implements TranslationProvider {
  readonly name = "corpus-spy";
  readonly model: string;
  readonly mode: SpyMode;

  readonly #oracle: ReadonlyMap<string, string>;
  readonly #calls: ProviderCallTrace[] = [];
  readonly #violations: SpyViolation[] = [];
  #readinessChecks = 0;

  constructor(config: ProviderConfig) {
    const parsed = providerConfigSchema.parse(config);
    this.mode = parsed.mode;
    this.model = `spy-${parsed.mode}`;
    this.#oracle = new Map(
      parsed.mode === "oracle"
        ? parsed.entries.map((entry) => [entry.source, entry.translated])
        : [],
    );
  }

  /** Every call in order, including refused ones. Copies. */
  get calls(): readonly ProviderCallTrace[] {
    return this.#calls.map(cloneCall);
  }

  get violations(): readonly SpyViolation[] {
    return this.#violations.map((violation) => ({ ...violation }));
  }

  get readinessCheckCount(): number {
    return this.#readinessChecks;
  }

  /** Throws if any tripwire or oracle miss happened, even if it was swallowed. */
  assertClean(): void {
    if (this.#violations.length > 0) {
      throw new Error(
        `Spy provider recorded ${this.#violations.length} violation(s): ${JSON.stringify(this.#violations)}`,
      );
    }
  }

  async translate(
    request: TranslationProviderRequest,
  ): Promise<TranslationProviderResult> {
    const callIndex = this.#calls.length;
    // Recorded first, from copies, so nothing the caller does to its own
    // arrays afterwards can alter the record.
    this.#calls.push({
      targetLanguage: request.targetLanguage,
      blockIds: request.blocks.map((block) => block.id),
      blockTexts: request.blocks.map((block) => block.text),
      systemPromptSha256: sha256Hex(request.systemPrompt),
      userPromptSha256: sha256Hex(request.userPrompt),
    });

    if (this.mode === "none") {
      this.#violations.push({ kind: "tripwire", operation: "translate", callIndex });
      throw new ProviderTripwireError("translate", callIndex);
    }

    if (this.mode === "echo") {
      return {
        translations: request.blocks.map((block) => ({
          id: block.id,
          translated: block.text,
        })),
      };
    }

    const translations: { id: string; translated: string }[] = [];
    const misses: OracleMissDetail[] = [];
    for (const block of request.blocks) {
      const translated = this.#oracle.get(block.text);
      if (translated === undefined) {
        misses.push({ callIndex, blockId: block.id, blockText: block.text });
      } else {
        translations.push({ id: block.id, translated });
      }
    }

    if (misses.length > 0) {
      for (const miss of misses) {
        this.#violations.push({ kind: "oracle-miss", ...miss });
      }
      throw new OracleMissError(misses);
    }

    return { translations };
  }

  async checkReadiness(): Promise<ProviderReadiness> {
    this.#readinessChecks += 1;
    if (this.mode === "none") {
      this.#violations.push({
        kind: "tripwire",
        operation: "checkReadiness",
        callIndex: null,
      });
      throw new ProviderTripwireError("checkReadiness", null);
    }
    return { ok: true, provider: this.name, model: this.model };
  }
}
