/**
 * Course decisions (next stage, Task 8): a pure, same-block pre-pass.
 *
 * For each request block, PatternContext starts empty, folds the block's own
 * typed events and is then discarded, so nothing carries from one block to
 * the next. Every parsed `course_count` frame gets one immutable decision: its
 * block, its lexical line, its exact source span and the course kind
 * PatternContext reads there (row / round / unknown), plus the evidence span
 * when the kind is known. `unknown` is kept as is; it never means round.
 *
 * The block's lexical line starts are kept with its decisions so a consumer
 * can map an offset in the block's exact text to a line without re-lexing or
 * guessing. Nothing here decides a unit for anything that is not a parsed
 * course_count, and nothing here consults the legacy regex inference.
 *
 * Failure policy: the pre-pass never throws. Missing or duplicate block ids,
 * or any error while analyzing, give a disabled result with no decisions, so
 * every consumer falls back entirely.
 *
 * Import rules: the lexer, parser IR types and PatternContext only. No
 * translator, normalizer, validator, provider or corpus code.
 */
import { lexSource } from "../lexer/typed_lexer.js";
import type { SourceSpan } from "../parser/frame_ir.js";
import {
  applyPatternEvent,
  courseKindAt,
  initialPatternContext,
  type CourseKind,
} from "./pattern_context.js";
import { patternEventsOf } from "./pattern_events.js";

export type CourseDecision = {
  readonly blockId: string;
  /** Lexer `line_break` tokens before the frame, within the block. */
  readonly lineIndex: number;
  readonly sourceSpan: SourceSpan;
  readonly courseKind: CourseKind;
  /** The course_end_turn that established the kind; absent for unknown. */
  readonly evidence?: {
    readonly blockId: string;
    readonly sourceSpan: SourceSpan;
  };
};

export type BlockCourseDecisions = ReadonlyMap<string, readonly CourseDecision[]>;

export type BlockCourseAnalysis = {
  readonly blockId: string;
  /** The exact block text the decisions and line starts refer to. */
  readonly text: string;
  /** Start offset of every lexical line: 0, then each line_break token's end. */
  readonly lineStarts: readonly number[];
  readonly decisions: readonly CourseDecision[];
};

export type CourseDecisionPrepass =
  | {
      readonly status: "enabled";
      readonly blocks: ReadonlyMap<string, BlockCourseAnalysis>;
      readonly decisions: BlockCourseDecisions;
    }
  | {
      readonly status: "disabled";
      readonly reason: "missing_block_id" | "duplicate_block_id" | "prepass_error";
      readonly blocks: ReadonlyMap<string, BlockCourseAnalysis>;
      readonly decisions: BlockCourseDecisions;
    };

export type CourseDecisionBlock = { readonly id: string; readonly text: string };

const disabled = (
  reason: "missing_block_id" | "duplicate_block_id" | "prepass_error",
): CourseDecisionPrepass =>
  Object.freeze({ status: "disabled", reason, blocks: new Map(), decisions: new Map() });

/** One block, analyzed on its own: a fresh PatternContext, discarded afterwards. */
const analyzeBlock = (block: CourseDecisionBlock): BlockCourseAnalysis => {
  const lineStarts = [
    0,
    ...lexSource(block.text)
      .filter(({ kind }) => kind === "line_break")
      .map(({ end }) => end),
  ];
  const decisions: CourseDecision[] = [];
  let context = initialPatternContext;
  for (const event of patternEventsOf(block.text)) {
    if (event.type === "course_count") {
      // Block index 0: each block is its own single-block fold.
      const courseKind = courseKindAt(context, 0, event.line);
      const evidence = courseKind === "unknown" ? undefined : context.evidence;
      decisions.push(
        Object.freeze({
          blockId: block.id,
          lineIndex: event.line,
          sourceSpan: event.span,
          courseKind,
          ...(evidence === undefined
            ? {}
            : { evidence: Object.freeze({ blockId: block.id, sourceSpan: evidence.span }) }),
        }),
      );
    }
    context = applyPatternEvent(context, event, 0);
  }
  return Object.freeze({
    blockId: block.id,
    text: block.text,
    lineStarts: Object.freeze(lineStarts),
    decisions: Object.freeze(decisions),
  });
};

/**
 * Same-block course decisions for one request. Pure and deterministic: reads
 * `blocks` only, mutates nothing and never throws.
 */
export const prepareCourseDecisions = (
  blocks: readonly CourseDecisionBlock[],
): CourseDecisionPrepass => {
  try {
    const ids = new Set<string>();
    for (const { id } of blocks) {
      if (typeof id !== "string" || id.length === 0) return disabled("missing_block_id");
      if (ids.has(id)) return disabled("duplicate_block_id");
      ids.add(id);
    }
    const analyses = new Map<string, BlockCourseAnalysis>();
    const decisions = new Map<string, readonly CourseDecision[]>();
    for (const block of blocks) {
      const analysis = analyzeBlock(block);
      analyses.set(block.id, analysis);
      decisions.set(block.id, analysis.decisions);
    }
    return Object.freeze({ status: "enabled", blocks: analyses, decisions });
  } catch {
    return disabled("prepass_error");
  }
};

/**
 * The lexical line of `position` in the analyzed block text: the number of
 * line breaks that end at or before it, so an offset on a line break belongs
 * to the line the break ends. Undefined outside 0..text.length.
 */
export const lineIndexAt = (analysis: BlockCourseAnalysis, position: number): number | undefined => {
  if (!Number.isSafeInteger(position) || position < 0 || position > analysis.text.length) {
    return undefined;
  }
  let line = 0;
  while (line + 1 < analysis.lineStarts.length && analysis.lineStarts[line + 1]! <= position) {
    line += 1;
  }
  return line;
};
