/**
 * Course unit resolution: the integration layer between typed course
 * decisions and the `CourseUnitResolver` seam.
 *
 * Same-block authority remains first. A same-block typed row/round is live
 * only when it agrees with block-local legacy inference, preserving the
 * existing Task 8 gate.
 *
 * Task 12 adds one narrow cross-block authority path. It is considered only
 * when same-block lookup abstains with `unknown_decision` or
 * `no_decision_on_line`, the request has a trusted dense page reading order,
 * the decision carries evidence from an earlier block, and legacy inference
 * on the exact joined page text agrees with that typed unit. Otherwise the
 * block-local fallback remains authoritative.
 *
 * `sourceContext` must still be exactly the analyzed block text; positions
 * are mapped by exact block offset rather than searching text, so duplicate
 * lines cannot be confused. Translation/provider/result array order is never
 * changed by semantic reading order.
 *
 * The typed layer is fail-closed: lookup/pre-pass errors fall back rather
 * than failing translation. `resolveCourseUnitWithReason` exposes provenance
 * for tests and diagnostics.
 *
 * Import rules: the context pre-pass and the natural-language resolver seam.
 * natural_language never imports this module or context/.
 */
import {
  lineIndexAt,
  type BlockCourseAnalysis,
  type CourseDecision,
  type CourseDecisionPrepass,
  type CrossBlockCourseDecisionPrepass,
} from "./context/course_decisions.js";
import {
  legacyCourseUnitResolver,
  type CourseUnitResolver,
  type CrochetCountUnit,
} from "./natural_language/bare_round_count.js";

/** Re-exported so the translator depends on this adapter only, never on context/ directly. */
export {
  prepareCourseDecisions,
  prepareCrossBlockCourseDecisions,
} from "./context/course_decisions.js";

export type TypedCourseLookup =
  | { readonly kind: "typed"; readonly unit: CrochetCountUnit; readonly decisions: readonly CourseDecision[] }
  | {
      readonly kind: "fallback";
      readonly reason:
        | "prepass_disabled"
        | "block_not_analyzed"
        | "unsupported_source_context"
        | "position_outside_block"
        | "no_decision_on_line"
        | "ambiguous_line"
        | "unknown_decision";
    };

export type CourseUnitResolution = {
  readonly unit: CrochetCountUnit;
  readonly source: "typed" | "typed_cross_block" | "fallback";
  readonly reason?:
    | Exclude<TypedCourseLookup, { kind: "typed" }>["reason"]
    | "typed_disagrees_with_legacy"
    | "typed_lookup_error"
    | "cross_block_disagrees_with_joined_legacy";
  readonly typedUnit?: CrochetCountUnit;
};

/** The typed answer for (`sourceContext`, `position`) in one analyzed block, or why there is none. Pure. */
export const lookupTypedCourseUnit = (
  prepass: CourseDecisionPrepass,
  blockId: string,
  sourceContext: string,
  position: number,
): TypedCourseLookup => {
  if (prepass.status !== "enabled") return { kind: "fallback", reason: "prepass_disabled" };
  const analysis: BlockCourseAnalysis | undefined = prepass.blocks.get(blockId);
  if (analysis === undefined) return { kind: "fallback", reason: "block_not_analyzed" };
  if (sourceContext !== analysis.text) return { kind: "fallback", reason: "unsupported_source_context" };
  const line = lineIndexAt(analysis, position);
  if (line === undefined) return { kind: "fallback", reason: "position_outside_block" };
  const onLine = analysis.decisions.filter(({ lineIndex }) => lineIndex === line);
  if (onLine.length === 0) return { kind: "fallback", reason: "no_decision_on_line" };
  const kinds = new Set(onLine.map(({ courseKind }) => courseKind));
  if (kinds.size !== 1) return { kind: "fallback", reason: "ambiguous_line" };
  const [kind] = kinds;
  if (kind !== "row" && kind !== "round") return { kind: "fallback", reason: "unknown_decision" };
  return { kind: "typed", unit: kind, decisions: onLine };
};

const CROSS_BLOCK_ELIGIBLE_REASONS = new Set<
  Exclude<TypedCourseLookup, { kind: "typed" }>["reason"]
>(["unknown_decision", "no_decision_on_line"]);

const lookupCrossBlockCourseUnit = (
  prepass: CrossBlockCourseDecisionPrepass,
  blockId: string,
  sourceContext: string,
  position: number,
): CrochetCountUnit | undefined => {
  if (prepass.status !== "enabled") return undefined;

  const analysis = prepass.blocks.get(blockId);
  if (analysis === undefined) return undefined;
  if (sourceContext !== analysis.text) return undefined;

  const line = lineIndexAt(analysis, position);
  if (line === undefined) return undefined;

  const onLine = analysis.decisions.filter(({ lineIndex }) => lineIndex === line);
  if (onLine.length === 0) return undefined;

  // Cross-block authority is valid only when every relevant decision inherited
  // its evidence from an earlier block in the ordered immutable pre-pass.
  if (onLine.some(({ scope }) => scope !== "cross_block")) return undefined;

  const kinds = new Set(onLine.map(({ courseKind }) => courseKind));
  if (kinds.size !== 1) return undefined;

  const [kind] = kinds;
  return kind === "row" || kind === "round" ? kind : undefined;
};

/**
 * The effective unit at (`sourceContext`, `position`) and its provenance.
 * Same-block typed authority uses the local legacy agreement gate; eligible
 * cross-block authority additionally requires joined-page legacy agreement.
 * Typed/pre-pass failures fall back.
 */
export const resolveCourseUnitWithReason = (
  prepass: CourseDecisionPrepass,
  blockId: string,
  sourceContext: string,
  position: number,
  fallback: CourseUnitResolver = legacyCourseUnitResolver,
  crossBlockPrepass?: CrossBlockCourseDecisionPrepass,
): CourseUnitResolution => {
  let lookup: TypedCourseLookup | undefined;
  try {
    lookup = lookupTypedCourseUnit(prepass, blockId, sourceContext, position);
  } catch {
    lookup = undefined;
  }

  const legacy = fallback(sourceContext, position);

  if (lookup === undefined) {
    return {
      unit: legacy,
      source: "fallback",
      reason: "typed_lookup_error",
    };
  }

  // Existing same-block authority remains first and unchanged.
  if (lookup.kind === "typed") {
    if (lookup.unit !== legacy) {
      return {
        unit: legacy,
        source: "fallback",
        reason: "typed_disagrees_with_legacy",
        typedUnit: lookup.unit,
      };
    }

    return {
      unit: lookup.unit,
      source: "typed",
      typedUnit: lookup.unit,
    };
  }

  // Only the two approved same-block abstentions may consult cross-block
  // context. All other safety failures preserve today's fallback behavior.
  if (
    crossBlockPrepass === undefined ||
    !CROSS_BLOCK_ELIGIBLE_REASONS.has(lookup.reason)
  ) {
    return {
      unit: legacy,
      source: "fallback",
      reason: lookup.reason,
    };
  }

  try {
    const crossBlockUnit = lookupCrossBlockCourseUnit(
      crossBlockPrepass,
      blockId,
      sourceContext,
      position,
    );

    if (crossBlockUnit === undefined || crossBlockPrepass.status !== "enabled") {
      return {
        unit: legacy,
        source: "fallback",
        reason: lookup.reason,
      };
    }

    const blockStart = crossBlockPrepass.blockStarts.get(blockId);
    if (blockStart === undefined) {
      return {
        unit: legacy,
        source: "fallback",
        reason: lookup.reason,
      };
    }

    // Preserve exact source-position semantics. Do not substitute line start.
    const joinedPosition = blockStart + position;

    // This is deliberately the pinned legacy authority, not an injected test
    // fallback. Trusted cross-block typed context may override block-local
    // legacy only when legacy itself agrees after seeing the ordered page.
    const joinedLegacy = legacyCourseUnitResolver(
      crossBlockPrepass.joinedText,
      joinedPosition,
    );

    if (joinedLegacy !== crossBlockUnit) {
      return {
        unit: legacy,
        source: "fallback",
        reason: "cross_block_disagrees_with_joined_legacy",
        typedUnit: crossBlockUnit,
      };
    }

    return {
      unit: crossBlockUnit,
      source: "typed_cross_block",
      typedUnit: crossBlockUnit,
    };
  } catch {
    return {
      unit: legacy,
      source: "fallback",
      reason: lookup.reason,
    };
  }
};

/**
 * A `CourseUnitResolver` for one request block. Same-block decisions use the
 * ordinary fallback agreement gate; an optional trusted cross-block pre-pass
 * may supply the narrow joined-page-authorized correction path.
 */
export const courseUnitResolverForBlock = (
  prepass: CourseDecisionPrepass,
  blockId: string,
  fallback: CourseUnitResolver = legacyCourseUnitResolver,
  crossBlockPrepass?: CrossBlockCourseDecisionPrepass,
): CourseUnitResolver => (sourceContext, position) =>
  resolveCourseUnitWithReason(
    prepass,
    blockId,
    sourceContext,
    position,
    fallback,
    crossBlockPrepass,
  ).unit;
