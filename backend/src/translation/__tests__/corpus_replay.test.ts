/**
 * Stage 0, Step 5: general replay suite for the golden corpus.
 *
 * Every executable case in `corpus/cases` is replayed through the REAL
 * `translateBlocks` with the case's own `SpyProvider`. Nothing else is
 * exercised: this suite pins the public seam only, never a normalizer,
 * validator or any other internal.
 *
 * Six separate promises per case, each its own test so a failure names exactly
 * which promise broke (filter with `-t "\[contract\]"` and so on):
 *
 *  [contract]           translated text, validity, diagnostic codes and the
 *                       formatting fields equal the stored `expected.results`.
 *  [formatting]         the frontend fail-closed formatting contract (mirror in
 *                       corpus/formatting_contract.ts) holds for every valid
 *                       result, and the styled slices equal the stored ones.
 *                       Geometry is always checked. The one style-dependent
 *                       verdict (a valid result with no target regions for a
 *                       source of several regions) needs `regionStyles`; when a
 *                       case has none it is NOT EVALUATED, listed as a skipped
 *                       `[formatting-verdict]` test, and never assumed to pass.
 *  [provider-ratchet]   provider exposure never grows: no zero-provider case
 *                       reaches a provider, and calls, blocks, characters and
 *                       distinct provider texts stay at or below the record.
 *  [trace]              provider calls (exact texts, ids, prompt hashes) and
 *                       diagnostic messages equal the stored `trace`.
 *  [determinism]        two sequential and two concurrent replays are identical.
 *  [order-independence] neither running another case first, nor reversing the
 *                       block order of a multi-block request, changes any
 *                       block's result.
 *
 * Known-bad repros stay green by asserting TODAY's behavior. `known.desired`
 * and `known.observedLive` are evidence only and are never compared. A stage
 * that fixes a repro fails its [contract] test on purpose; the case is then
 * promoted by a reviewed change, not by editing this suite.
 *
 * Pending-approval cases are listed as skipped tests and never executed.
 *
 * Hermetic by construction: the provider factory and `fetch` are guarded below,
 * so a case that forgets to supply its provider fails loudly instead of
 * reaching the environment or the network.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { translateBlocks } from "../translator.js";
import type { TranslationResult } from "../types.js";
import {
  canonicalJson,
  canonicalizeResult,
  compareStrings,
} from "./corpus/canonicalize.js";
import {
  blockScopedStyledSlices,
  formattingReport,
  type BlockScopedStyledSlice,
} from "./corpus/formatting_replay.js";
import {
  loadCorpus,
  type ExecutableCase,
  type LoadedCorpus,
  requireExecutable,
} from "./corpus/load_corpus.js";
import type {
  CorpusCase,
  CorpusTrace,
  ExpectedResult,
  ProviderCallTrace,
} from "./corpus/schema.js";
import { SpyProvider } from "./corpus/spy_provider.js";

// Network / environment guard. Hoisted by Vitest above the imports, so the
// translator sees this factory instead of the environment-backed one.
vi.mock("../providers/index.js", () => ({
  createTranslationProvider: () => {
    throw new Error(
      "corpus replay guard: createTranslationProvider was called. Every corpus case must pass its own SpyProvider.",
    );
  },
}));

const GUARD_PATTERN = /corpus replay guard/;

beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("corpus replay guard: network access attempted through fetch.");
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Loading. A load failure must fail the suite loudly, never shrink it.
// ---------------------------------------------------------------------------

let corpus: LoadedCorpus = { cases: [], executable: [], pending: [] };
let loadFailure: unknown;
try {
  corpus = loadCorpus();
} catch (error) {
  loadFailure = error;
}

// ---------------------------------------------------------------------------
// Replay helpers. Each replay gets its own SpyProvider and its own copy of the
// request, so no state can be shared between runs or cases.
// ---------------------------------------------------------------------------

type Replay = {
  spy: SpyProvider;
  results: TranslationResult[];
  actual: ExpectedResult[];
};

const replay = async (
  caseValue: CorpusCase,
  blocks: CorpusCase["request"]["blocks"] = caseValue.request.blocks,
): Promise<Replay> => {
  const spy = new SpyProvider(caseValue.provider);
  const input = structuredClone(blocks);
  const results = await translateBlocks(input, caseValue.request.targetLanguage, {
    provider: spy,
    ...(caseValue.request.contentKind === undefined
      ? {}
      : { contentKind: caseValue.request.contentKind }),
  });
  if (canonicalJson(input) !== canonicalJson(blocks)) {
    throw new Error("translateBlocks mutated the request blocks it was given.");
  }
  return { spy, results, actual: results.map(canonicalizeResult) };
};

const diagnosticTrace = (results: readonly TranslationResult[]): CorpusTrace["diagnostics"] =>
  results.map((result) => ({
    id: result.id,
    errors: result.errors.map(({ code, message }) => ({ code, message })),
    warnings: result.warnings.map(({ code, message }) => ({ code, message })),
  }));

const byId = (results: readonly ExpectedResult[]): ExpectedResult[] =>
  [...results].sort((left, right) => compareStrings(left.id, right.id));

// Formatting -----------------------------------------------------------------

/**
 * Slices of every valid result with regions, ordered like the stored form
 * (region ids are block-local, so the sort is by blockId then regionId).
 */
const slicesOf = (results: readonly ExpectedResult[]): BlockScopedStyledSlice[] =>
  [...blockScopedStyledSlices(results)].sort(
    (left, right) =>
      compareStrings(left.blockId, right.blockId) || compareStrings(left.regionId, right.regionId),
  );

// Provider ratchet -----------------------------------------------------------

const excerpt = (text: string): string =>
  JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}...` : text);

const usage = (calls: readonly ProviderCallTrace[]) => ({
  calls: calls.length,
  blocks: calls.reduce((sum, call) => sum + call.blockTexts.length, 0),
  characters: calls.reduce(
    (sum, call) => sum + call.blockTexts.reduce((inner, text) => inner + text.length, 0),
    0,
  ),
  texts: new Set(calls.flatMap((call) => call.blockTexts)),
});

/** Empty when provider exposure did not grow. Shrinking is allowed here; [trace] pins exact equality. */
const ratchetProblems = (
  recorded: readonly ProviderCallTrace[],
  actual: readonly ProviderCallTrace[],
  zeroProvider: boolean,
): string[] => {
  const before = usage(recorded);
  const now = usage(actual);
  const problems: string[] = [];
  if (zeroProvider && now.calls > 0) {
    problems.push(`zero-provider case reached the provider ${now.calls} time(s)`);
  }
  if (now.calls > before.calls) {
    problems.push(`provider calls grew from ${before.calls} to ${now.calls}`);
  }
  if (now.blocks > before.blocks) {
    problems.push(`provider blocks grew from ${before.blocks} to ${now.blocks}`);
  }
  if (now.characters > before.characters) {
    problems.push(`provider characters grew from ${before.characters} to ${now.characters}`);
  }
  for (const text of now.texts) {
    if (!before.texts.has(text)) {
      problems.push(`new text sent to the provider: ${excerpt(text)}`);
    }
  }
  return problems;
};

const fingerprint = (run: Replay): string =>
  canonicalJson({
    results: run.actual,
    calls: run.spy.calls,
    diagnostics: diagnosticTrace(run.results),
  });

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("corpus replay: inventory and guards", () => {
  it("[corpus] loads without issues and is not empty", () => {
    if (loadFailure !== undefined) {
      throw loadFailure;
    }
    expect(corpus.executable.length).toBeGreaterThan(0);
  });

  it("[corpus] pending-approval cases are listed and never executable", () => {
    for (const entry of corpus.pending) {
      expect(entry.executable).toBe(false);
      expect(corpus.executable.some((other) => other.caseId === entry.caseId)).toBe(false);
      expect(() => requireExecutable(entry)).toThrow(/pending-approval/);
    }
    for (const entry of corpus.executable) {
      expect(entry.value.status).not.toBe("pending-approval");
    }
  });

  it("[guard] a translateBlocks call without a provider is stopped before the environment", async () => {
    await expect(translateBlocks([{ id: "guard-1", text: "ch 3" }], "en")).rejects.toThrow(
      GUARD_PATTERN,
    );
  });

  it("[guard] fetch is stubbed for the whole suite", () => {
    expect(() => globalThis.fetch("http://localhost.invalid/")).toThrow(GUARD_PATTERN);
  });
});

const definePromises = (entry: ExecutableCase, index: number): void => {
  const { lane, caseId, value } = entry;
  const { expected, trace } = value;
  const tag = `[${lane}][${caseId}]`;

  it(`${tag}[contract]`, async () => {
    const { spy, actual } = await replay(value);
    spy.assertClean();
    expect(actual).toEqual(expected.results);
    expect(canonicalJson(actual)).toBe(canonicalJson(expected.results));
  });

  it(`${tag}[formatting]`, async () => {
    const { actual } = await replay(value);
    expect(formattingReport(value, actual).findings).toEqual([]);
    expect(formattingReport(value, expected.results).findings).toEqual([]);
    expect(slicesOf(actual)).toEqual(expected.styledSlices ?? []);
  });

  // Style-dependent frontend verdicts that cannot be decided without source
  // styles are listed, explicitly skipped, instead of silently passing.
  for (const skipped of formattingReport(value, expected.results).notEvaluated) {
    it.skip(`${tag}[formatting-verdict] NOT EVALUATED, source styles unknown: block ${skipped.blockId}`, () => {});
  }

  it(`${tag}[provider-ratchet]`, async () => {
    const { spy } = await replay(value);
    spy.assertClean();
    expect(ratchetProblems(trace.providerCalls, spy.calls, value.labels.zeroProvider)).toEqual([]);
  });

  it(`${tag}[trace]`, async () => {
    const { spy, results } = await replay(value);
    expect(spy.calls).toEqual(trace.providerCalls);
    expect(diagnosticTrace(results)).toEqual(trace.diagnostics);
  });

  it(`${tag}[determinism]`, async () => {
    const first = await replay(value);
    const second = await replay(value);
    const [third, fourth] = await Promise.all([replay(value), replay(value)]);
    const reference = fingerprint(first);
    expect(fingerprint(second)).toBe(reference);
    expect(fingerprint(third)).toBe(reference);
    expect(fingerprint(fourth)).toBe(reference);
  });

  it(`${tag}[order-independence]`, async () => {
    // Another case runs first; this case must not notice.
    const neighbour = corpus.executable[(index + 1) % corpus.executable.length];
    if (neighbour !== undefined && neighbour.caseId !== caseId) {
      await replay(neighbour.value).catch(() => undefined);
    }
    const afterNeighbour = await replay(value);
    afterNeighbour.spy.assertClean();
    expect(afterNeighbour.actual).toEqual(expected.results);
    expect(afterNeighbour.spy.calls).toEqual(trace.providerCalls);

    // Blocks are translated independently: reversing them must not change any
    // block's result (matched by id, not by position).
    if (value.request.blocks.length > 1) {
      const reversed = await replay(value, [...value.request.blocks].reverse());
      reversed.spy.assertClean();
      expect(byId(reversed.actual)).toEqual(byId(expected.results));
    }
  });
};

describe("corpus replay: executable cases", () => {
  corpus.executable.forEach((entry, index) => {
    definePromises(entry, index);
  });
});

// Vitest rejects a suite with no tests, so this block exists only when there is
// something to list. The "[corpus] pending-approval cases ..." inventory test
// above is the unconditional evidence that pending cases stay non-executable.
if (corpus.pending.length > 0) {
  describe("corpus replay: pending approval (not executed)", () => {
    for (const entry of corpus.pending) {
      it.skip(`[${entry.lane}][${entry.caseId}][pending-approval] listed, awaiting approval`, () => {});
    }
  });
}
