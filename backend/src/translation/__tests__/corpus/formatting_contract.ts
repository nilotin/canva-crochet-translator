/**
 * Backend mirror of the frontend fail-closed formatting contract
 * (test oracle only; never production behavior).
 *
 * AUTHORITY: `hasCompleteFormattingProjection` and
 * `requiresFormattingProjection` in
 * `src/intents/design_editor/translation_review.ts`, and the region-template
 * checks at the top of `remapFormattingRegions` in
 * `src/intents/design_editor/formatting_remap.ts`. Where the Stage 0 design
 * doc and that code differ, this file follows the code. The self-test file
 * carries a fingerprint of the frontend source block so that a change there
 * forces this mirror to be re-reviewed.
 *
 * Two layers, deliberately separate:
 *
 *  1. CONTRACT (`checkFormattingContract`): an exact port of the frontend
 *     boolean. `complete` must equal what the frontend returns for the same
 *     inputs. It never repairs, sorts, clamps or guesses. The first failing
 *     rule is reported, in the frontend's own evaluation order.
 *  2. ADVISORIES (`formattingContractAdvisories`): extra observations the
 *     frontend does NOT reject. They never affect `complete`. They exist so a
 *     reviewer can see, for example, that a backend-produced map looks
 *     inconsistent even though the frontend would accept it.
 *
 * Import rules (enforced by formatting_contract.test.ts): this module has no
 * runtime imports at all. It must never import translator or frontend code.
 *
 * Offsets are UTF-16 code units, exactly like `String.prototype.length`, the
 * frontend's `translated.length` and Canva's ranges. Text is never normalized
 * here. Canonicalization (NFC) is a separate layer that refuses non-NFC text
 * whenever offsets depend on it.
 */

export type TargetRegion = { id: string; start: number; end: number };

/** The only projection tag the frontend recognizes. */
export const ATOMIC_COLLAPSE = "atomic_collapse";

/** Frontend region ids are `fmt-${index}` over the source snapshot list. */
export const frontendRegionIds = (count: number): string[] =>
  Array.from({ length: count }, (_unused, index) => `fmt-${index}`);

/**
 * True when the source region ids are exactly fmt-0 .. fmt-(n-1) in order.
 * The frontend derives its valid ids from snapshot INDEX, not from anything
 * the backend echoes, so a corpus request whose ids differ cannot occur in
 * production. The contract check itself accepts any unique ids.
 */
export const followsFrontendRegionIdConvention = (
  sourceRegionIds: readonly string[],
): boolean =>
  sourceRegionIds.length === new Set(sourceRegionIds).size &&
  sourceRegionIds.every((id, index) => id === `fmt-${index}`);

// ---------------------------------------------------------------------------
// requiresFormattingProjection
// ---------------------------------------------------------------------------

/**
 * The exact attributes the frontend compares, in the frontend's order:
 * inline (color, fontWeight, fontStyle, decoration, strikethrough, link)
 * followed by paragraph (fontRef, fontSize, letterSpacingEm, lineHeightEm,
 * textAlign, listLevel, listMarker). Any other attribute is ignored.
 */
export const PROJECTION_STYLE_KEYS = [
  "color",
  "fontWeight",
  "fontStyle",
  "decoration",
  "strikethrough",
  "link",
  "fontRef",
  "fontSize",
  "letterSpacingEm",
  "lineHeightEm",
  "textAlign",
  "listLevel",
  "listMarker",
] as const;

export type RegionStyle = Readonly<Record<string, unknown>>;

const styleGroupKey = (style: RegionStyle): string =>
  JSON.stringify(
    PROJECTION_STYLE_KEYS.flatMap((key) =>
      style[key] === undefined ? [] : [[key, style[key]]],
    ),
  );

/**
 * Mirror of `requiresFormattingProjection`: true when the source regions carry
 * more than one distinct style group. A region with no entry counts as an
 * empty style, exactly like a snapshot with `formatting: {}`.
 * `null` and "absent" are different, as in the frontend.
 */
export const requiresFormattingProjection = (
  sourceRegionIds: readonly string[],
  regionStyles: readonly { regionId: string; style: RegionStyle }[],
): boolean => {
  const byId = new Map(regionStyles.map((entry) => [entry.regionId, entry.style]));
  return (
    new Set(sourceRegionIds.map((id) => styleGroupKey(byId.get(id) ?? {}))).size > 1
  );
};

// ---------------------------------------------------------------------------
// hasCompleteFormattingProjection
// ---------------------------------------------------------------------------

export type FormattingContractInput = {
  /** Source region ids in request order (unique). */
  sourceRegionIds: readonly string[];
  /** Result of `requiresFormattingProjection` for the same source regions. */
  requiresProjection: boolean;
  /** The translated text the regions index into. Its `.length` is the target length. */
  translated: string;
  targetFormattingRegions?: readonly TargetRegion[];
  /** Typed as string so unknown tags can be tested; only "atomic_collapse" counts. */
  formattingProjection?: string;
  absorbedFormattingRegionIds?: readonly string[];
};

export type FormattingContractIssueCode =
  | "MAPPING_REQUIRED_BUT_ABSENT"
  | "ABSORBED_ID_UNKNOWN"
  | "ABSORBED_ID_DUPLICATE"
  | "REGION_ID_UNKNOWN"
  | "REGION_BOUNDS_NOT_INTEGER"
  | "REGION_START_BEFORE_CURSOR"
  | "REGION_START_AFTER_CURSOR"
  | "REGION_END_BEFORE_START"
  | "REGION_END_BEYOND_TARGET"
  | "ZERO_WIDTH_UNPROVEN"
  | "COVERAGE_INCOMPLETE"
  | "SOURCE_REGION_MISSING";

export type FormattingContractIssue = {
  code: FormattingContractIssueCode;
  message: string;
  /** Index into targetFormattingRegions when the issue is about one region. */
  regionIndex?: number;
};

export type FormattingContractCheck =
  | { complete: true }
  | { complete: false; issue: FormattingContractIssue };

export class FormattingContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormattingContractError";
  }
}

const fail = (
  code: FormattingContractIssueCode,
  message: string,
  regionIndex?: number,
): FormattingContractCheck => ({
  complete: false,
  issue: regionIndex === undefined ? { code, message } : { code, message, regionIndex },
});

/**
 * Exact port of the frontend `hasCompleteFormattingProjection`, with the
 * reason for the first failure. The order of the rules is the frontend's.
 *
 * Complete means:
 *  - No target regions: complete only if the source does NOT need a
 *    projection. (`formattingProjection` and absorbed ids are not looked at.)
 *  - Otherwise, all of:
 *      - every absorbed id is a source region id, with no repeats;
 *      - walking the regions in the given order, each region has a known
 *        source id, integer bounds, `start` equal to the previous `end`
 *        (the first starts at 0), `end >= start`, and `end <= target length`;
 *      - a zero-width region is allowed only when `formattingProjection` is
 *        exactly "atomic_collapse" AND the region id is in the absorbed ids;
 *      - the last `end` equals the target length;
 *      - every source region id appears at least once.
 *
 * Not required by the frontend, so also not required here: distinct target
 * ids (an id may legitimately repeat in non-adjacent runs), absorbed ids being
 * zero-width, or the tag being paired with absorbed ids.
 */
export const checkFormattingContract = (
  input: FormattingContractInput,
): FormattingContractCheck => {
  const {
    sourceRegionIds,
    requiresProjection,
    translated,
    targetFormattingRegions,
    formattingProjection,
    absorbedFormattingRegionIds,
  } = input;

  const validIds = new Set(sourceRegionIds);
  if (validIds.size !== sourceRegionIds.length) {
    throw new FormattingContractError(
      "sourceRegionIds must be unique: the frontend derives them from snapshot index.",
    );
  }

  if (!targetFormattingRegions?.length) {
    return requiresProjection
      ? fail(
          "MAPPING_REQUIRED_BUT_ABSENT",
          "The source uses more than one style but no target formatting regions were supplied.",
        )
      : { complete: true };
  }

  const targetLength = translated.length;
  const seenIds = new Set<string>();
  const absorbedIds = new Set(absorbedFormattingRegionIds ?? []);

  const unknownAbsorbed = absorbedFormattingRegionIds?.find((id) => !validIds.has(id));
  if (unknownAbsorbed !== undefined) {
    return fail(
      "ABSORBED_ID_UNKNOWN",
      `Absorbed region id "${unknownAbsorbed}" is not a source region id.`,
    );
  }
  if (absorbedIds.size !== (absorbedFormattingRegionIds?.length ?? 0)) {
    return fail("ABSORBED_ID_DUPLICATE", "Absorbed region ids contain a repeat.");
  }

  let end = 0;

  for (const [index, region] of targetFormattingRegions.entries()) {
    if (!validIds.has(region.id)) {
      return fail("REGION_ID_UNKNOWN", `Region id "${region.id}" is not a source region id.`, index);
    }
    if (!Number.isInteger(region.start) || !Number.isInteger(region.end)) {
      return fail("REGION_BOUNDS_NOT_INTEGER", "Region bounds must be integers.", index);
    }
    if (region.start < end) {
      return fail(
        "REGION_START_BEFORE_CURSOR",
        `Region starts at ${region.start} but the previous region ended at ${end} (overlap, or a negative first start).`,
        index,
      );
    }
    if (region.start > end) {
      return fail(
        "REGION_START_AFTER_CURSOR",
        `Region starts at ${region.start} but coverage so far ends at ${end} (gap).`,
        index,
      );
    }
    if (region.end < region.start) {
      return fail("REGION_END_BEFORE_START", "Region end is before its start.", index);
    }
    if (region.end > targetLength) {
      return fail(
        "REGION_END_BEYOND_TARGET",
        `Region ends at ${region.end}, past the target length ${targetLength}.`,
        index,
      );
    }
    if (
      region.end === region.start &&
      (formattingProjection !== ATOMIC_COLLAPSE || !absorbedIds.has(region.id))
    ) {
      return fail(
        "ZERO_WIDTH_UNPROVEN",
        `Zero-width region "${region.id}" needs formattingProjection "${ATOMIC_COLLAPSE}" and an absorbed id entry.`,
        index,
      );
    }

    seenIds.add(region.id);
    end = region.end;
  }

  if (end !== targetLength) {
    return fail(
      "COVERAGE_INCOMPLETE",
      `Regions cover ${end} of ${targetLength} target characters.`,
    );
  }

  const missing = [...validIds].find((id) => !seenIds.has(id));
  if (missing !== undefined) {
    return fail("SOURCE_REGION_MISSING", `Source region "${missing}" is not accounted for.`);
  }

  return { complete: true };
};

export const isFormattingContractComplete = (input: FormattingContractInput): boolean =>
  checkFormattingContract(input).complete;

// ---------------------------------------------------------------------------
// Advisories (never part of the contract)
// ---------------------------------------------------------------------------

export type FormattingAdvisoryCode =
  | "ADJACENT_SAME_ID_RUNS"
  | "ABSORBED_ID_HAS_WIDTH"
  | "ABSORBED_WITHOUT_ATOMIC_COLLAPSE"
  | "UNKNOWN_PROJECTION_VALUE";

export type FormattingAdvisory = { code: FormattingAdvisoryCode; message: string };

/**
 * Things the frontend accepts but the backend projector does not produce.
 * The backend merges adjacent runs of one id, emits absorbed ids only as
 * zero-width regions, and only together with the "atomic_collapse" tag.
 * Advisories are informational and must never gate a test on their own.
 */
export const formattingContractAdvisories = (
  input: Pick<
    FormattingContractInput,
    | "targetFormattingRegions"
    | "formattingProjection"
    | "absorbedFormattingRegionIds"
  >,
): FormattingAdvisory[] => {
  const advisories: FormattingAdvisory[] = [];
  const regions = input.targetFormattingRegions ?? [];
  const absorbed = input.absorbedFormattingRegionIds ?? [];

  for (let index = 1; index < regions.length; index += 1) {
    const previous = regions[index - 1];
    const current = regions[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      previous.id === current.id &&
      previous.end === current.start &&
      previous.start !== previous.end &&
      current.start !== current.end
    ) {
      advisories.push({
        code: "ADJACENT_SAME_ID_RUNS",
        message: `Regions ${index - 1} and ${index} are adjacent runs of "${current.id}" and could be one run.`,
      });
    }
  }

  for (const id of absorbed) {
    if (regions.some((region) => region.id === id && region.end > region.start)) {
      advisories.push({
        code: "ABSORBED_ID_HAS_WIDTH",
        message: `Absorbed id "${id}" also has a non-zero-width region.`,
      });
    }
  }

  if (absorbed.length > 0 && input.formattingProjection !== ATOMIC_COLLAPSE) {
    advisories.push({
      code: "ABSORBED_WITHOUT_ATOMIC_COLLAPSE",
      message: `Absorbed ids are listed but formattingProjection is not "${ATOMIC_COLLAPSE}".`,
    });
  }

  if (
    input.formattingProjection !== undefined &&
    input.formattingProjection !== ATOMIC_COLLAPSE
  ) {
    advisories.push({
      code: "UNKNOWN_PROJECTION_VALUE",
      message: `formattingProjection "${input.formattingProjection}" is not recognized by the frontend.`,
    });
  }

  return advisories;
};

// ---------------------------------------------------------------------------
// Styled slices
// ---------------------------------------------------------------------------

export type StyledSlice = { regionId: string; text: string };

/**
 * The target substring each region owns, one entry per region RUN, in the
 * order given. Never sorted, merged, clamped or repaired:
 *  - a region id that repeats (legal) yields one entry per run;
 *  - a zero-width (absorbed) region yields an empty string;
 *  - a region that cannot be sliced (non-integer, negative, start > end, or
 *    past the end of the text) throws instead of being adjusted.
 * The entries have the same shape as the corpus `expected.styledSlices`.
 * Slicing does not imply the map is complete; run `checkFormattingContract`
 * for that. For a complete map the texts concatenate back to `translated`.
 */
export const styledSlices = (
  translated: string,
  regions: readonly TargetRegion[],
): StyledSlice[] =>
  regions.map((region, index) => {
    if (
      !Number.isInteger(region.start) ||
      !Number.isInteger(region.end) ||
      region.start < 0 ||
      region.end < region.start ||
      region.end > translated.length
    ) {
      throw new FormattingContractError(
        `Region ${index} ("${region.id}", ${region.start}..${region.end}) cannot be sliced from text of length ${translated.length}.`,
      );
    }
    return { regionId: region.id, text: translated.slice(region.start, region.end) };
  });

// ---------------------------------------------------------------------------
// Manual-edit precondition (formatting_remap.ts)
// ---------------------------------------------------------------------------

/** UTF-16 offsets that fall between code points. */
const codePointBoundaries = (text: string): Set<number> => {
  const offsets = new Set([0]);
  let offset = 0;
  for (const character of text) {
    offset += character.length;
    offsets.add(offset);
  }
  return offsets;
};

/**
 * Mirror of the region-template checks that open `remapFormattingRegions`,
 * which runs when a user edits a translation. A map can satisfy the contract
 * above yet fail here, for example when a boundary splits a surrogate pair.
 * Returns null when the template is acceptable.
 */
export const checkRemapPreconditions = (
  translated: string,
  regions: readonly TargetRegion[],
): { code: "REMAP_INVALID_TEMPLATE"; message: string } | null => {
  const boundaries = codePointBoundaries(translated);
  let end = 0;
  for (const region of regions) {
    if (
      region.start !== end ||
      region.end < region.start ||
      !boundaries.has(region.start) ||
      !boundaries.has(region.end)
    ) {
      return {
        code: "REMAP_INVALID_TEMPLATE",
        message: `Region "${region.id}" ${region.start}..${region.end} is not contiguous or is not on a code point boundary.`,
      };
    }
    end = region.end;
  }
  if (end !== translated.length || regions.length === 0) {
    return {
      code: "REMAP_INVALID_TEMPLATE",
      message: "Regions are empty or do not end at the target length.",
    };
  }
  return null;
};
