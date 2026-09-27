/**
 * Course unit resolution (next stage, Task 8): the integration layer between
 * the typed same-block course decisions and the `CourseUnitResolver` seam.
 * The translator builds one resolver per request block from the pre-pass and
 * threads it into the normalizer, the style normalizer and the validator.
 *
 * `lookupTypedCourseUnit` gives a typed row or round only when all of these
 * hold; otherwise it names the reason there is none:
 *
 *  - the pre-pass is enabled and has an analysis for this block id;
 *  - `sourceContext` is exactly that block's text (every translator call site
 *    passes the original block text; a segment or unit body is NOT mapped by
 *    searching for it, so duplicate lines can never be confused);
 *  - `position` lies in the block, so it maps to one lexical line;
 *  - that line holds at least one course_count decision, and all of them
 *    agree on row or on round (unknown, mixed kinds or none: no answer).
 *
 * Agreement gate (Task 8): a typed answer takes effect only when it equals
 * `fallback` (the legacy inference by default) at the same arguments. When
 * they differ the effective unit is the fallback's and the reason is
 * `typed_disagrees_with_legacy`, so production output cannot change. The
 * known disagreements (a blank line or a yarn cut between the turn and the
 * count, and turn evidence on an unnumbered line) are carried debt for a
 * later reset-parity task, not PatternContext changes here.
 *
 * The resolver never throws because of the typed layer: any error there also
 * falls back. `resolveCourseUnitWithReason` is the pure debug view the
 * resolver itself uses.
 *
 * Import rules: the context pre-pass and the natural-language resolver seam.
 * natural_language never imports this module or context/.
 */
import {
  lineIndexAt,
  type BlockCourseAnalysis,
  type CourseDecision,
  type CourseDecisionPrepass,
} from "./context/course_decisions.js";
import {
  legacyCourseUnitResolver,
  type CourseUnitResolver,
  type CrochetCountUnit,
} from "./natural_language/bare_round_count.js";

/** Re-exported so the translator depends on this adapter only, never on context/ directly. */
export { prepareCourseDecisions } from "./context/course_decisions.js";

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
  readonly source: "typed" | "fallback";
  readonly reason?: Exclude<TypedCourseLookup, { kind: "typed" }>["reason"] | "typed_disagrees_with_legacy" | "typed_lookup_error";
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

/**
 * The effective unit at (`sourceContext`, `position`) and where it came from.
 * A typed answer is used only when `fallback` agrees; otherwise the fallback's
 * unit, with the reason. Never throws because of the typed layer.
 */
export const resolveCourseUnitWithReason = (
  prepass: CourseDecisionPrepass,
  blockId: string,
  sourceContext: string,
  position: number,
  fallback: CourseUnitResolver = legacyCourseUnitResolver,
): CourseUnitResolution => {
  let lookup: TypedCourseLookup | undefined;
  try {
    lookup = lookupTypedCourseUnit(prepass, blockId, sourceContext, position);
  } catch {
    lookup = undefined;
  }
  const legacy = fallback(sourceContext, position);
  if (lookup === undefined) return { unit: legacy, source: "fallback", reason: "typed_lookup_error" };
  if (lookup.kind === "fallback") return { unit: legacy, source: "fallback", reason: lookup.reason };
  if (lookup.unit !== legacy) {
    return { unit: legacy, source: "fallback", reason: "typed_disagrees_with_legacy", typedUnit: lookup.unit };
  }
  return { unit: lookup.unit, source: "typed", typedUnit: lookup.unit };
};

/**
 * A `CourseUnitResolver` for one request block, backed by the pre-pass and
 * gated by `fallback`: its answer always equals `fallback`'s, and it is typed
 * only where the two agree.
 */
export const courseUnitResolverForBlock = (
  prepass: CourseDecisionPrepass,
  blockId: string,
  fallback: CourseUnitResolver = legacyCourseUnitResolver,
): CourseUnitResolver => (sourceContext, position) =>
  resolveCourseUnitWithReason(prepass, blockId, sourceContext, position, fallback).unit;
