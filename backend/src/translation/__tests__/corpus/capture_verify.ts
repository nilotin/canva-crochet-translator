/**
 * Replay a harvested candidate through a translateBlocks implementation and
 * report the first way it fails to reproduce the capture (test support only,
 * Stage 0 Step 6).
 *
 * The merge tool uses this so that "replayable" is proven, not assumed: a
 * candidate whose oracle or provider-free replay does not give back exactly
 * the captured results, provider calls and diagnostics is needs-review.
 *
 * `translate` is injected. The command line passes the real `translateBlocks`;
 * this module never imports translator code itself. Every replay uses a fresh
 * `SpyProvider` (no network, no environment) and a fresh copy of the request.
 */
import { canonicalJson, canonicalizeResult } from "./canonicalize.js";
import type { TranslateFn } from "./capture_runtime.js";
import type { CorpusCase } from "./schema.js";
import { SpyProvider } from "./spy_provider.js";

const excerpt = (value: unknown): string => {
  const text = canonicalJson(value);
  return text.length > 160 ? `${text.slice(0, 160)}...` : text;
};

const replayOnce = async (translate: TranslateFn, caseValue: CorpusCase) => {
  const spy = new SpyProvider(caseValue.provider);
  const results = await translate(
    structuredClone(caseValue.request.blocks),
    caseValue.request.targetLanguage,
    {
      provider: spy,
      ...(caseValue.request.contentKind === undefined
        ? {}
        : { contentKind: caseValue.request.contentKind }),
    },
  );
  return {
    spy,
    results: results.map(canonicalizeResult),
    diagnostics: results.map((result) => ({
      id: result.id,
      errors: result.errors.map(({ code, message }) => ({ code, message })),
      warnings: result.warnings.map(({ code, message }) => ({ code, message })),
    })),
  };
};

/** Null when the candidate reproduces its capture (twice, identically). */
export const verifyCandidate = async (
  translate: TranslateFn,
  caseValue: CorpusCase,
): Promise<string | null> => {
  const { expected, trace } = caseValue;
  if (expected === undefined || trace === undefined) {
    return "Candidate has no stored expected/trace to verify.";
  }

  try {
    const first = await replayOnce(translate, caseValue);
    if (first.spy.violations.length > 0) {
      return `Replay tripped the provider double: ${excerpt(first.spy.violations)}`;
    }
    if (canonicalJson(first.results) !== canonicalJson(expected.results)) {
      const index = first.results.findIndex(
        (result, position) =>
          canonicalJson(result) !== canonicalJson(expected.results[position]),
      );
      return `Replay results differ at result ${index}: expected ${excerpt(expected.results[index])}, got ${excerpt(first.results[index])}`;
    }
    if (canonicalJson(first.spy.calls) !== canonicalJson(trace.providerCalls)) {
      return `Replay provider calls differ: captured ${trace.providerCalls.length} call(s), replay made ${first.spy.calls.length}.`;
    }
    if (canonicalJson(first.diagnostics) !== canonicalJson(trace.diagnostics)) {
      return "Replay diagnostic messages differ from the capture.";
    }
    const second = await replayOnce(translate, caseValue);
    if (
      canonicalJson([second.results, second.spy.calls, second.diagnostics]) !==
      canonicalJson([first.results, first.spy.calls, first.diagnostics])
    ) {
      return "Two replays of the same candidate disagree (non-deterministic).";
    }
    return null;
  } catch (error) {
    return `Replay threw ${(error as Error).name}: ${(error as Error).message.split("\n")[0] ?? ""}`;
  }
};
