/**
 * PatternContext (Stage 2, Task 5: SHADOW ONLY).
 *
 * Cross-block course state for one translation request, carried by a pure,
 * immutable reducer over typed `PatternEvent`s. It owns exactly one semantic
 * fact, the course kind (row / round / unknown), plus the instruction
 * continuity that makes carrying it safe. The parser and classifiers never
 * see it; a later renderer only reads it.
 *
 * Rules (mirroring production's pinned numbered-instruction inference in
 * `bare_round_count.ts`, but from typed events only):
 *
 *  - instruction: continuous iff a previous instruction exists, first > 1
 *    and first === previous.last + 1. Otherwise the course kind resets to
 *    unknown and its evidence is dropped. The marker always becomes
 *    `lastInstruction`. Ranges are taken literally (no ordering or length
 *    checks), so `0)`, `1)` and `1.` always reset.
 *  - course_end_turn: `COURSE_END_POLICY` (Policy B). `every` establishes
 *    row; `plural` and `single` change nothing.
 *  - course_count: read only, through `courseKindAt`.
 *
 * `unknown` never means round. Round is not set by any first-slice event; it
 * is part of the type so a later explicit-round event can use it.
 *
 * No module-level mutable state. Block order is the caller's: this module
 * does not decide reading order.
 *
 * Import rules: `./pattern_events.js` and parser IR types only. No
 * translator, normalizer, validator, provider or corpus code.
 */
import type { CourseEndScope, SourceSpan } from "../parser/frame_ir.js";
import { patternEventsOf, type CourseCountEvent, type PatternEvent } from "./pattern_events.js";

export type CourseKind = "row" | "round" | "unknown";

export type PatternContext = {
  readonly courseKind: CourseKind;
  readonly lastInstruction?: {
    readonly first: number;
    readonly last: number;
    readonly blockIndex: number;
    readonly line: number;
  };
  readonly evidence?: {
    readonly blockIndex: number;
    readonly span: SourceSpan;
    readonly scope: CourseEndScope;
  };
};

export const initialPatternContext: PatternContext = Object.freeze({ courseKind: "unknown" });

/**
 * What each course-end scope establishes. `undefined` means no change: the
 * course kind and its evidence stay as they were. Policy B: only the explicit
 * "bütün sıra sonlarında ... dönüyoruz" (every) is row evidence; plural and
 * single are ambiguous (turned rounds exist) and are deferred.
 */
export const COURSE_END_POLICY: Readonly<Record<CourseEndScope, "row" | undefined>> = Object.freeze({
  every: "row",
  plural: undefined,
  single: undefined,
});

/** The next context after one event in block `blockIndex`. Pure: never mutates its inputs. */
export const applyPatternEvent = (
  context: PatternContext,
  event: PatternEvent,
  blockIndex: number,
): PatternContext => {
  switch (event.type) {
    case "instruction": {
      const previous = context.lastInstruction;
      const continuous =
        previous !== undefined && event.first > 1 && event.first === previous.last + 1;
      const lastInstruction = { first: event.first, last: event.last, blockIndex, line: event.line };
      return continuous
        ? { ...context, lastInstruction }
        : { courseKind: "unknown", lastInstruction };
    }
    case "course_end_turn": {
      const established = COURSE_END_POLICY[event.scope];
      if (established === undefined) return context;
      return {
        ...context,
        courseKind: established,
        evidence: { blockIndex, span: event.span, scope: event.scope },
      };
    }
    case "course_count":
      return context;
  }
};

/**
 * The course kind a consumer at (`blockIndex`, `line`) may use: the context's
 * course kind only when the latest instruction marker is on that same block
 * and line, since only numbered instructions inherit. Otherwise `unknown`,
 * never round.
 */
export const courseKindAt = (context: PatternContext, blockIndex: number, line: number): CourseKind =>
  context.lastInstruction !== undefined &&
  context.lastInstruction.blockIndex === blockIndex &&
  context.lastInstruction.line === line
    ? context.courseKind
    : "unknown";

export type CourseCountRead = {
  readonly event: CourseCountEvent;
  readonly courseKind: CourseKind;
};

export type BlockTrace = {
  readonly blockIndex: number;
  readonly events: readonly PatternEvent[];
  readonly before: PatternContext;
  readonly after: PatternContext;
  readonly reads: readonly CourseCountRead[];
};

/**
 * Folds the context over `blocks` in the given order (the caller's order is
 * authoritative), starting from `initial`. For each block: its events, the
 * context before and after, and what each course_count read. Pure.
 */
export const foldPatternContext = (
  blocks: readonly string[],
  initial: PatternContext = initialPatternContext,
): readonly BlockTrace[] => {
  const traces: BlockTrace[] = [];
  let context = initial;
  blocks.forEach((block, blockIndex) => {
    const events = patternEventsOf(block);
    const before = context;
    const reads: CourseCountRead[] = [];
    for (const event of events) {
      if (event.type === "course_count") {
        reads.push({ event, courseKind: courseKindAt(context, blockIndex, event.line) });
      }
      context = applyPatternEvent(context, event, blockIndex);
    }
    traces.push({ blockIndex, events, before, after: context, reads });
  });
  return traces;
};
