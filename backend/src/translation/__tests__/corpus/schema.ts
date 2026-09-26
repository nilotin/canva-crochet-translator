/**
 * Stage 0 golden-corpus case schema (test support only).
 *
 * One case is one `translateBlocks` request plus everything needed to replay
 * it hermetically and to compare the result. See the Stage 0 design doc,
 * sections B and C, for the lane / tier model.
 *
 * Import rules (enforced by harness_selftest.test.ts): this module may import
 * only `zod` and `../../types.js`. It must never import translator code, so
 * the corpus cannot form an import cycle with production modules.
 *
 * Two deliberate strictness levels:
 *  - SOURCE side (request): mirrors the production request rules, because a
 *    request is an input the pipeline is entitled to assume is well formed.
 *  - TARGET side (expected results): shape only. The corpus exists to capture
 *    what the pipeline does today, including malformed output, so a bad
 *    projection must be storable. The formatting contract layer (a later
 *    file) is what judges validity.
 */
import { z } from "zod";
import { targetLanguageSchema } from "../../types.js";

export const CORPUS_SCHEMA_VERSION = 1;

export const CORPUS_LANES = ["harvested", "curated", "repro"] as const;
export const CORPUS_STATUSES = [
  "characterized",
  "approved",
  "known-bad",
  "pending-approval",
] as const;

export type CorpusLane = (typeof CORPUS_LANES)[number];
export type CorpusStatus = (typeof CORPUS_STATUSES)[number];

/** Which statuses each lane may carry. */
export const LANE_STATUSES: Readonly<
  Record<CorpusLane, readonly CorpusStatus[]>
> = {
  harvested: ["characterized"],
  curated: ["approved", "pending-approval"],
  repro: ["known-bad"],
};

/** First character of a case id, per lane. */
export const LANE_ID_PREFIX: Readonly<Record<CorpusLane, string>> = {
  harvested: "h",
  curated: "c",
  repro: "r",
};

export const corpusLaneSchema = z.enum(CORPUS_LANES);
export const corpusStatusSchema = z.enum(CORPUS_STATUSES);

const nonEmptyString = z.string().min(1);
// Ids are NOT trimmed: the corpus must round-trip them byte for byte.
const identifierSchema = z.string().min(1).max(200);
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const labelSchema = z.string().regex(slugPattern);

/** `h-3fa9c21b07` or `h-3fa9c21b07-arm-fold`. */
export const CASE_ID_PATTERN = /^[hcr]-[0-9a-f]{10}(?:-[a-z0-9]+)*$/;
export const caseIdSchema = z.string().regex(CASE_ID_PATTERN);

// ---------------------------------------------------------------------------
// Request (source side)
// ---------------------------------------------------------------------------

export const sourceRegionSchema = z
  .strictObject({
    id: identifierSchema,
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .refine(({ start, end }) => end >= start, {
    message: "Formatting region end must not be before start.",
  });

export const corpusBlockSchema = z
  .strictObject({
    id: identifierSchema,
    text: z.string().max(20_000),
    formattingRegions: z.array(sourceRegionSchema).optional(),
  })
  .superRefine(({ text, formattingRegions }, context) => {
    const seenIds = new Set<string>();
    for (const [index, region] of (formattingRegions ?? []).entries()) {
      if (region.end > text.length) {
        context.addIssue({
          code: "custom",
          message: "Formatting region exceeds source text length.",
          path: ["formattingRegions", index],
        });
      }
      // Formatting region ids are BLOCK-LOCAL, exactly like the frontend's own
      // `fmt-${index}` ids (one snapshot list per block). Uniqueness is
      // required only within this block; the same id in another block is a
      // different region, not a collision.
      if (seenIds.has(region.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate formatting region id "${region.id}" in this block.`,
          path: ["formattingRegions", index, "id"],
        });
      }
      seenIds.add(region.id);
    }
  });

export const corpusRequestSchema = z
  .strictObject({
    targetLanguage: targetLanguageSchema,
    // Absent means "whatever translateBlocks defaults to". It is not filled in,
    // so a stored request is exactly what the test passed.
    contentKind: z.enum(["pattern", "materials"]).optional(),
    blocks: z.array(corpusBlockSchema).min(1).max(100),
  })
  .superRefine(({ blocks }, context) => {
    const seen = new Set<string>();
    for (const [index, block] of blocks.entries()) {
      if (seen.has(block.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate block id: ${block.id}`,
          path: ["blocks", index, "id"],
        });
      }
      seen.add(block.id);
    }
  });

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

export const oracleEntrySchema = z.strictObject({
  /** Exact block text the provider will be sent. */
  source: z.string(),
  translated: z.string(),
});

export const providerConfigSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("none") }),
  z.strictObject({ mode: z.literal("echo") }),
  z
    .strictObject({
      mode: z.literal("oracle"),
      // An array of pairs, not an object keyed by text: block text can be any
      // string (including "__proto__"), and duplicates must be detectable.
      entries: z.array(oracleEntrySchema).min(1),
    })
    .superRefine(({ entries }, context) => {
      const seen = new Set<string>();
      for (const [index, entry] of entries.entries()) {
        if (seen.has(entry.source)) {
          context.addIssue({
            code: "custom",
            message: "Duplicate oracle source text.",
            path: ["entries", index, "source"],
          });
        }
        seen.add(entry.source);
      }
    }),
]);

// ---------------------------------------------------------------------------
// Expected results (contract tier)
// ---------------------------------------------------------------------------

export const targetRegionSchema = z.strictObject({
  id: identifierSchema,
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

export const expectedResultSchema = z.strictObject({
  id: identifierSchema,
  source: z.string(),
  translated: z.string(),
  valid: z.boolean(),
  /** Sorted, duplicates kept. Messages live in the trace tier. */
  errorCodes: z.array(nonEmptyString),
  warningCodes: z.array(nonEmptyString),
  targetFormattingRegions: z.array(targetRegionSchema).optional(),
  formattingProjection: z.literal("atomic_collapse").optional(),
  absorbedFormattingRegionIds: z.array(identifierSchema).optional(),
});

export const styledSliceSchema = z.strictObject({
  /** The block the region belongs to. Region ids are block-local. */
  blockId: identifierSchema,
  regionId: identifierSchema,
  text: z.string(),
});

export const expectedSchema = z.strictObject({
  results: z.array(expectedResultSchema).min(1),
  styledSlices: z.array(styledSliceSchema).optional(),
});

/**
 * Style attributes for one source region, as captured by the exporter.
 * Region ids are block-local (the frontend derives them per block from
 * snapshot index), so a style entry names both the block and the region.
 */
export const regionStyleSchema = z.strictObject({
  blockId: identifierSchema,
  regionId: identifierSchema,
  style: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
});

// ---------------------------------------------------------------------------
// Trace tier
// ---------------------------------------------------------------------------

export const providerCallTraceSchema = z
  .strictObject({
    targetLanguage: targetLanguageSchema,
    blockIds: z.array(identifierSchema),
    blockTexts: z.array(z.string()),
    /** Prompts are hashed, never stored. */
    systemPromptSha256: sha256HexSchema,
    userPromptSha256: sha256HexSchema,
  })
  .refine(({ blockIds, blockTexts }) => blockIds.length === blockTexts.length, {
    message: "blockIds and blockTexts must have the same length.",
  });

export const diagnosticTraceSchema = z.strictObject({
  code: nonEmptyString,
  message: z.string(),
});

export const traceSchema = z.strictObject({
  /** In call order. The number of calls is the array length. */
  providerCalls: z.array(providerCallTraceSchema),
  /** Original order, messages included. One entry per result, in result order. */
  diagnostics: z.array(
    z.strictObject({
      id: identifierSchema,
      errors: z.array(diagnosticTraceSchema),
      warnings: z.array(diagnosticTraceSchema),
    }),
  ),
});

// ---------------------------------------------------------------------------
// Labels, provenance, known-bad metadata
// ---------------------------------------------------------------------------

export const labelsSchema = z.strictObject({
  families: z.array(labelSchema),
  hazards: z.array(labelSchema),
  zeroProvider: z.boolean(),
});

export const originSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("test"),
    file: nonEmptyString,
    test: nonEmptyString,
    callIndex: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("manual"),
    note: nonEmptyString,
  }),
]);

export const knownReproSchema = z.strictObject({
  note: nonEmptyString,
  /** Human-approved target text. Never asserted in Stage 0. */
  desired: z.array(z.string()),
  /** Strings reported from a live run. Evidence only, never asserted. */
  observedLive: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Case
// ---------------------------------------------------------------------------

export const corpusCaseSchema = z
  .strictObject({
    schema: z.literal(CORPUS_SCHEMA_VERSION),
    id: caseIdSchema,
    lane: corpusLaneSchema,
    status: corpusStatusSchema,
    origins: z.array(originSchema).min(1),
    request: corpusRequestSchema,
    regionStyles: z.array(regionStyleSchema).optional(),
    provider: providerConfigSchema,
    expected: expectedSchema.optional(),
    trace: traceSchema.optional(),
    labels: labelsSchema,
    known: knownReproSchema.optional(),
  })
  .superRefine((value, context) => {
    const issue = (message: string, path: (string | number)[]) =>
      context.addIssue({ code: "custom", message, path });

    if (!LANE_STATUSES[value.lane].includes(value.status)) {
      issue(
        `Status "${value.status}" is not allowed in lane "${value.lane}".`,
        ["status"],
      );
    }

    if (!value.id.startsWith(`${LANE_ID_PREFIX[value.lane]}-`)) {
      issue(
        `Case id must start with "${LANE_ID_PREFIX[value.lane]}-" for lane "${value.lane}".`,
        ["id"],
      );
    }

    if ((value.status === "known-bad") !== (value.known !== undefined)) {
      issue('"known" is required for, and only allowed on, known-bad cases.', [
        "known",
      ]);
    }

    if (value.status !== "pending-approval") {
      if (value.expected === undefined) {
        issue("expected is required unless the case is pending-approval.", [
          "expected",
        ]);
      }
      if (value.trace === undefined) {
        issue("trace is required unless the case is pending-approval.", [
          "trace",
        ]);
      }
    }

    const blockIds = new Set(value.request.blocks.map((block) => block.id));
    // Formatting region ids are block-local: keyed by blockId, not flattened.
    // The same region id may legitimately appear in more than one block.
    const regionIdsByBlock = new Map<string, Set<string>>(
      value.request.blocks.map((block) => [
        block.id,
        new Set((block.formattingRegions ?? []).map((region) => region.id)),
      ]),
    );
    const blockHasRegion = (blockId: string, regionId: string): boolean =>
      regionIdsByBlock.get(blockId)?.has(regionId) === true;

    const resultIds = new Set<string>();
    for (const [index, result] of (value.expected?.results ?? []).entries()) {
      if (!blockIds.has(result.id)) {
        issue(`Result id "${result.id}" is not a request block id.`, [
          "expected",
          "results",
          index,
          "id",
        ]);
      }
      if (resultIds.has(result.id)) {
        issue(`Duplicate result id "${result.id}".`, [
          "expected",
          "results",
          index,
          "id",
        ]);
      }
      resultIds.add(result.id);
    }

    for (const [index, slice] of (value.expected?.styledSlices ?? []).entries()) {
      if (!blockIds.has(slice.blockId)) {
        issue(`styledSlices block "${slice.blockId}" is not in the request.`, [
          "expected",
          "styledSlices",
          index,
          "blockId",
        ]);
      } else if (!blockHasRegion(slice.blockId, slice.regionId)) {
        issue(
          `styledSlices region "${slice.regionId}" is not in block "${slice.blockId}".`,
          ["expected", "styledSlices", index, "regionId"],
        );
      }
    }

    // Seen (blockId, regionId) pairs, as a map of sets rather than a
    // delimiter-based composite string key: the pair is the identity.
    const seenStyledPairs = new Map<string, Set<string>>();
    for (const [index, entry] of (value.regionStyles ?? []).entries()) {
      if (!blockIds.has(entry.blockId)) {
        issue(`regionStyles block "${entry.blockId}" is not in the request.`, [
          "regionStyles",
          index,
          "blockId",
        ]);
        continue;
      }
      if (!blockHasRegion(entry.blockId, entry.regionId)) {
        issue(
          `regionStyles region "${entry.regionId}" is not in block "${entry.blockId}".`,
          ["regionStyles", index, "regionId"],
        );
      }
      const seenInBlock = seenStyledPairs.get(entry.blockId) ?? new Set<string>();
      if (seenInBlock.has(entry.regionId)) {
        issue(
          `Duplicate regionStyles entry for block "${entry.blockId}", region "${entry.regionId}".`,
          ["regionStyles", index, "regionId"],
        );
      }
      seenInBlock.add(entry.regionId);
      seenStyledPairs.set(entry.blockId, seenInBlock);
    }

    if (value.trace !== undefined) {
      const callCount = value.trace.providerCalls.length;
      if (value.provider.mode === "none" && callCount !== 0) {
        issue('Provider mode "none" requires zero recorded provider calls.', [
          "trace",
          "providerCalls",
        ]);
      }
      if (value.labels.zeroProvider !== (callCount === 0)) {
        issue("labels.zeroProvider must equal (trace.providerCalls is empty).", [
          "labels",
          "zeroProvider",
        ]);
      }
    }
  });

export type CorpusBlock = z.infer<typeof corpusBlockSchema>;
export type CorpusRequest = z.infer<typeof corpusRequestSchema>;
export type OracleEntry = z.infer<typeof oracleEntrySchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type ExpectedResult = z.infer<typeof expectedResultSchema>;
export type ProviderCallTrace = z.infer<typeof providerCallTraceSchema>;
export type CorpusTrace = z.infer<typeof traceSchema>;
export type CorpusCase = z.infer<typeof corpusCaseSchema>;

export const parseCorpusCase = (input: unknown): CorpusCase =>
  corpusCaseSchema.parse(input);
