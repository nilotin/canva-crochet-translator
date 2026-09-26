/**
 * Capture wrapper for `translateBlocks` (test support only, Stage 0 Step 6).
 *
 * `createCapturingTranslateBlocks(original, hooks)` returns a function with the
 * same signature as the real `translateBlocks`. Each call:
 *
 *  1. snapshots the request (before anything can mutate it);
 *  2. wraps the test's own provider so every provider call is recorded
 *     (exact block texts, prompt hashes, exact response or thrown error) while
 *     the test's provider still does exactly what it always did;
 *  3. calls the REAL `translateBlocks` and returns its result untouched;
 *  4. emits one `CaptureRecord` to the sink.
 *
 * Transparency rules:
 *  - the provider's `translate` is invoked as `provider.translate(request)`
 *    with the very same request object, so `this`, argument identity and any
 *    state the test double keeps behave as before; the same for
 *    `checkReadiness`, `name` and `model`;
 *  - a provider error is recorded and re-thrown as the same object; a
 *    `translateBlocks` error is recorded and re-thrown as the same object;
 *  - nothing here swallows a failure. The only behavior change is the guard
 *    below, and it exists to keep capture off the network.
 *
 * Guard: a call WITHOUT a provider would make the real `translateBlocks` build
 * the environment-backed provider. Capture never allows that. The call is
 * recorded as `refused-no-provider` and rejected with a clear error.
 *
 * Import rules: `node:crypto` is reached only through `./canonicalize.js`.
 * No vitest import; the caller supplies origins and the sink, so this module
 * runs (and is unit tested) outside the capture config too.
 */
import type {
  ProviderReadiness,
  TranslationProvider,
  TranslationProviderRequest,
  TranslationProviderResult,
} from "../../providers/provider.js";
import type { translateBlocks } from "../../translator.js";
import type { TranslationResult } from "../../types.js";
import { canonicalizeResult, sha256Hex } from "./canonicalize.js";
import {
  CAPTURE_SCHEMA_VERSION,
  type CaptureOutcome,
  type CaptureRecord,
  type CapturedProviderCall,
} from "./capture_record.js";
import type { ExpectedResult } from "./schema.js";

export type TranslateFn = typeof translateBlocks;

export type CaptureSink = { emit(record: CaptureRecord): void };

export type CaptureHooks = {
  sink: CaptureSink;
  /** Where the current call comes from. Unknown parts are null, never invented. */
  currentOrigin(): { file: string | null; testName: string | null };
  /** Troubleshooting identity, kept out of canonical content. */
  processInfo(): { pid: number; workerId: string };
};

const describeError = (error: unknown): { errorName: string; errorMessage: string } =>
  error instanceof Error
    ? { errorName: error.name, errorMessage: error.message }
    : { errorName: typeof error, errorMessage: String(error) };

const projectTranslations = (
  response: unknown,
  issues: string[],
): { id: string; translated: string }[] | null => {
  const translations = (response as { translations?: unknown } | null | undefined)
    ?.translations;
  if (!Array.isArray(translations)) {
    issues.push("A provider response had no translations array.");
    return null;
  }
  const projected: { id: string; translated: string }[] = [];
  for (const item of translations as unknown[]) {
    const candidate = item as { id?: unknown; translated?: unknown } | null;
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      typeof candidate.id !== "string" ||
      typeof candidate.translated !== "string"
    ) {
      issues.push("A provider response contained an entry that is not {id, translated} strings.");
      return null;
    }
    projected.push({ id: candidate.id, translated: candidate.translated });
  }
  return projected;
};

type ProviderLog = {
  calls: CapturedProviderCall[];
  issues: string[];
  readinessChecks: number;
};

/** Wrap, never replace: behavior, identity of arguments and errors are preserved. */
export const wrapProvider = (
  provider: TranslationProvider,
  log: ProviderLog,
): TranslationProvider => ({
  get name() {
    return provider.name;
  },
  get model() {
    return provider.model;
  },
  async translate(
    request: TranslationProviderRequest,
  ): Promise<TranslationProviderResult> {
    const entry: CapturedProviderCall = {
      targetLanguage: String(request.targetLanguage),
      blocks: request.blocks.map((block) => ({ id: block.id, text: block.text })),
      systemPromptSha256: sha256Hex(request.systemPrompt),
      userPromptSha256: sha256Hex(request.userPrompt),
      // Replaced when the call settles. Stays visible if it never does.
      outcome: {
        kind: "threw",
        errorName: "Unsettled",
        errorMessage: "The provider call did not settle.",
      },
    };
    log.calls.push(entry);
    try {
      const response = await provider.translate(request);
      entry.outcome = {
        kind: "returned",
        translations: projectTranslations(response, log.issues),
      };
      return response;
    } catch (error) {
      entry.outcome = { kind: "threw", ...describeError(error) };
      throw error;
    }
  },
  async checkReadiness(): Promise<ProviderReadiness> {
    log.readinessChecks += 1;
    return provider.checkReadiness();
  },
});

const diagnosticsOf = (results: readonly TranslationResult[]) =>
  results.map((result) => ({
    id: result.id,
    errors: result.errors.map(({ code, message }) => ({ code, message })),
    warnings: result.warnings.map(({ code, message }) => ({ code, message })),
  }));

const returnedOutcome = (
  returned: readonly TranslationResult[],
  issues: string[],
): CaptureOutcome => {
  let results: ExpectedResult[] | null;
  try {
    results = returned.map(canonicalizeResult);
  } catch (error) {
    issues.push(`Results could not be projected: ${describeError(error).errorMessage}`);
    results = null;
  }
  return { kind: "returned", results, diagnostics: diagnosticsOf(returned) };
};

export const NO_PROVIDER_GUARD_MESSAGE =
  "corpus capture guard: translateBlocks was called without a provider. " +
  "Capture never builds the environment-backed provider (no network, no credentials), " +
  "so this call is refused and recorded as refused-no-provider.";

export const createCapturingTranslateBlocks = (
  original: TranslateFn,
  hooks: CaptureHooks,
): TranslateFn => {
  const counters = new Map<string, number>();
  let sequence = 0;

  return async (blocks, targetLanguage, options) => {
    const origin = hooks.currentOrigin();
    const counterKey = JSON.stringify([origin.file, origin.testName]);
    const callIndex = counters.get(counterKey) ?? 0;
    counters.set(counterKey, callIndex + 1);
    const debug = { ...hooks.processInfo(), sequence: sequence++ };

    const issues: string[] = [];
    const notes: string[] = [];
    const log: ProviderLog = { calls: [], issues, readinessChecks: 0 };

    let clonedBlocks: unknown[];
    try {
      clonedBlocks = structuredClone([...blocks]) as unknown[];
    } catch (error) {
      issues.push(`Request blocks could not be cloned: ${describeError(error).errorMessage}`);
      clonedBlocks = [];
    }
    for (const key of Object.keys(options ?? {})) {
      if (key !== "provider" && key !== "contentKind") {
        notes.push(`Unrecognized translateBlocks option: ${key}`);
      }
    }

    const provider = options?.provider;
    const build = (outcome: CaptureOutcome): CaptureRecord => ({
      schema: CAPTURE_SCHEMA_VERSION,
      origin: { ...origin, callIndex },
      debug,
      request: {
        targetLanguage: String(targetLanguage),
        ...(options?.contentKind === undefined ? {} : { contentKind: options.contentKind }),
        blocks: clonedBlocks,
      },
      requestNotes: notes,
      provider:
        provider === undefined
          ? null
          : { name: String(provider.name), model: String(provider.model) },
      providerCalls: log.calls,
      readinessChecks: log.readinessChecks,
      outcome,
      captureIssues: issues,
    });

    const emit = (record: CaptureRecord, failLoudly: boolean): void => {
      try {
        hooks.sink.emit(record);
      } catch (error) {
        const message = `corpus capture: could not write a record: ${describeError(error).errorMessage}`;
        if (failLoudly) {
          throw new Error(message, { cause: error });
        }
        // The test's own error is more important than ours; report and keep it.
        console.error(message);
      }
    };

    if (provider === undefined) {
      emit(build({ kind: "refused-no-provider" }), false);
      throw new Error(NO_PROVIDER_GUARD_MESSAGE);
    }

    let results: TranslationResult[];
    try {
      results = await original(blocks, targetLanguage, {
        ...options,
        provider: wrapProvider(provider, log),
      });
    } catch (error) {
      emit(build({ kind: "threw", ...describeError(error) }), false);
      throw error;
    }

    emit(build(returnedOutcome(results, issues)), true);
    return results;
  };
};
