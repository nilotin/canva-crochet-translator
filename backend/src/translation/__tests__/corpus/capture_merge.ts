/**
 * Merge, dedup and classify raw capture records (test support only,
 * Stage 0 Step 6).
 *
 * Input: the JSONL text of every raw capture file. Output: a list of files to
 * write under `.corpus-capture/merged/` and a summary. Nothing here touches the
 * disk or the committed corpus, so it is pure, deterministic and unit tested;
 * `scripts/corpus_capture_merge.ts` is the thin command line around it.
 *
 * Identity model. Two different things are counted, on purpose:
 *  - the canonical REQUEST (`requestSha256`) identifies the source request only;
 *  - a SCENARIO is the request plus the replay provider config (`none`, or the
 *    `oracle` inferred from what the test double really returned). The
 *    provider double is part of the effective input, so one request used by two
 *    tests with different provider behavior is two legitimate scenarios, not a
 *    conflict. Test file, test name, origin, worker and time are provenance and
 *    never part of a scenario.
 *
 * Pipeline:
 *  1. Parse every line with the record schema. A malformed line stops the merge
 *     with file:line errors. Nothing is skipped.
 *  2. Order records by canonical content (never by file name or pid), so the
 *     result does not depend on how Vitest scheduled its workers.
 *  3. Group by canonical request. Records of one group that agree on the whole
 *     outcome (results, provider calls incl. responses, issues) collapse into
 *     one "variant"; their origins are combined.
 *  4. Each variant gets a replay provider config, or none: a variant whose
 *     provider cannot be represented safely as none/oracle, or that threw,
 *     was refused, or has capture issues, is NEEDS-REVIEW on its own.
 *  5. Variants of one request that share a scenario (same request, same replay
 *     provider config) must agree. If they do not (different results or
 *     incompatible traces) that is a REAL CONFLICT: reported, never resolved,
 *     no candidate. Variants with different replay provider configs are simply
 *     separate scenarios.
 *  6. A scenario with one variant becomes a harvested/characterized candidate
 *     if it passes the schema, the loader and (when supplied) replay; a
 *     scenario already committed in the harvested lane is skipped.
 *
 * Replayable means all of: the request fits the corpus request schema; the
 * call returned results and the capture recorded no issue; the provider
 * behavior fits `none` (no provider calls) or `oracle` (every call returned an
 * answer for exactly the blocks it was sent, and each source text was always
 * answered the same way); the case passes the schema and the loader; and,
 * when a verifier is supplied, replaying it through the real pipeline
 * reproduces the capture. An oracle is built only from what the test double
 * actually returned, never invented. `echo` is never inferred (an identity
 * answer proves nothing about other texts); it is reported as
 * `echoCompatible` instead.
 *
 * Formatting. Captured cases carry no `regionStyles` (the backend never sees
 * source styles) and are never given invented ones. Region ids are block-local
 * (the frontend derives `fmt-N` per block), so styled slices carry blockId.
 * Geometry is always checked.
 * The one style-dependent frontend verdict (a valid result with no target
 * regions for a source of several regions) is decided only when it is the same
 * under both possible style answers; otherwise the scenario is needs-review as
 * `formatting-verdict-style-dependent`. A geometry violation of a valid result is
 * `formatting-contract-finding`. Neither is ever a replayable candidate.
 *
 * Import rules: canonicalize, schema, capture_record, formatting_contract,
 * formatting_replay, load_corpus (for the loader check). No translator,
 * provider or vitest code.
 */
import {
  canonicalJson,
  canonicalJsonPretty,
  canonicalScenarioJson,
  canonicalizeCase,
  canonicalizeRequest,
  compareStrings,
  deriveHarvestedCaseId,
  sha256Hex,
  slugFromText,
} from "./canonicalize.js";
import { parseCaptureRecord, type CaptureRecord } from "./capture_record.js";
import {
  blockScopedStyledSlices,
  formattingReport,
  type BlockScopedStyledSlice,
} from "./formatting_replay.js";
import { CorpusLoadError, loadCorpusFiles } from "./load_corpus.js";
import type {
  CorpusCase,
  CorpusRequest,
  ProviderCallTrace,
  ProviderConfig,
} from "./schema.js";

export type RawCaptureFile = { name: string; text: string };

export class CaptureInputError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Capture input has ${issues.length} problem(s):\n${issues.map((line) => `  ${line}`).join("\n")}`);
    this.name = "CaptureInputError";
    this.issues = issues;
  }
}

export type ReviewCategory =
  | "request-not-representable"
  | "capture-issue"
  | "refused-no-provider"
  | "threw"
  | "provider-not-representable"
  | "schema-rejected"
  | "formatting-verdict-style-dependent"
  | "formatting-contract-finding"
  | "replay-mismatch";

export type ConflictKind = "results" | "provider-trace" | "provider-responses";

export type MergeOptions = {
  /**
   * `canonicalScenarioJson(request, provider)` of each committed harvested-lane
   * case. A scenario listed here is skipped, never overwritten.
   */
  committedHarvestedScenarios?: ReadonlySet<string>;
  /** Replays a candidate through the real pipeline; null means it reproduces the capture. */
  verify?: (candidate: CorpusCase) => Promise<string | null>;
};

export type MergeSummary = {
  rawFiles: number;
  rawRecords: number;
  rawRecordsByTestFile: Record<string, number>;
  refusedNoProviderRecords: number;
  /** Distinct canonical source requests. Identifies the request only. */
  uniqueCanonicalRequests: number;
  /**
   * Distinct behavioral units: one per (request, replay provider config), plus
   * one per variant whose provider cannot be represented (it has no replay
   * config, so it stands alone as a needs-review scenario).
   * candidates + needsReview + realConflicts + alreadyCommitted = this number.
   */
  uniqueHarvestScenarios: number;
  /** Canonical requests that produced more than one scenario. */
  requestsWithMultipleScenarios: number;
  /** Records folded into an identical earlier capture of the same scenario. */
  duplicateOriginsMerged: number;
  candidates: number;
  candidatesWithMultipleOrigins: number;
  zeroProviderCandidates: number;
  oracleCandidates: number;
  echoCompatibleCandidates: number;
  needsReview: number;
  needsReviewByCategory: Record<string, number>;
  /** Same request AND same replay provider config, but different results or traces. */
  realConflicts: number;
  conflictsByKind: Record<string, number>;
  alreadyCommitted: number;
};

export type MergeFile = { path: string; content: string };

export type MergeOutput = { summary: MergeSummary; files: MergeFile[] };

// ---------------------------------------------------------------------------
// Parsing and ordering
// ---------------------------------------------------------------------------

const parseFiles = (files: readonly RawCaptureFile[]): CaptureRecord[] => {
  const problems: string[] = [];
  const records: CaptureRecord[] = [];
  for (const file of [...files].sort((left, right) => compareStrings(left.name, right.name))) {
    const lines = file.text.split("\n");
    if (lines.at(-1) === "") {
      lines.pop();
    }
    for (const [index, line] of lines.entries()) {
      const where = `${file.name}:${index + 1}`;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch (error) {
        problems.push(`${where}: invalid JSON: ${(error as Error).message}`);
        continue;
      }
      const parsed = parseRecordSafely(json);
      if (typeof parsed === "string") {
        problems.push(`${where}: ${parsed}`);
      } else {
        records.push(parsed);
      }
    }
  }
  if (problems.length > 0) {
    throw new CaptureInputError(problems);
  }
  return records;
};

const parseRecordSafely = (json: unknown): CaptureRecord | string => {
  try {
    return parseCaptureRecord(json);
  } catch (error) {
    return `not a capture record: ${(error as Error).message.split("\n")[0] ?? "invalid"}`;
  }
};

/** Everything except `debug`, so pid/worker/sequence never influence order or identity. */
const contentKey = (record: CaptureRecord): string =>
  canonicalJson({ ...record, debug: undefined });

const safeJson = (value: unknown): string => {
  try {
    return canonicalJson(value);
  } catch {
    return JSON.stringify(value) ?? "undefined";
  }
};

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

type Variant = {
  fingerprint: string;
  record: CaptureRecord;
  origins: Map<string, CaptureRecord["origin"]>;
  count: number;
};

type Group = {
  key: string;
  canonicalRequest: CorpusRequest | null;
  requestReason: string | null;
  variants: Map<string, Variant>;
};

const fingerprintOf = (record: CaptureRecord): string =>
  canonicalJson({
    outcome: record.outcome,
    providerCalls: record.providerCalls,
    captureIssues: record.captureIssues,
    requestNotes: record.requestNotes,
  });

const groupRecords = (records: readonly CaptureRecord[]): Group[] => {
  const groups = new Map<string, Group>();
  for (const record of records) {
    let canonicalRequest: CorpusRequest | null = null;
    let requestReason: string | null = null;
    let key: string;
    try {
      canonicalRequest = canonicalizeRequest(record.request);
      key = sha256Hex(canonicalJson(canonicalRequest));
    } catch (error) {
      requestReason = (error as Error).message.split("\n")[0] ?? "invalid request";
      key = `raw-${sha256Hex(safeJson(record.request))}`;
    }

    let group = groups.get(key);
    if (group === undefined) {
      group = { key, canonicalRequest, requestReason, variants: new Map() };
      groups.set(key, group);
    }

    const fingerprint = fingerprintOf(record);
    const variant = group.variants.get(fingerprint);
    if (variant === undefined) {
      group.variants.set(fingerprint, {
        fingerprint,
        record,
        origins: new Map([[canonicalJson(record.origin), record.origin]]),
        count: 1,
      });
    } else {
      variant.count += 1;
      variant.origins.set(canonicalJson(record.origin), record.origin);
    }
  }
  return [...groups.values()].sort((left, right) => compareStrings(left.key, right.key));
};

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

const traceOf = (record: CaptureRecord) =>
  record.providerCalls.map((call) => ({
    targetLanguage: call.targetLanguage,
    blocks: call.blocks,
    systemPromptSha256: call.systemPromptSha256,
    userPromptSha256: call.userPromptSha256,
  }));

const responsesOf = (record: CaptureRecord) =>
  record.providerCalls.map(({ outcome }) => outcome);

const conflictKinds = (variants: readonly Variant[]): ConflictKind[] => {
  const distinct = (pick: (record: CaptureRecord) => unknown): number =>
    new Set(variants.map((variant) => canonicalJson(pick(variant.record)))).size;
  const kinds: ConflictKind[] = [];
  if (distinct((record) => [record.outcome, record.captureIssues, record.requestNotes]) > 1) {
    kinds.push("results");
  }
  if (distinct(traceOf) > 1) {
    kinds.push("provider-trace");
  }
  if (distinct(responsesOf) > 1) {
    kinds.push("provider-responses");
  }
  return kinds;
};

const describeOrigin = (origin: CaptureRecord["origin"]) => ({
  file: origin.file,
  testName: origin.testName,
  callIndex: origin.callIndex,
});

const sortedOrigins = (origins: Iterable<CaptureRecord["origin"]>) =>
  [...origins].map(describeOrigin).sort((left, right) => compareStrings(canonicalJson(left), canonicalJson(right)));

// ---------------------------------------------------------------------------
// Candidate construction
// ---------------------------------------------------------------------------

type ProviderInference =
  | { ok: true; provider: ProviderConfig; echoCompatible: boolean }
  | { ok: false; reason: string };

/** Only `none` and `oracle`, and an oracle only from what the double really returned. */
export const inferProviderConfig = (record: CaptureRecord): ProviderInference => {
  if (record.providerCalls.length === 0) {
    return { ok: true, provider: { mode: "none" }, echoCompatible: false };
  }

  const pairs = new Map<string, string>();
  for (const [callIndex, call] of record.providerCalls.entries()) {
    if (call.outcome.kind === "threw") {
      return { ok: false, reason: `Provider call #${callIndex} threw (${call.outcome.errorName}); an oracle cannot express a thrown error.` };
    }
    const { translations } = call.outcome;
    if (translations === null) {
      return { ok: false, reason: `Provider call #${callIndex} returned something other than {id, translated}[].` };
    }
    const sentIds = call.blocks.map((block) => block.id);
    const answeredIds = translations.map((entry) => entry.id);
    if (canonicalJson(sentIds) !== canonicalJson(answeredIds)) {
      return {
        ok: false,
        reason: `Provider call #${callIndex} did not answer exactly the blocks it was sent, in order. An oracle always answers every block in order.`,
      };
    }
    for (const [blockIndex, block] of call.blocks.entries()) {
      const translated = translations[blockIndex]?.translated;
      if (translated === undefined) {
        return { ok: false, reason: `Provider call #${callIndex} has no answer for block ${blockIndex}.` };
      }
      const earlier = pairs.get(block.text);
      if (earlier !== undefined && earlier !== translated) {
        return {
          ok: false,
          reason: `The same source text was answered differently within one capture (call #${callIndex}); the provider double is stateful, so no oracle can reproduce it.`,
        };
      }
      pairs.set(block.text, translated);
    }
  }

  if (pairs.size === 0) {
    return { ok: false, reason: "Provider was called but never with any block text." };
  }

  const entries = [...pairs.entries()].map(([source, translated]) => ({ source, translated }));
  return {
    ok: true,
    provider: { mode: "oracle", entries },
    echoCompatible: entries.every((entry) => entry.source === entry.translated),
  };
};

const originsToCorpus = (origins: Iterable<CaptureRecord["origin"]>): CorpusCase["origins"] =>
  [...origins].map((origin) =>
    origin.file !== null && origin.testName !== null
      ? {
          kind: "test" as const,
          file: origin.file,
          test: origin.testName,
          callIndex: origin.callIndex,
        }
      : {
          kind: "manual" as const,
          note: `Harvested from ${origin.file ?? "an unknown test file"} (test name not available), translateBlocks call index ${origin.callIndex}.`,
        },
  );

const traceCalls = (record: CaptureRecord): ProviderCallTrace[] =>
  record.providerCalls.map((call) => ({
    targetLanguage: call.targetLanguage as ProviderCallTrace["targetLanguage"],
    blockIds: call.blocks.map((block) => block.id),
    blockTexts: call.blocks.map((block) => block.text),
    systemPromptSha256: call.systemPromptSha256,
    userPromptSha256: call.userPromptSha256,
  }));

type Review = {
  kind: "review";
  variant: Variant;
  categories: ReviewCategory[];
  reasons: string[];
};

const review = (variant: Variant, category: ReviewCategory, ...reasons: string[]): Review => ({
  kind: "review",
  variant,
  categories: [category],
  reasons,
});

/** A variant with a replay provider config: it has a scenario. */
type Scenario = {
  kind: "scenario";
  variant: Variant;
  provider: ProviderConfig;
  echoCompatible: boolean;
  scenarioJson: string;
};

/** Everything that can stop a variant from having a replay config or scenario. */
const prepare = (group: Group, variant: Variant): Review | Scenario => {
  const { record } = variant;

  if (group.canonicalRequest === null || record.requestNotes.length > 0) {
    return review(
      variant,
      "request-not-representable",
      ...(group.requestReason === null ? [] : [`Request does not fit the corpus request schema: ${group.requestReason}`]),
      ...record.requestNotes,
    );
  }
  if (record.captureIssues.length > 0) {
    return review(variant, "capture-issue", ...record.captureIssues);
  }
  if (record.outcome.kind === "refused-no-provider") {
    return review(
      variant,
      "refused-no-provider",
      "translateBlocks was called without a provider; capture refuses to build the environment-backed one.",
    );
  }
  if (record.outcome.kind === "threw") {
    return review(
      variant,
      "threw",
      `translateBlocks threw ${record.outcome.errorName}: ${record.outcome.errorMessage}. A corpus case stores results, not exceptions.`,
    );
  }
  if (record.outcome.results === null) {
    return review(variant, "capture-issue", "Results could not be projected onto the corpus result shape.");
  }

  const inferred = inferProviderConfig(record);
  if (!inferred.ok) {
    return review(variant, "provider-not-representable", inferred.reason);
  }

  let scenarioJson: string;
  try {
    scenarioJson = canonicalScenarioJson(group.canonicalRequest, inferred.provider);
  } catch (error) {
    return review(
      variant,
      "schema-rejected",
      `Scenario could not be canonicalized: ${(error as Error).message.split("\n")[0] ?? "invalid"}`,
    );
  }
  return {
    kind: "scenario",
    variant,
    provider: inferred.provider,
    echoCompatible: inferred.echoCompatible,
    scenarioJson,
  };
};

type Finalized =
  | { kind: "candidate"; caseValue: CorpusCase; echoCompatible: boolean }
  | { kind: "already-committed"; id: string }
  | Review;

/** Builds, loads and (optionally) replays the candidate of a conflict-free scenario. */
const finalize = async (group: Group, scenario: Scenario, options: MergeOptions): Promise<Finalized> => {
  const { variant, provider } = scenario;
  const { record } = variant;
  const { canonicalRequest } = group;
  if (canonicalRequest === null || record.outcome.kind !== "returned" || record.outcome.results === null) {
    return review(variant, "capture-issue", "Internal: a scenario was built from an unusable record.");
  }
  const { results, diagnostics } = record.outcome;

  if (options.committedHarvestedScenarios?.has(scenario.scenarioJson) === true) {
    return { kind: "already-committed", id: deriveHarvestedCaseId(canonicalRequest, provider) };
  }

  let styled: BlockScopedStyledSlice[] | undefined;
  try {
    const hasRegions = results.some((result) => result.targetFormattingRegions !== undefined);
    // Region ids are block-local, so slices are sorted by (blockId, regionId).
    styled = hasRegions
      ? blockScopedStyledSlices(results).sort(
          (left, right) =>
            compareStrings(left.blockId, right.blockId) || compareStrings(left.regionId, right.regionId),
        )
      : undefined;
  } catch (error) {
    return review(variant, "schema-rejected", `Styled slices could not be computed: ${(error as Error).message}`);
  }

  let caseValue: CorpusCase;
  try {
    const firstText = canonicalRequest.blocks[0]?.text ?? "";
    const slug = slugFromText(firstText);
    caseValue = canonicalizeCase({
      schema: 1,
      id: deriveHarvestedCaseId(canonicalRequest, provider, slug === "" ? undefined : slug),
      lane: "harvested",
      status: "characterized",
      origins: originsToCorpus(variant.origins.values()),
      request: canonicalRequest,
      provider,
      expected: { results, ...(styled === undefined ? {} : { styledSlices: styled }) },
      trace: { providerCalls: traceCalls(record), diagnostics },
      labels: { families: [], hazards: [], zeroProvider: record.providerCalls.length === 0 },
    });
  } catch (error) {
    return review(
      variant,
      "schema-rejected",
      `Candidate rejected by the corpus schema: ${(error as Error).message.split("\n")[0] ?? "invalid"}`,
    );
  }

  try {
    loadCorpusFiles([{ name: `${caseValue.id}.json`, bytes: canonicalJsonPretty(caseValue) }]);
  } catch (error) {
    if (error instanceof CorpusLoadError) {
      return review(variant, "schema-rejected", ...error.issues.map((issue) => issue.message));
    }
    throw error;
  }

  // Formatting. The backend never sees source styles, so a captured case has no
  // regionStyles and the frontend's style-dependent verdict cannot be evaluated
  // in general. Geometry always can. A verdict that is identical under both
  // possible style answers (mapped target regions, single-region sources,
  // invalid results) is decided and the case stays replayable. A verdict that
  // differs is NOT EVALUATED: needs review, never a pass, never a failure.
  const formatting = formattingReport(caseValue, results);
  if (formatting.findings.length > 0) {
    return review(variant, "formatting-contract-finding", ...formatting.findings);
  }
  if (formatting.notEvaluated.length > 0) {
    return review(
      variant,
      "formatting-verdict-style-dependent",
      ...formatting.notEvaluated.map((entry) => entry.reason),
    );
  }

  if (options.verify !== undefined) {
    const mismatch = await options.verify(caseValue);
    if (mismatch !== null) {
      return review(variant, "replay-mismatch", mismatch);
    }
  }

  return { kind: "candidate", caseValue, echoCompatible: scenario.echoCompatible };
};

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

const bump = (counts: Record<string, number>, key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
};

const sortedCounts = (counts: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(counts).sort(([left], [right]) => compareStrings(left, right)));

export const mergeCapture = async (
  files: readonly RawCaptureFile[],
  options: MergeOptions = {},
): Promise<MergeOutput> => {
  const parsed = parseFiles(files);
  const records = parsed
    .map((record) => ({ record, key: contentKey(record) }))
    .sort((left, right) => compareStrings(left.key, right.key))
    .map(({ record }) => record);

  const groups = groupRecords(records);
  const output: MergeFile[] = [];

  const byTestFile: Record<string, number> = {};
  for (const record of records) {
    bump(byTestFile, record.origin.file ?? "(unknown test file)");
  }

  const summary: MergeSummary = {
    rawFiles: files.length,
    rawRecords: records.length,
    rawRecordsByTestFile: sortedCounts(byTestFile),
    refusedNoProviderRecords: records.filter((record) => record.outcome.kind === "refused-no-provider").length,
    uniqueCanonicalRequests: groups.length,
    uniqueHarvestScenarios: 0,
    requestsWithMultipleScenarios: 0,
    duplicateOriginsMerged: 0,
    candidates: 0,
    candidatesWithMultipleOrigins: 0,
    zeroProviderCandidates: 0,
    oracleCandidates: 0,
    echoCompatibleCandidates: 0,
    needsReview: 0,
    needsReviewByCategory: {},
    realConflicts: 0,
    conflictsByKind: {},
    alreadyCommitted: 0,
  };

  const committed: string[] = [];
  const needsReviewCounts: Record<string, number> = {};
  const conflictCounts: Record<string, number> = {};

  const emitReview = (groupKey: string, item: Review): void => {
    const shortKey = groupKey.replace(/^raw-/, "").slice(0, 12);
    summary.needsReview += 1;
    for (const category of item.categories) {
      bump(needsReviewCounts, category);
    }
    const { variant } = item;
    output.push({
      path: `needs-review/${shortKey}-${sha256Hex(variant.fingerprint).slice(0, 8)}.json`,
      content: canonicalJsonPretty({
        categories: item.categories,
        outcomeKind: variant.record.outcome.kind,
        origins: sortedOrigins(variant.origins.values()),
        providerCallCount: variant.record.providerCalls.length,
        reasons: item.reasons,
        records: variant.count,
        request: variant.record.request,
        requestSha256: groupKey,
      }),
    });
  };

  for (const group of groups) {
    const variants = [...group.variants.values()].sort((left, right) =>
      compareStrings(left.fingerprint, right.fingerprint),
    );
    summary.duplicateOriginsMerged += variants.reduce((sum, variant) => sum + variant.count - 1, 0);
    const shortKey = group.key.replace(/^raw-/, "").slice(0, 12);

    const scenarios = new Map<string, Scenario[]>();
    let units = 0;
    for (const variant of variants) {
      const prepared = prepare(group, variant);
      if (prepared.kind === "review") {
        units += 1;
        summary.uniqueHarvestScenarios += 1;
        emitReview(group.key, prepared);
      } else {
        const list = scenarios.get(prepared.scenarioJson) ?? [];
        list.push(prepared);
        scenarios.set(prepared.scenarioJson, list);
      }
    }

    const ordered = [...scenarios.entries()]
      .map(([scenarioJson, list]) => ({ scenarioJson, scenarioSha: sha256Hex(scenarioJson), list }))
      .sort((left, right) => compareStrings(left.scenarioSha, right.scenarioSha));

    for (const { scenarioSha, list } of ordered) {
      units += 1;
      summary.uniqueHarvestScenarios += 1;
      const [scenario] = list;
      if (scenario === undefined) {
        continue;
      }

      if (list.length > 1) {
        const conflicting = list.map((entry) => entry.variant);
        const kinds = conflictKinds(conflicting);
        summary.realConflicts += 1;
        for (const kind of kinds) {
          bump(conflictCounts, kind);
        }
        output.push({
          path: `conflicts/${shortKey}-s${scenarioSha.slice(0, 8)}.json`,
          content: canonicalJsonPretty({
            kinds,
            replayProvider: scenario.provider,
            request: scenario.variant.record.request,
            requestSha256: group.key,
            scenarioSha256: scenarioSha,
            variants: conflicting.map((variant) => ({
              fingerprintSha256: sha256Hex(variant.fingerprint),
              origins: sortedOrigins(variant.origins.values()),
              outcome: variant.record.outcome,
              providerCalls: variant.record.providerCalls,
              records: variant.count,
            })),
          }),
        });
        continue;
      }

      const finalized = await finalize(group, scenario, options);
      if (finalized.kind === "already-committed") {
        summary.alreadyCommitted += 1;
        committed.push(finalized.id);
      } else if (finalized.kind === "review") {
        emitReview(group.key, finalized);
      } else {
        summary.candidates += 1;
        if (scenario.variant.origins.size > 1) {
          summary.candidatesWithMultipleOrigins += 1;
        }
        if (scenario.provider.mode === "none") {
          summary.zeroProviderCandidates += 1;
        } else {
          summary.oracleCandidates += 1;
        }
        if (finalized.echoCompatible) {
          summary.echoCompatibleCandidates += 1;
        }
        output.push({
          path: `candidates/${finalized.caseValue.id}.json`,
          content: canonicalJsonPretty(finalized.caseValue),
        });
      }
    }

    if (units > 1) {
      summary.requestsWithMultipleScenarios += 1;
    }
  }

  summary.needsReviewByCategory = sortedCounts(needsReviewCounts);
  summary.conflictsByKind = sortedCounts(conflictCounts);

  output.push({ path: "summary.json", content: canonicalJsonPretty(summary) });
  if (committed.length > 0) {
    output.push({ path: "already-committed.json", content: canonicalJsonPretty(committed.sort(compareStrings)) });
  }
  output.sort((left, right) => compareStrings(left.path, right.path));
  return { summary, files: output };
};

/** Fixed-format text for the terminal. */
export const formatSummary = (summary: MergeSummary): string => {
  const lines = [
    `raw capture files:                 ${summary.rawFiles}`,
    `raw runtime translateBlocks calls: ${summary.rawRecords}`,
    ...Object.entries(summary.rawRecordsByTestFile).map(([file, count]) => `    ${count}\t${file}`),
    `unique canonical requests:         ${summary.uniqueCanonicalRequests}`,
    `unique harvest scenarios:          ${summary.uniqueHarvestScenarios}`,
    `requests with several scenarios:   ${summary.requestsWithMultipleScenarios}`,
    `replayable candidates:             ${summary.candidates}`,
    `    zero-provider (mode none):     ${summary.zeroProviderCandidates}`,
    `    oracle (mode oracle):          ${summary.oracleCandidates}`,
    `    echo-compatible (info only):   ${summary.echoCompatibleCandidates}`,
    `needs-review (non-replayable):     ${summary.needsReview}`,
    ...Object.entries(summary.needsReviewByCategory).map(([category, count]) => `    ${count}\t${category}`),
    `real conflicts:                    ${summary.realConflicts}`,
    ...Object.entries(summary.conflictsByKind).map(([kind, count]) => `    ${count}\t${kind}`),
    `already committed (skipped):       ${summary.alreadyCommitted}`,
    `duplicate origins merged:          ${summary.duplicateOriginsMerged}`,
    `candidates with several origins:   ${summary.candidatesWithMultipleOrigins}`,
    `refused (no provider) records:     ${summary.refusedNoProviderRecords}`,
  ];
  const partition =
    summary.candidates + summary.needsReview + summary.realConflicts + summary.alreadyCommitted;
  lines.push(
    partition === summary.uniqueHarvestScenarios
      ? "check: candidates + needs-review + real conflicts + already-committed = unique harvest scenarios (OK)"
      : `check FAILED: ${partition} classified vs ${summary.uniqueHarvestScenarios} unique harvest scenarios`,
  );
  return `${lines.join("\n")}\n`;
};
