/**
 * Raw capture record (test support only, Stage 0 Step 6).
 *
 * One record is one runtime `translateBlocks` call observed by the capture
 * wrapper. Records are TEMPORARY: they live in `backend/.corpus-capture/raw`
 * as JSONL, are merged by `capture_merge.ts`, and are never committed.
 *
 * Determinism: nothing in a record depends on a clock, randomness or the
 * environment. The only process-specific data is `debug` (pid, worker id,
 * per-sink sequence), which is written for troubleshooting and IGNORED by the
 * merge step, so two runs of the same tests merge to identical output.
 *
 * Import rules: only `zod` and `./schema.js`. No translator, provider or
 * vitest imports.
 */
import { z } from "zod";
import { expectedResultSchema, traceSchema } from "./schema.js";

export const CAPTURE_SCHEMA_VERSION = 1;

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

const capturedProviderBlockSchema = z.strictObject({
  id: z.string(),
  text: z.string(),
});

export const capturedProviderCallSchema = z.strictObject({
  targetLanguage: z.string(),
  /** Exactly what the pipeline sent, in order. */
  blocks: z.array(capturedProviderBlockSchema),
  /** Prompts are hashed, never stored. */
  systemPromptSha256: sha256Hex,
  userPromptSha256: sha256Hex,
  outcome: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("returned"),
      /** Null when the provider returned something that is not {id, translated}[]. */
      translations: z
        .array(z.strictObject({ id: z.string(), translated: z.string() }))
        .nullable(),
    }),
    z.strictObject({
      kind: z.literal("threw"),
      errorName: z.string(),
      errorMessage: z.string(),
    }),
  ]),
});

export const captureOutcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("returned"),
    /** Null when the results could not be projected (see captureIssues). */
    results: z.array(expectedResultSchema).nullable(),
    diagnostics: traceSchema.shape.diagnostics,
  }),
  z.strictObject({
    kind: z.literal("threw"),
    errorName: z.string(),
    errorMessage: z.string(),
  }),
  /** translateBlocks was called without a provider; the capture guard refused it. */
  z.strictObject({ kind: z.literal("refused-no-provider") }),
]);

export const captureRecordSchema = z.strictObject({
  schema: z.literal(CAPTURE_SCHEMA_VERSION),
  origin: z.strictObject({
    /** Path relative to the backend root, posix separators. Null when unknown. */
    file: z.string().nullable(),
    /** Vitest's full test name ("suite > test"). Null when unknown. */
    testName: z.string().nullable(),
    /** Index of this translateBlocks call within (file, testName). */
    callIndex: z.number().int().nonnegative(),
  }),
  /** Troubleshooting only. Ignored by the merge. */
  debug: z.strictObject({
    pid: z.number().int(),
    workerId: z.string(),
    sequence: z.number().int().nonnegative(),
  }),
  /** The request exactly as the test passed it (JSON-cloned). */
  request: z.strictObject({
    targetLanguage: z.string(),
    contentKind: z.string().optional(),
    blocks: z.array(z.unknown()),
  }),
  /** Facts about the request the corpus request schema cannot hold (extra options...). */
  requestNotes: z.array(z.string()),
  provider: z.strictObject({ name: z.string(), model: z.string() }).nullable(),
  providerCalls: z.array(capturedProviderCallSchema),
  readinessChecks: z.number().int().nonnegative(),
  outcome: captureOutcomeSchema,
  /** Problems the capture itself hit. A non-empty list makes the record needs-review. */
  captureIssues: z.array(z.string()),
});

export type CapturedProviderCall = z.infer<typeof capturedProviderCallSchema>;
export type CaptureOutcome = z.infer<typeof captureOutcomeSchema>;
export type CaptureRecord = z.infer<typeof captureRecordSchema>;
export type CaptureOrigin = CaptureRecord["origin"];

export const parseCaptureRecord = (input: unknown): CaptureRecord =>
  captureRecordSchema.parse(input);
