/**
 * Deterministic canonical forms for corpus storage, comparison and hashing
 * (test support only).
 *
 * Import rules (enforced by harness_selftest.test.ts): only `node:crypto`,
 * `zod`, `../../types.js` and `./schema.js`. No clocks, no randomness, no
 * environment access, no locale-dependent APIs (`localeCompare`, `Intl`,
 * argument-less `toLocale*Case`).
 *
 * Design decisions worth knowing before changing anything here:
 *
 * 1. Strings are normalized to NFC, EXCEPT where the string is indexed by
 *    formatting-region offsets. NFC can change a string's length, which would
 *    silently shift region offsets. For those strings (a request block that
 *    has regions, a result whose `translated` has target regions) a non-NFC
 *    value is a hard error, never a silent rewrite.
 * 2. Object keys are sorted by UTF-16 code unit, never by locale.
 * 3. Arrays keep their order. Ordering that the pipeline defines (blocks,
 *    results, formatting regions, provider calls, message order) is part of
 *    the contract, so it is preserved and never "fixed" by sorting.
 * 4. Sets that carry no order meaning (diagnostic codes, labels, oracle
 *    entries, origins, style entries) are sorted. Diagnostic codes keep
 *    duplicates: a repeated code is information.
 * 5. Nothing is silently discarded. Values JSON cannot represent, unknown
 *    fields on a pipeline result, and key collisions all throw.
 */
import { createHash } from "node:crypto";
import type { z } from "zod";
import type { TranslationResult } from "../../types.js";
import {
  LANE_ID_PREFIX,
  corpusCaseSchema,
  corpusRequestSchema,
  expectedResultSchema,
  providerConfigSchema,
  type CorpusCase,
  type CorpusLane,
  type CorpusRequest,
  type ExpectedResult,
  type ProviderConfig,
} from "./schema.js";

export type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

/** Locale-independent UTF-16 code unit comparison. */
export const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const toNfc = (text: string): string => text.normalize("NFC");

export const isNfc = (text: string): boolean => text === toNfc(text);

export const sha256Hex = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

const isPlainObject = (value: object): boolean => {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * Deep canonical form: NFC strings, sorted object keys, array order kept,
 * `undefined` object properties treated as absent (as JSON does).
 * Throws on anything JSON cannot round-trip faithfully.
 */
export const canonicalizeJson = (
  value: unknown,
  path = "$",
  ancestors: Set<object> = new Set(),
): CanonicalJson => {
  if (value === null) {
    return null;
  }

  switch (typeof value) {
    case "string":
      return toNfc(value);
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError(`${path}: non-finite number is not storable.`);
      }
      return Object.is(value, -0) ? 0 : value;
    case "object":
      break;
    default:
      throw new TypeError(`${path}: ${typeof value} is not storable.`);
  }

  if (ancestors.has(value)) {
    throw new TypeError(`${path}: circular reference is not storable.`);
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      return Array.from(value as unknown[], (item, index) =>
        canonicalizeJson(item, `${path}[${index}]`, ancestors),
      );
    }

    if (!isPlainObject(value)) {
      throw new TypeError(`${path}: only plain objects and arrays are storable.`);
    }

    const entries: [string, CanonicalJson][] = [];
    for (const key of Object.keys(value)) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) {
        continue;
      }
      entries.push([
        toNfc(key),
        canonicalizeJson(child, `${path}.${key}`, ancestors),
      ]);
    }

    entries.sort(([left], [right]) => compareStrings(left, right));
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1];
      const current = entries[index];
      if (previous !== undefined && current !== undefined && previous[0] === current[0]) {
        throw new TypeError(`${path}: duplicate key "${current[0]}" after NFC.`);
      }
    }

    // fromEntries defines own properties, so a key such as "__proto__" is
    // stored as data and never touches the prototype.
    return Object.fromEntries(entries);
  } finally {
    ancestors.delete(value);
  }
};

/** Compact canonical JSON. Used for hashing and equality. */
export const canonicalJson = (value: unknown): string =>
  JSON.stringify(canonicalizeJson(value));

/** Canonical JSON for files on disk: two-space indent, trailing newline. */
export const canonicalJsonPretty = (value: unknown): string =>
  `${JSON.stringify(canonicalizeJson(value), null, 2)}\n`;

/**
 * Validate with the schema, canonicalize, and validate again. The second pass
 * catches invariants that NFC normalization could break (for example two ids
 * that only differ in composition and now collide).
 */
const validateAndCanonicalize = <TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
): z.infer<TSchema> => {
  const canonical = canonicalizeJson(schema.parse(value));
  schema.parse(canonical);
  // Canonicalization preserves structure, and both parses above passed, so the
  // canonical value has the schema's shape.
  return canonical as unknown as z.infer<TSchema>;
};

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/** Stable order: code, then message, by code unit. Returns a new array. */
export const sortDiagnostics = <T extends { code: string; message: string }>(
  diagnostics: readonly T[],
): T[] =>
  [...diagnostics].sort(
    (left, right) =>
      compareStrings(left.code, right.code) ||
      compareStrings(left.message, right.message),
  );

/** Sorted code list. Duplicates are kept on purpose. */
export const sortedDiagnosticCodes = (
  diagnostics: readonly { code: string }[],
): string[] => diagnostics.map(({ code }) => code).sort(compareStrings);

// ---------------------------------------------------------------------------
// Request and result
// ---------------------------------------------------------------------------

export class OffsetUnsafeNormalizationError extends Error {
  constructor(what: string) {
    super(
      `${what} is not NFC and is indexed by formatting-region offsets. ` +
        "Normalizing it would shift the offsets, so it is refused. " +
        "Fix the fixture text or record it as an explicit, reviewed exception.",
    );
    this.name = "OffsetUnsafeNormalizationError";
  }
}

export const canonicalizeRequest = (request: unknown): CorpusRequest => {
  const parsed = corpusRequestSchema.parse(request);
  for (const block of parsed.blocks) {
    if (
      block.formattingRegions !== undefined &&
      block.formattingRegions.length > 0 &&
      !isNfc(block.text)
    ) {
      throw new OffsetUnsafeNormalizationError(
        `Text of block "${block.id}"`,
      );
    }
  }
  return validateAndCanonicalize(corpusRequestSchema, parsed);
};

const KNOWN_RESULT_KEYS: ReadonlySet<string> = new Set([
  "id",
  "source",
  "translated",
  "valid",
  "errors",
  "warnings",
  "targetFormattingRegions",
  "formattingProjection",
  "absorbedFormattingRegionIds",
]);

/**
 * Project a pipeline `TranslationResult` onto the stored contract shape.
 * A field this function does not know about is an error, so a new field on
 * `TranslationResult` cannot slip past the corpus unnoticed.
 */
export const canonicalizeResult = (result: TranslationResult): ExpectedResult => {
  for (const key of Object.keys(result)) {
    if (!KNOWN_RESULT_KEYS.has(key)) {
      throw new TypeError(
        `TranslationResult has unknown field "${key}". Extend the corpus schema and canonicalizeResult before freezing results.`,
      );
    }
  }

  if (result.targetFormattingRegions !== undefined && !isNfc(result.translated)) {
    throw new OffsetUnsafeNormalizationError(
      `Translated text of block "${result.id}"`,
    );
  }

  return validateAndCanonicalize(expectedResultSchema, {
    id: result.id,
    source: result.source,
    translated: result.translated,
    valid: result.valid,
    errorCodes: sortedDiagnosticCodes(result.errors),
    warningCodes: sortedDiagnosticCodes(result.warnings),
    targetFormattingRegions: result.targetFormattingRegions?.map((region) => ({
      id: region.id,
      start: region.start,
      end: region.end,
    })),
    formattingProjection: result.formattingProjection,
    absorbedFormattingRegionIds: result.absorbedFormattingRegionIds
      ? [...result.absorbedFormattingRegionIds]
      : undefined,
  });
};

// ---------------------------------------------------------------------------
// Case ids
// ---------------------------------------------------------------------------

const MAX_SLUG_LENGTH = 40;
const HASH_LENGTH = 10;

/**
 * ASCII slug from free text. Turkish letters are folded (ı to i, ş to s, and
 * so on). Purely cosmetic: never part of the hash.
 */
export const slugFromText = (text: string, maxWords = 4): string => {
  const folded = text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (folded === "") {
    return "";
  }
  return folded
    .split(" ")
    .slice(0, maxWords)
    .join("-")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");
};

/**
 * Content-derived id: lane prefix, ten hex characters of SHA-256 over the
 * canonical request, and an optional cosmetic slug. Independent of page
 * numbers, file order, array positions of cases, time and randomness.
 * The same request in a different lane shares the hash, not the prefix.
 *
 * This is the id of the `repro` and `curated` lanes. It identifies a SOURCE
 * REQUEST only. The `harvested` lane identifies a scenario (request plus replay
 * provider config) and uses `deriveHarvestedCaseId` below; the loader rejects a
 * request-only id in that lane. Existing repro and curated ids never change.
 */
export const deriveCaseId = (
  lane: CorpusLane,
  request: unknown,
  slug?: string,
): string => {
  const hash = sha256Hex(canonicalJson(canonicalizeRequest(request))).slice(
    0,
    HASH_LENGTH,
  );
  const base = `${LANE_ID_PREFIX[lane]}-${hash}`;
  if (slug === undefined || slug === "") {
    return base;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > MAX_SLUG_LENGTH) {
    throw new TypeError(
      `Case id slug must be lowercase ASCII words joined by "-" (max ${MAX_SLUG_LENGTH}): "${slug}"`,
    );
  }
  return `${base}-${slug}`;
};

/** True when the case id's lane prefix and hash match its request. */
export const caseIdMatchesRequest = (
  caseValue: Pick<CorpusCase, "id" | "lane" | "request">,
): boolean => {
  const expected = deriveCaseId(caseValue.lane, caseValue.request);
  return (
    caseValue.id === expected || caseValue.id.startsWith(`${expected}-`)
  );
};

// ---------------------------------------------------------------------------
// Harvested scenarios
// ---------------------------------------------------------------------------

const SCENARIO_HASH_LENGTH = 8;

/**
 * Canonical replay provider config: schema-checked, oracle entries sorted by
 * source text (their order carries no meaning), strings NFC.
 */
export const canonicalizeProvider = (provider: unknown): ProviderConfig => {
  const parsed = providerConfigSchema.parse(provider);
  const arranged: ProviderConfig =
    parsed.mode === "oracle"
      ? {
          mode: "oracle",
          entries: [...parsed.entries].sort((left, right) =>
            compareStrings(toNfc(left.source), toNfc(right.source)),
          ),
        }
      : parsed;
  return validateAndCanonicalize(providerConfigSchema, arranged);
};

/**
 * The behavioral identity of a harvested capture: the canonical request plus
 * the canonical replay provider config, and nothing else. Test file, test name,
 * origins, timestamps and worker ids are provenance, not behavior, and are
 * never part of it. The same request under two different provider behaviors is
 * two scenarios.
 */
export const canonicalScenarioJson = (
  request: unknown,
  provider: unknown,
): string =>
  canonicalJson({
    provider: canonicalizeProvider(provider),
    request: canonicalizeRequest(request),
  });

export const scenarioSha256 = (request: unknown, provider: unknown): string =>
  sha256Hex(canonicalScenarioJson(request, provider));

const withSlug = (base: string, slug: string | undefined): string => {
  if (slug === undefined || slug === "") {
    return base;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > MAX_SLUG_LENGTH) {
    throw new TypeError(
      `Case id slug must be lowercase ASCII words joined by "-" (max ${MAX_SLUG_LENGTH}): "${slug}"`,
    );
  }
  return `${base}-${slug}`;
};

/**
 * Id of a harvested case: `h-<10 hex request hash>-s<8 hex scenario hash>` and
 * an optional cosmetic slug. The first hash is the SAME request hash the other
 * lanes use, so all scenarios of one request sort together and share a prefix.
 * The second, marked with `s`, is SHA-256 over `canonicalScenarioJson`, so the
 * same request with a different replay provider config gets a different id.
 * Content-derived only: no origin, test name, page number, time or randomness.
 */
export const deriveHarvestedCaseId = (
  request: unknown,
  provider: unknown,
  slug?: string,
): string => {
  const requestHash = sha256Hex(canonicalJson(canonicalizeRequest(request))).slice(
    0,
    HASH_LENGTH,
  );
  const scenarioHash = scenarioSha256(request, provider).slice(0, SCENARIO_HASH_LENGTH);
  return withSlug(`${LANE_ID_PREFIX.harvested}-${requestHash}-s${scenarioHash}`, slug);
};

/** True when a harvested case's id carries the right request and scenario hashes. */
export const caseIdMatchesScenario = (
  caseValue: Pick<CorpusCase, "id" | "request" | "provider">,
): boolean => {
  const expected = deriveHarvestedCaseId(caseValue.request, caseValue.provider);
  return caseValue.id === expected || caseValue.id.startsWith(`${expected}-`);
};

// ---------------------------------------------------------------------------
// Case
// ---------------------------------------------------------------------------

const sortedUnique = (values: readonly string[]): string[] =>
  [...new Set(values.map(toNfc))].sort(compareStrings);

const sortByCanonicalJson = <T>(values: readonly T[]): T[] =>
  values
    .map((value) => ({ value, key: canonicalJson(value) }))
    .sort((left, right) => compareStrings(left.key, right.key))
    .map(({ value }) => value);

/**
 * Canonical stored form of a case. Idempotent. Sorts only the collections
 * that carry no order meaning (see the module comment); everything else keeps
 * its order.
 */
export const canonicalizeCase = (input: unknown): CorpusCase => {
  const parsed = corpusCaseSchema.parse(input);

  for (const block of parsed.request.blocks) {
    if (
      block.formattingRegions !== undefined &&
      block.formattingRegions.length > 0 &&
      !isNfc(block.text)
    ) {
      throw new OffsetUnsafeNormalizationError(`Text of block "${block.id}"`);
    }
  }
  for (const result of parsed.expected?.results ?? []) {
    if (result.targetFormattingRegions !== undefined && !isNfc(result.translated)) {
      throw new OffsetUnsafeNormalizationError(
        `Translated text of block "${result.id}"`,
      );
    }
  }

  const arranged: CorpusCase = {
    ...parsed,
    origins: sortByCanonicalJson(parsed.origins),
    labels: {
      ...parsed.labels,
      families: sortedUnique(parsed.labels.families),
      hazards: sortedUnique(parsed.labels.hazards),
    },
    provider:
      parsed.provider.mode === "oracle"
        ? {
            mode: "oracle",
            entries: [...parsed.provider.entries].sort((left, right) =>
              compareStrings(toNfc(left.source), toNfc(right.source)),
            ),
          }
        : parsed.provider,
    // Region ids are block-local, so the sort key is the (blockId, regionId)
    // pair: blockId first, so entries stay grouped by block.
    ...(parsed.regionStyles === undefined
      ? {}
      : {
          regionStyles: [...parsed.regionStyles].sort(
            (left, right) =>
              compareStrings(left.blockId, right.blockId) ||
              compareStrings(left.regionId, right.regionId),
          ),
        }),
    ...(parsed.expected === undefined
      ? {}
      : {
          expected: {
            ...parsed.expected,
            ...(parsed.expected.styledSlices === undefined
              ? {}
              : {
                  styledSlices: [...parsed.expected.styledSlices].sort(
                    (left, right) =>
                      compareStrings(left.blockId, right.blockId) ||
                      compareStrings(left.regionId, right.regionId),
                  ),
                }),
          },
        }),
  };

  return validateAndCanonicalize(corpusCaseSchema, arranged);
};
