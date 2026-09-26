/**
 * Stage 0, Step 6: focused tests for the capture and merge tooling.
 *
 * These run in the NORMAL test run and need no capture config: the wrapper is
 * given the real `translateBlocks`, an in-memory sink and an explicit provider
 * in every call, so nothing touches the environment, the network or the
 * committed corpus. They prove the mechanism (one call, one record; provider
 * traffic recorded; throws recorded and re-thrown; duplicates merge; conflicts
 * are detected; merge output is byte-stable) without harvesting anything.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  ProviderReadiness,
  TranslationProvider,
  TranslationProviderRequest,
  TranslationProviderResult,
} from "../../providers/provider.js";
import { translateBlocks } from "../../translator.js";
import { createFileSink, rawFileName } from "./capture_file_sink.js";
import { canonicalScenarioJson } from "./canonicalize.js";
import { CaptureInputError, inferProviderConfig, mergeCapture, type RawCaptureFile } from "./capture_merge.js";
import { CAPTURE_SCHEMA_VERSION, parseCaptureRecord, type CaptureRecord } from "./capture_record.js";
import {
  NO_PROVIDER_GUARD_MESSAGE,
  createCapturingTranslateBlocks,
  wrapProvider,
  type TranslateFn,
} from "./capture_runtime.js";
import { verifyCandidate } from "./capture_verify.js";
import { loadCorpusFiles } from "./load_corpus.js";
import type { ExpectedResult } from "./schema.js";
import { SpyProvider } from "./spy_provider.js";

// ---------------------------------------------------------------------------
// Test doubles and helpers
// ---------------------------------------------------------------------------

class EchoDouble implements TranslationProvider {
  readonly name = "echo-double";
  readonly model = "double-1";
  readonly #seen: TranslationProviderRequest[] = [];
  lastResponse: TranslationProviderResult | undefined;

  get seen(): readonly TranslationProviderRequest[] {
    return this.#seen;
  }

  async translate(request: TranslationProviderRequest): Promise<TranslationProviderResult> {
    this.#seen.push(request);
    this.lastResponse = {
      translations: request.blocks.map((block) => ({ id: block.id, translated: block.text })),
    };
    return this.lastResponse;
  }

  async checkReadiness(): Promise<ProviderReadiness> {
    return { ok: true, provider: this.name, model: this.model };
  }
}

const shoutingDouble = (): TranslationProvider => ({
  name: "shouting-double",
  model: "double-2",
  async translate(request) {
    return {
      translations: request.blocks.map((block) => ({
        id: block.id,
        translated: block.text.toUpperCase(),
      })),
    };
  },
  async checkReadiness() {
    return { ok: true, provider: "shouting-double", model: "double-2" };
  },
});

const throwingDouble = (error: Error): TranslationProvider => ({
  name: "throwing-double",
  model: "double-3",
  async translate() {
    throw error;
  },
  async checkReadiness() {
    return { ok: true, provider: "throwing-double", model: "double-3" };
  },
});

const SOFT_YARN = [{ id: "b1", text: "Use soft yarn." }];

type Harness = {
  records: CaptureRecord[];
  translate: TranslateFn;
  origin: { file: string | null; testName: string | null };
};

const harness = (original: TranslateFn = translateBlocks, failingSink = false): Harness => {
  const records: CaptureRecord[] = [];
  const origin = { file: "src/x/example.test.ts" as string | null, testName: "suite > case" as string | null };
  const translate = createCapturingTranslateBlocks(original, {
    sink: {
      emit(record) {
        if (failingSink) {
          throw new Error("disk full");
        }
        // Round-trip through JSON and the schema, exactly like a JSONL file.
        records.push(parseCaptureRecord(JSON.parse(JSON.stringify(record))));
      },
    },
    currentOrigin: () => ({ ...origin }),
    processInfo: () => ({ pid: 1, workerId: "0" }),
  });
  return { records, translate, origin };
};

const toFile = (name: string, records: readonly CaptureRecord[]): RawCaptureFile => ({
  name,
  text: records.map((record) => `${JSON.stringify(record)}\n`).join(""),
});

/** One captured call as a record, through the real wrapper and the real pipeline. */
const captureOne = async (
  provider: TranslationProvider,
  testName: string,
  blocks: { id: string; text: string }[] = SOFT_YARN,
): Promise<CaptureRecord> => {
  const h = harness();
  h.origin.testName = testName;
  await h.translate(blocks, "en", { provider });
  const [record] = h.records;
  if (record === undefined) {
    throw new Error("no record captured");
  }
  return record;
};

const handMade = (overrides: Partial<CaptureRecord> = {}): CaptureRecord => ({
  schema: CAPTURE_SCHEMA_VERSION,
  origin: { file: "src/x/example.test.ts", testName: "suite > hand made", callIndex: 0 },
  debug: { pid: 1, workerId: "0", sequence: 0 },
  request: { targetLanguage: "en", blocks: SOFT_YARN },
  requestNotes: [],
  provider: null,
  providerCalls: [],
  readinessChecks: 0,
  outcome: {
    kind: "returned",
    results: [
      {
        id: "b1",
        source: "Use soft yarn.",
        translated: "Use soft yarn.",
        valid: true,
        errorCodes: [],
        warningCodes: [],
      },
    ],
    diagnostics: [{ id: "b1", errors: [], warnings: [] }],
  },
  captureIssues: [],
  ...overrides,
});

const quietly = async <T>(action: () => Promise<T>): Promise<T> => {
  const original = console.error;
  console.error = () => undefined;
  try {
    return await action();
  } finally {
    console.error = original;
  }
};

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

describe("capture wrapper", () => {
  it("one translateBlocks call produces exactly one record and returns the real results", async () => {
    const h = harness();
    const results = await h.translate(SOFT_YARN, "en", { provider: new EchoDouble() });
    const direct = await translateBlocks(SOFT_YARN, "en", { provider: new EchoDouble() });

    expect(results).toEqual(direct);
    expect(h.records).toHaveLength(1);
    const [record] = h.records;
    expect(record?.origin).toEqual({
      file: "src/x/example.test.ts",
      testName: "suite > case",
      callIndex: 0,
    });
    expect(record?.request).toEqual({ targetLanguage: "en", blocks: SOFT_YARN });
    expect(record?.provider).toEqual({ name: "echo-double", model: "double-1" });
    expect(record?.outcome.kind).toBe("returned");
    expect(record?.captureIssues).toEqual([]);
  });

  it("counts calls per test and starts again for another test", async () => {
    const h = harness();
    const provider = new EchoDouble();
    await h.translate(SOFT_YARN, "en", { provider });
    await h.translate(SOFT_YARN, "en", { provider });
    h.origin.testName = "suite > another case";
    await h.translate(SOFT_YARN, "en", { provider });
    expect(h.records.map((record) => record.origin.callIndex)).toEqual([0, 1, 0]);
  });

  it("records provider calls: exact texts, ids, prompt hashes and the exact response", async () => {
    const provider = new EchoDouble();
    const h = harness();
    await h.translate(SOFT_YARN, "en", { provider });

    const [record] = h.records;
    expect(record?.providerCalls).toHaveLength(1);
    const call = record?.providerCalls[0];
    expect(call?.targetLanguage).toBe("en");
    expect(call?.blocks).toEqual([{ id: "b1", text: "Use soft yarn." }]);
    expect(call?.systemPromptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(call?.userPromptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(call?.outcome).toEqual({
      kind: "returned",
      translations: [{ id: "b1", translated: "Use soft yarn." }],
    });
    // What the double actually received is what was recorded.
    expect(provider.seen.map((request) => request.blocks.map((block) => block.text))).toEqual([
      ["Use soft yarn."],
    ]);
  });

  it("wraps a provider without changing it: same request object, same response, name, model, readiness", async () => {
    const double = new EchoDouble();
    const log = { calls: [], issues: [], readinessChecks: 0 };
    const wrapped = wrapProvider(double, log);
    const request: TranslationProviderRequest = {
      targetLanguage: "en",
      blocks: [{ id: "b1", text: "x" }],
      systemPrompt: "s",
      userPrompt: "u",
    };

    const response = await wrapped.translate(request);

    expect(wrapped.name).toBe("echo-double");
    expect(wrapped.model).toBe("double-1");
    expect(double.seen[0]).toBe(request);
    expect(response).toBe(double.lastResponse);
    expect(await wrapped.checkReadiness()).toEqual({ ok: true, provider: "echo-double", model: "double-1" });
    expect(log.readinessChecks).toBe(1);
    expect(log.calls).toHaveLength(1);
  });

  it("records the zero-provider deterministic path", async () => {
    const h = harness();
    const spy = new SpyProvider({ mode: "none" });
    const results = await h.translate([{ id: "row", text: "12x - 6v" }], "en", { provider: spy });

    expect(results[0]?.translated).toBe("12sc - 6inc");
    spy.assertClean();
    const [record] = h.records;
    expect(record?.providerCalls).toEqual([]);
    expect(record?.outcome.kind).toBe("returned");
  });

  it("records a provider throw and re-throws the same error object", async () => {
    const boom = new Error("boom");
    const h = harness();

    const caught = await h
      .translate(SOFT_YARN, "en", { provider: throwingDouble(boom) })
      .then(() => undefined, (error: unknown) => error);

    expect(caught).toBe(boom);
    const [record] = h.records;
    expect(record?.providerCalls[0]?.outcome).toEqual({
      kind: "threw",
      errorName: "Error",
      errorMessage: "boom",
    });
    expect(record?.outcome).toEqual({ kind: "threw", errorName: "Error", errorMessage: "boom" });
  });

  it("refuses a call without a provider, records it, and never reaches the original", async () => {
    let reached = 0;
    const h = harness(async () => {
      reached += 1;
      return [];
    });

    await expect(h.translate(SOFT_YARN, "en")).rejects.toThrow(NO_PROVIDER_GUARD_MESSAGE);
    expect(reached).toBe(0);
    expect(h.records.map((record) => record.outcome.kind)).toEqual(["refused-no-provider"]);
  });

  it("is loud when the sink fails on success, and never hides the test's own error", async () => {
    const loud = harness(translateBlocks, true);
    await expect(loud.translate(SOFT_YARN, "en", { provider: new EchoDouble() })).rejects.toThrow(
      /could not write a record/,
    );

    const boom = new Error("boom");
    const failing = harness(translateBlocks, true);
    const caught = await quietly(() =>
      failing.translate(SOFT_YARN, "en", { provider: throwingDouble(boom) }).then(
        () => undefined,
        (error: unknown) => error,
      ),
    );
    expect(caught).toBe(boom);
  });

  it("notes options it does not understand instead of dropping them", async () => {
    const h = harness();
    const options = { provider: new EchoDouble(), surprise: true } as Parameters<TranslateFn>[2];
    await h.translate(SOFT_YARN, "en", options);
    expect(h.records[0]?.requestNotes).toEqual(["Unrecognized translateBlocks option: surprise"]);
  });
});

// ---------------------------------------------------------------------------
// File sink
// ---------------------------------------------------------------------------

describe("capture file sink", () => {
  it("gives every worker its own file, refuses stale files, and ignores itself in git", async () => {
    const directory = mkdtempSync(join(tmpdir(), "corpus-capture-"));
    try {
      const record = await captureOne(new EchoDouble(), "suite > sink");
      const withDebug = (pid: number, workerId: string): CaptureRecord => ({
        ...record,
        debug: { pid, workerId, sequence: 0 },
      });

      const sinkA = createFileSink({ captureDirectory: directory });
      const sinkB = createFileSink({ captureDirectory: directory });
      sinkA.emit(withDebug(10, "1"));
      sinkA.emit(withDebug(10, "1"));
      sinkB.emit(withDebug(11, "2"));

      const names = readdirSync(join(directory, "raw")).sort();
      expect(names).toEqual([
        rawFileName(10, "1", record.origin.file),
        rawFileName(11, "2", record.origin.file),
      ].sort());
      expect(readFileSync(join(directory, "raw", rawFileName(10, "1", record.origin.file)), "utf8").split("\n")).toHaveLength(3);
      expect(readFileSync(join(directory, ".gitignore"), "utf8")).toBe("*\n");

      const stale = createFileSink({ captureDirectory: directory });
      expect(() => stale.emit(withDebug(10, "1"))).toThrow(/must be cleared/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

describe("capture merge", () => {
  it("merges the same request and the same replay provider config into one scenario with combined origins", async () => {
    const first = await captureOne(new EchoDouble(), "suite > first test");
    const second = await captureOne(new EchoDouble(), "suite > second test");

    const output = await mergeCapture([toFile("raw-a.jsonl", [first]), toFile("raw-b.jsonl", [second])]);

    expect(output.summary).toMatchObject({
      rawRecords: 2,
      uniqueCanonicalRequests: 1,
      uniqueHarvestScenarios: 1,
      requestsWithMultipleScenarios: 0,
      candidates: 1,
      candidatesWithMultipleOrigins: 1,
      duplicateOriginsMerged: 1,
      realConflicts: 0,
      oracleCandidates: 1,
    });

    const candidate = output.files.find((file) => file.path.startsWith("candidates/"));
    const parsed = JSON.parse(candidate?.content ?? "null") as {
      lane: string;
      status: string;
      origins: { kind: string; test?: string }[];
      provider: { mode: string };
    };
    expect(parsed.lane).toBe("harvested");
    expect(parsed.status).toBe("characterized");
    expect(parsed.provider.mode).toBe("oracle");
    expect(parsed.origins.map((origin) => origin.test).sort()).toEqual([
      "suite > first test",
      "suite > second test",
    ]);
    // The candidate is a valid corpus file: the real loader accepts it.
    expect(
      loadCorpusFiles([{ name: candidate?.path.split("/").pop() ?? "", bytes: candidate?.content ?? "" }]).executable,
    ).toHaveLength(1);
  });

  it("counts identical repeated captures as duplicate origins", async () => {
    const record = await captureOne(new EchoDouble(), "suite > repeated");
    const output = await mergeCapture([toFile("raw-a.jsonl", [record, record, record])]);
    expect(output.summary).toMatchObject({
      rawRecords: 3,
      uniqueCanonicalRequests: 1,
      duplicateOriginsMerged: 2,
      candidates: 1,
    });
  });

  it("keeps one request under two different oracles as two scenarios, not a conflict", async () => {
    // Two tests use the same request with different provider behavior: the
    // provider double is part of the effective input.
    const echoed = await captureOne(new EchoDouble(), "suite > echoes");
    const shouted = await captureOne(shoutingDouble(), "suite > shouts");

    const output = await mergeCapture([toFile("raw-a.jsonl", [echoed, shouted])]);

    expect(output.summary).toMatchObject({
      uniqueCanonicalRequests: 1,
      uniqueHarvestScenarios: 2,
      requestsWithMultipleScenarios: 1,
      candidates: 2,
      oracleCandidates: 2,
      realConflicts: 0,
      needsReview: 0,
    });
    expect(output.files.some((file) => file.path.startsWith("conflicts/"))).toBe(false);

    const candidates = output.files.filter((file) => file.path.startsWith("candidates/"));
    const ids = candidates.map((file) => file.path.replace(/^candidates\//, "").replace(/\.json$/, ""));
    expect(new Set(ids).size).toBe(2);
    // Same source request (same request hash), different scenario hash.
    expect(new Set(ids.map((id) => id.slice(0, 12))).size).toBe(1);
    expect(new Set(ids.map((id) => id.slice(13, 22))).size).toBe(2);
    for (const file of candidates) {
      expect(loadCorpusFiles([{ name: file.path.split("/").pop() ?? "", bytes: file.content }]).executable).toHaveLength(1);
    }
    // Both scenarios load together: the loader accepts the same request under two configs.
    expect(
      loadCorpusFiles(candidates.map((file) => ({ name: file.path.split("/").pop() ?? "", bytes: file.content }))).cases,
    ).toHaveLength(2);
  });

  it("keeps mode none and an oracle for the same request as two scenarios", async () => {
    const oracle = await captureOne(new EchoDouble(), "suite > provider used");
    const none = handMade({ origin: { file: "src/x/example.test.ts", testName: "suite > no provider", callIndex: 0 } });

    const output = await mergeCapture([toFile("raw-a.jsonl", [oracle, none])]);

    expect(output.summary).toMatchObject({
      uniqueCanonicalRequests: 1,
      uniqueHarvestScenarios: 2,
      requestsWithMultipleScenarios: 1,
      candidates: 2,
      zeroProviderCandidates: 1,
      oracleCandidates: 1,
      realConflicts: 0,
    });
  });

  it("gives a variant whose provider cannot be represented its own needs-review entry next to the scenario that can", async () => {
    // The same request: one test with a normal provider, one whose provider
    // corrupted a call by returning an empty translation list.
    const normal = await captureOne(new EchoDouble(), "suite > normal");
    const corrupted: CaptureRecord = {
      ...normal,
      origin: { ...normal.origin, testName: "suite > corrupted provider" },
      providerCalls: normal.providerCalls.map((call) => ({
        ...call,
        outcome: { kind: "returned", translations: [] },
      })),
      outcome:
        normal.outcome.kind === "returned" && normal.outcome.results !== null
          ? {
              ...normal.outcome,
              results: normal.outcome.results.map((result) => ({ ...result, translated: "", valid: false })),
            }
          : normal.outcome,
    };

    const output = await mergeCapture([toFile("raw-a.jsonl", [normal, corrupted])]);

    expect(output.summary).toMatchObject({
      uniqueCanonicalRequests: 1,
      uniqueHarvestScenarios: 2,
      requestsWithMultipleScenarios: 1,
      candidates: 1,
      needsReview: 1,
      realConflicts: 0,
    });
    expect(output.summary.needsReviewByCategory).toEqual({ "provider-not-representable": 1 });
  });

  it("reports a REAL conflict: same request, same replay provider config, different results", async () => {
    const first = await captureOne(new EchoDouble(), "suite > first");
    const second: CaptureRecord = {
      ...first,
      origin: { ...first.origin, testName: "suite > second" },
      outcome:
        first.outcome.kind === "returned" && first.outcome.results !== null
          ? {
              ...first.outcome,
              results: first.outcome.results.map((result) => ({ ...result, translated: "Use soft yarn!" })),
            }
          : first.outcome,
    };

    const output = await mergeCapture([toFile("raw-a.jsonl", [first, second])]);

    expect(output.summary).toMatchObject({
      uniqueCanonicalRequests: 1,
      uniqueHarvestScenarios: 1,
      realConflicts: 1,
      candidates: 0,
    });
    expect(output.summary.conflictsByKind).toEqual({ results: 1 });
    const conflict = output.files.find((file) => file.path.startsWith("conflicts/"));
    expect(JSON.parse(conflict?.content ?? "null").variants).toHaveLength(2);
    expect(output.files.some((file) => file.path.startsWith("candidates/"))).toBe(false);
  });

  it("reports a REAL conflict for an incompatible provider trace under one scenario", async () => {
    const first = await captureOne(new EchoDouble(), "suite > first");
    const second: CaptureRecord = {
      ...first,
      origin: { ...first.origin, testName: "suite > second" },
      providerCalls: first.providerCalls.map((call) => ({ ...call, userPromptSha256: "0".repeat(64) })),
    };
    const output = await mergeCapture([toFile("raw-a.jsonl", [first, second])]);
    expect(output.summary.realConflicts).toBe(1);
    expect(output.summary.conflictsByKind).toEqual({ "provider-trace": 1 });
  });

  it("produces byte-identical output for identical inputs, whatever the order, files or pids", async () => {
    const echoed = await captureOne(new EchoDouble(), "suite > one");
    const records = [
      echoed,
      // Same request as `echoed` under another oracle: a second scenario.
      await captureOne(shoutingDouble(), "suite > shouts the same request"),
      await captureOne(shoutingDouble(), "suite > two", [{ id: "b9", text: "Work evenly." }]),
      handMade(),
      // A real conflict: `echoed`'s scenario with a different result.
      {
        ...echoed,
        origin: { ...echoed.origin, testName: "suite > diverges" },
        outcome:
          echoed.outcome.kind === "returned" && echoed.outcome.results !== null
            ? {
                ...echoed.outcome,
                results: echoed.outcome.results.map((result) => ({ ...result, translated: "Different." })),
              }
            : echoed.outcome,
      } satisfies CaptureRecord,
    ];
    const relabelled = records.map((record, index) => ({
      ...record,
      debug: { pid: 900 + index, workerId: String(index), sequence: 7 - index },
    }));

    const one = await mergeCapture([toFile("raw-1.jsonl", records)]);
    const two = await mergeCapture([
      toFile("raw-z.jsonl", [relabelled[4] as CaptureRecord, relabelled[2] as CaptureRecord]),
      toFile("raw-a.jsonl", [
        relabelled[3] as CaptureRecord,
        relabelled[1] as CaptureRecord,
        relabelled[0] as CaptureRecord,
      ]),
    ]);
    expect(one.summary.realConflicts).toBe(1);
    expect(one.summary.requestsWithMultipleScenarios).toBe(1);

    // summary.json records how many raw files were read, which is the one
    // thing these two runs legitimately differ in; everything else is identical.
    const withoutSummary = (files: { path: string }[]) => files.filter((file) => file.path !== "summary.json");
    expect(withoutSummary(two.files)).toEqual(withoutSummary(one.files));
    expect(two.summary.rawFiles).toBe(2);
    expect({ ...two.summary, rawFiles: 0 }).toEqual({ ...one.summary, rawFiles: 0 });
    const sameFiles = await mergeCapture([toFile("raw-q.jsonl", records)]);
    expect(sameFiles.files).toEqual(one.files);
  });

  it("classifies what a corpus case cannot represent as needs-review, with reasons", async () => {
    const boom = new Error("boom");
    const failing = harness();
    await failing.translate(SOFT_YARN, "en", { provider: throwingDouble(boom) }).catch(() => undefined);
    const refusing = harness();
    refusing.origin.testName = "suite > refused";
    await refusing.translate([{ id: "b2", text: "Other." }], "en").catch(() => undefined);

    let calls = 0;
    const stateful: TranslationProvider = {
      name: "stateful",
      model: "m",
      async translate(request) {
        calls += 1;
        return {
          translations: request.blocks.map((block) => ({ id: block.id, translated: `${block.text} #${calls}` })),
        };
      },
      async checkReadiness() {
        return { ok: true, provider: "stateful", model: "m" };
      },
    };
    const twice = harness();
    twice.origin.testName = "suite > stateful";
    await twice.translate(
      [
        { id: "s1", text: "Use soft yarn." },
        { id: "s2", text: "Use soft yarn." },
      ],
      "en",
      { provider: stateful },
    );

    const withRegions = handMade({
      request: {
        targetLanguage: "en",
        blocks: [
          {
            id: "b3",
            text: "Use soft yarn.",
            formattingRegions: [
              { id: "fmt-0", start: 0, end: 3 },
              { id: "fmt-1", start: 3, end: 14 },
            ],
          },
        ],
      },
      outcome: {
        kind: "returned",
        results: [{ id: "b3", source: "Use soft yarn.", translated: "Use soft yarn.", valid: true, errorCodes: [], warningCodes: [] }],
        diagnostics: [{ id: "b3", errors: [], warnings: [] }],
      },
    });

    const output = await mergeCapture([
      toFile("raw-a.jsonl", [
        ...failing.records,
        ...refusing.records,
        ...twice.records,
        withRegions,
      ]),
    ]);

    expect(output.summary.candidates).toBe(0);
    expect(output.summary.needsReviewByCategory).toEqual({
      "formatting-verdict-style-dependent": 1,
      "provider-not-representable": 1,
      "refused-no-provider": 1,
      threw: 1,
    });
  });

  it("infers none or oracle only, never echo, and never invents an answer", async () => {
    const echoed = await captureOne(new EchoDouble(), "suite > echo");
    expect(inferProviderConfig(echoed)).toEqual({
      ok: true,
      provider: { mode: "oracle", entries: [{ source: "Use soft yarn.", translated: "Use soft yarn." }] },
      echoCompatible: true,
    });
    expect(inferProviderConfig(handMade())).toEqual({ ok: true, provider: { mode: "none" }, echoCompatible: false });

    const shouted = await captureOne(shoutingDouble(), "suite > shout");
    expect(inferProviderConfig(shouted)).toMatchObject({
      ok: true,
      provider: { mode: "oracle", entries: [{ source: "Use soft yarn.", translated: "USE SOFT YARN." }] },
      echoCompatible: false,
    });
  });

  it("verifies candidates against the real pipeline and rejects captures it cannot reproduce", async () => {
    const good = await captureOne(new EchoDouble(), "suite > good");
    const tampered: CaptureRecord = {
      ...good,
      origin: { ...good.origin, testName: "suite > tampered" },
      request: { targetLanguage: "en", blocks: [{ id: "b1", text: "Use warm yarn." }] },
      outcome: good.outcome.kind === "returned" && good.outcome.results !== null
        ? {
            ...good.outcome,
            results: good.outcome.results.map((result) => ({ ...result, source: "Use warm yarn.", translated: "Use warm yarn." })),
          }
        : good.outcome,
      // Still claims the pipeline sent the soft-yarn text, which it would not.
    };

    const verify = (candidate: Parameters<typeof verifyCandidate>[1]) =>
      verifyCandidate(translateBlocks, candidate);
    const ok = await mergeCapture([toFile("raw-a.jsonl", [good])], { verify });
    expect(ok.summary.candidates).toBe(1);

    const bad = await mergeCapture([toFile("raw-a.jsonl", [tampered])], { verify });
    expect(bad.summary.candidates).toBe(0);
    expect(bad.summary.needsReviewByCategory).toEqual({ "replay-mismatch": 1 });
  });

  it("skips only the committed scenario, never another scenario of the same request", async () => {
    const echoed = await captureOne(new EchoDouble(), "suite > committed");
    const shouted = await captureOne(shoutingDouble(), "suite > not committed");
    const probe = await mergeCapture([toFile("raw-a.jsonl", [echoed])]);
    expect(probe.summary.candidates).toBe(1);

    const candidate = JSON.parse(probe.files.find((file) => file.path.startsWith("candidates/"))?.content ?? "null") as {
      request: unknown;
      provider: unknown;
    };
    const committed = new Set([canonicalScenarioJson(candidate.request, candidate.provider)]);

    const output = await mergeCapture([toFile("raw-a.jsonl", [echoed, shouted])], {
      committedHarvestedScenarios: committed,
    });
    expect(output.summary).toMatchObject({ alreadyCommitted: 1, candidates: 1, uniqueHarvestScenarios: 2 });
    expect(output.files.filter((file) => file.path.startsWith("candidates/"))).toHaveLength(1);
  });

  it("stops on a malformed raw line and names the file and line", async () => {
    const record = await captureOne(new EchoDouble(), "suite > malformed");
    const bad: RawCaptureFile = { name: "raw-a.jsonl", text: `${JSON.stringify(record)}\n{ nope\n` };
    await expect(mergeCapture([bad])).rejects.toBeInstanceOf(CaptureInputError);
    await expect(mergeCapture([bad])).rejects.toThrow(/raw-a\.jsonl:2/);
  });
});

// ---------------------------------------------------------------------------
// Formatting without source styles (Option 2)
// ---------------------------------------------------------------------------

describe("capture merge: formatting geometry without source styles", () => {
  const TEXT = "Use soft yarn.";
  const TWO = [
    { id: "fmt-0", start: 0, end: 3 },
    { id: "fmt-1", start: 3, end: 14 },
  ];

  const formattedRecord = (
    name: string,
    regions: { id: string; start: number; end: number }[],
    result: Partial<ExpectedResult>,
    blockId = "f1",
  ): CaptureRecord => {
    const valid = result.valid ?? true;
    return handMade({
      origin: { file: "src/x/example.test.ts", testName: `suite > ${name}`, callIndex: 0 },
      request: {
        targetLanguage: "en",
        blocks: [{ id: blockId, text: TEXT, formattingRegions: regions }],
      },
      outcome: {
        kind: "returned",
        results: [
          {
            id: blockId,
            source: TEXT,
            translated: TEXT,
            valid,
            errorCodes: valid ? [] : ["BAD_THING"],
            warningCodes: [],
            ...result,
          },
        ],
        diagnostics: [
          {
            id: blockId,
            errors: valid ? [] : [{ code: "BAD_THING", message: "not usable" }],
            warnings: [],
          },
        ],
      },
    });
  };

  const mapped = () => formattedRecord("mapped", TWO, { targetFormattingRegions: TWO });
  const noTarget = () => formattedRecord("no target regions", TWO, {}, "f2");
  const singleNoTarget = () =>
    formattedRecord("single region", [{ id: "fmt-0", start: 0, end: 14 }], {}, "f3");
  const invalid = () =>
    formattedRecord("invalid result", TWO, { valid: false }, "f4");
  const broken = () =>
    formattedRecord(
      "geometry violation",
      TWO,
      { targetFormattingRegions: [{ id: "fmt-0", start: 0, end: 3 }, { id: "fmt-1", start: 3, end: 9 }] },
      "f5",
    );

  it("mapped target geometry with unknown styles is a normal replayable candidate with no regionStyles", async () => {
    const output = await mergeCapture([toFile("raw-a.jsonl", [mapped()])]);
    expect(output.summary.candidates).toBe(1);
    expect(output.summary.needsReview).toBe(0);
    const candidate = output.files.find((file) => file.path.startsWith("candidates/"));
    expect(candidate).toBeDefined();
    const loaded = loadCorpusFiles([
      { name: candidate?.path.split("/").pop() ?? "", bytes: candidate?.content ?? "" },
    ]).executable;
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.value.regionStyles).toBeUndefined();
    expect(loaded[0]?.value.expected?.styledSlices).toEqual([
      { blockId: "f1", regionId: "fmt-0", text: "Use" },
      { blockId: "f1", regionId: "fmt-1", text: " soft yarn." },
    ]);
  });

  it("no target regions for several source regions is needs-review: formatting-verdict-style-dependent", async () => {
    const output = await mergeCapture([toFile("raw-a.jsonl", [noTarget()])]);
    expect(output.summary.candidates).toBe(0);
    expect(output.summary.needsReviewByCategory).toEqual({ "formatting-verdict-style-dependent": 1 });
    const entry = output.files.find((file) => file.path.startsWith("needs-review/"));
    expect(entry?.content).toMatch(/source styles|share one style/);
    expect(output.files.some((file) => file.path.startsWith("candidates/"))).toBe(false);
  });

  it("never treats missing styles as uniform: the same result is not accepted as if the source were one style", async () => {
    // If missing styles were assumed uniform this would be a candidate.
    const output = await mergeCapture([toFile("raw-a.jsonl", [noTarget()])]);
    expect(output.summary.candidates).toBe(0);
    // A single-region source is decided under both answers, so it is a candidate.
    const single = await mergeCapture([toFile("raw-b.jsonl", [singleNoTarget()])]);
    expect(single.summary.candidates).toBe(1);
    expect(single.summary.needsReview).toBe(0);
  });

  it("an invalid result stays characterizable: its geometry is not applied by the frontend", async () => {
    const output = await mergeCapture([toFile("raw-a.jsonl", [invalid()])]);
    expect(output.summary.candidates).toBe(1);
    expect(output.summary.needsReview).toBe(0);
  });

  it("a geometry violation in a valid result is formatting-contract-finding, not a candidate", async () => {
    const output = await mergeCapture([toFile("raw-a.jsonl", [broken()])]);
    expect(output.summary.candidates).toBe(0);
    expect(output.summary.needsReviewByCategory).toEqual({ "formatting-contract-finding": 1 });
    const entry = output.files.find((file) => file.path.startsWith("needs-review/"));
    expect(entry?.content).toMatch(/COVERAGE_INCOMPLETE/);
  });

  it("classifies a mixed capture per scenario and keeps the partition exact", async () => {
    const output = await mergeCapture([
      toFile("raw-a.jsonl", [mapped(), noTarget(), singleNoTarget(), invalid(), broken()]),
    ]);
    expect(output.summary.uniqueHarvestScenarios).toBe(5);
    expect(output.summary.candidates).toBe(3);
    expect(output.summary.needsReviewByCategory).toEqual({
      "formatting-contract-finding": 1,
      "formatting-verdict-style-dependent": 1,
    });
    expect(
      output.summary.candidates + output.summary.needsReview + output.summary.realConflicts + output.summary.alreadyCommitted,
    ).toBe(output.summary.uniqueHarvestScenarios);
    expect(JSON.stringify(output.summary.needsReviewByCategory)).not.toMatch(/formatting-styles-unknown/);
  });

  it("stays byte-stable with formatted records, whatever the order and file split", async () => {
    const records = [mapped(), noTarget(), singleNoTarget(), invalid(), broken()];
    const one = await mergeCapture([toFile("raw-1.jsonl", records)]);
    const two = await mergeCapture([
      toFile("raw-z.jsonl", [records[4] as CaptureRecord, records[1] as CaptureRecord]),
      toFile("raw-a.jsonl", [records[3] as CaptureRecord, records[0] as CaptureRecord, records[2] as CaptureRecord]),
    ]);
    const withoutSummary = (files: { path: string }[]) => files.filter((file) => file.path !== "summary.json");
    expect(withoutSummary(two.files)).toEqual(withoutSummary(one.files));
    const again = await mergeCapture([toFile("raw-1.jsonl", records)]);
    expect(again.files).toEqual(one.files);
  });
});

// ---------------------------------------------------------------------------
// Block-local region identity in captured, multi-block requests
// ---------------------------------------------------------------------------

describe("capture merge: block-local region identity", () => {
  const TEXT_A = "Use soft yarn.";
  const TEXT_B = "Chain three.";

  const regionsFor = (text: string) => [
    { id: "fmt-0", start: 0, end: 3 },
    { id: "fmt-1", start: 3, end: text.length },
  ];

  const twoBlockRecord = (): CaptureRecord =>
    handMade({
      origin: { file: "src/x/example.test.ts", testName: "suite > two formatted blocks", callIndex: 0 },
      request: {
        targetLanguage: "en",
        blocks: [
          { id: "block-a", text: TEXT_A, formattingRegions: regionsFor(TEXT_A) },
          { id: "block-b", text: TEXT_B, formattingRegions: regionsFor(TEXT_B) },
        ],
      },
      outcome: {
        kind: "returned",
        results: [
          {
            id: "block-a",
            source: TEXT_A,
            translated: TEXT_A,
            valid: true,
            errorCodes: [],
            warningCodes: [],
            targetFormattingRegions: regionsFor(TEXT_A),
          },
          {
            id: "block-b",
            source: TEXT_B,
            translated: TEXT_B,
            valid: true,
            errorCodes: [],
            warningCodes: [],
            targetFormattingRegions: regionsFor(TEXT_B),
          },
        ],
        diagnostics: [
          { id: "block-a", errors: [], warnings: [] },
          { id: "block-b", errors: [], warnings: [] },
        ],
      },
    });

  it("produces a candidate whose styledSlices distinguish fmt-0/fmt-1 of block-a from block-b", async () => {
    const output = await mergeCapture([toFile("raw-a.jsonl", [twoBlockRecord()])]);
    expect(output.summary.candidates).toBe(1);
    expect(output.summary.needsReview).toBe(0);
    const candidate = output.files.find((file) => file.path.startsWith("candidates/"));
    const loaded = loadCorpusFiles([
      { name: candidate?.path.split("/").pop() ?? "", bytes: candidate?.content ?? "" },
    ]).executable;
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.value.expected?.styledSlices).toEqual([
      { blockId: "block-a", regionId: "fmt-0", text: "Use" },
      { blockId: "block-a", regionId: "fmt-1", text: " soft yarn." },
      { blockId: "block-b", regionId: "fmt-0", text: "Cha" },
      { blockId: "block-b", regionId: "fmt-1", text: "in three." },
    ]);
  });

  it("keeps merge output byte-stable with a multi-block formatted record", async () => {
    const record = twoBlockRecord();
    const one = await mergeCapture([toFile("raw-1.jsonl", [record])]);
    const two = await mergeCapture([toFile("raw-2.jsonl", [record])]);
    const withoutSummary = (files: { path: string }[]) => files.filter((file) => file.path !== "summary.json");
    expect(withoutSummary(two.files)).toEqual(withoutSummary(one.files));
  });
});
