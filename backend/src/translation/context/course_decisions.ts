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
 * Line model guard (Task 9): the typed lexer also breaks lines at U+2028 and
 * U+2029, which production's numbered-line inference does not, so the two
 * would disagree about which markers lead a line. A block containing either
 * separator gets only unknown decisions.
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
  initialPatternContext,
  readCourseKind,
  type CourseKind,
} from "./pattern_context.js";
import { contextEventsOf } from "./pattern_events.js";

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
/** Line breaks production's inference also treats as line breaks. */
const SHARED_LINE_BREAKS: ReadonlySet<string> = new Set(["\n", "\r", "\r\n"]);

const analyzeBlock = (block: CourseDecisionBlock): BlockCourseAnalysis => {
  const lineBreaks = lexSource(block.text).filter(({ kind }) => kind === "line_break");
  const lineStarts = [0, ...lineBreaks.map(({ end }) => end)];
  const sharedLineModel = lineBreaks.every(({ raw }) => SHARED_LINE_BREAKS.has(raw));
  const decisions: CourseDecision[] = [];
  let context = initialPatternContext;
  for (const event of contextEventsOf(block.text)) {
    if (event.type === "course_count") {
      // Block index 0: each block is its own single-block fold.
      const courseKind = sharedLineModel ? readCourseKind(context, event, 0) : "unknown";
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


export type CourseDecisionScope = "same_block" | "cross_block";

export type CrossBlockCourseDecision = CourseDecision & {
  readonly scope: CourseDecisionScope;
};

export type CrossBlockBlockCourseAnalysis = Omit<BlockCourseAnalysis, "decisions"> & {
  readonly decisions: readonly CrossBlockCourseDecision[];
};

export type CrossBlockCourseDecisionPrepass =
  | {
      readonly status: "enabled";
      readonly blocks: ReadonlyMap<string, CrossBlockBlockCourseAnalysis>;
      readonly decisions: ReadonlyMap<string, readonly CrossBlockCourseDecision[]>;
      /** Block texts in trusted reading order, separated by exactly one LF. */
      readonly joinedText: string;
      /** Start offset of each exact block text inside `joinedText`. */
      readonly blockStarts: ReadonlyMap<string, number>;
    }
  | {
      readonly status: "disabled";
      readonly reason:
        | "missing_block_id"
        | "duplicate_block_id"
        | "invalid_reading_order"
        | "prepass_error";
      readonly blocks: ReadonlyMap<string, CrossBlockBlockCourseAnalysis>;
      readonly decisions: ReadonlyMap<string, readonly CrossBlockCourseDecision[]>;
    };

const disabledCrossBlock = (
  reason:
    | "missing_block_id"
    | "duplicate_block_id"
    | "invalid_reading_order"
    | "prepass_error",
): CrossBlockCourseDecisionPrepass =>
  Object.freeze({
    status: "disabled",
    reason,
    blocks: new Map(),
    decisions: new Map(),
  });

/**
 * Cross-block course decisions for one already-validated page reading order.
 *
 * This is additive to `prepareCourseDecisions`: the existing same-block
 * pre-pass remains unchanged and remains the first authority in production.
 * The caller supplies the trusted order; this function never sorts request
 * blocks and never mutates its inputs.
 */
export const prepareCrossBlockCourseDecisions = (
  blocks: readonly CourseDecisionBlock[],
  orderedIds: readonly string[],
): CrossBlockCourseDecisionPrepass => {
  try {
    if (blocks.length < 2 || orderedIds.length !== blocks.length) {
      return disabledCrossBlock("invalid_reading_order");
    }

    const byId = new Map<string, CourseDecisionBlock>();
    for (const block of blocks) {
      if (typeof block.id !== "string" || block.id.length === 0) {
        return disabledCrossBlock("missing_block_id");
      }
      if (byId.has(block.id)) {
        return disabledCrossBlock("duplicate_block_id");
      }
      byId.set(block.id, block);
    }

    const orderedBlocks: CourseDecisionBlock[] = [];
    const orderedSeen = new Set<string>();
    for (const id of orderedIds) {
      if (orderedSeen.has(id)) return disabledCrossBlock("invalid_reading_order");
      const block = byId.get(id);
      if (block === undefined) return disabledCrossBlock("invalid_reading_order");
      orderedSeen.add(id);
      orderedBlocks.push(block);
    }

    if (orderedSeen.size !== blocks.length) {
      return disabledCrossBlock("invalid_reading_order");
    }

    const joinedParts: string[] = [];
    const blockStarts = new Map<string, number>();
    let joinedOffset = 0;

    orderedBlocks.forEach((block, index) => {
      blockStarts.set(block.id, joinedOffset);
      joinedParts.push(block.text);
      joinedOffset += block.text.length;
      if (index + 1 < orderedBlocks.length) joinedOffset += 1;
    });

    const analyses = new Map<string, CrossBlockBlockCourseAnalysis>();
    const decisions = new Map<string, readonly CrossBlockCourseDecision[]>();
    let context = initialPatternContext;

    orderedBlocks.forEach((block, blockIndex) => {
      const lineBreaks = lexSource(block.text).filter(({ kind }) => kind === "line_break");
      const lineStarts = [0, ...lineBreaks.map(({ end }) => end)];
      const sharedLineModel = lineBreaks.every(({ raw }) => SHARED_LINE_BREAKS.has(raw));

      if (!sharedLineModel) {
        // Typed and legacy line models disagree in this block. Break context on
        // both sides and retain only unknown decisions for this block.
        context = initialPatternContext;
        const isolated = analyzeBlock(block);
        const scoped = isolated.decisions.map(
          (decision): CrossBlockCourseDecision =>
            Object.freeze({ ...decision, courseKind: "unknown", evidence: undefined, scope: "same_block" }),
        );

        const analysis: CrossBlockBlockCourseAnalysis = Object.freeze({
          blockId: block.id,
          text: block.text,
          lineStarts: Object.freeze(lineStarts),
          decisions: Object.freeze(scoped),
        });

        analyses.set(block.id, analysis);
        decisions.set(block.id, analysis.decisions);
        context = initialPatternContext;
        return;
      }

      const blockDecisions: CrossBlockCourseDecision[] = [];

      for (const event of contextEventsOf(block.text)) {
        if (event.type === "course_count") {
          const courseKind = readCourseKind(context, event, blockIndex);
          const evidence = courseKind === "unknown" ? undefined : context.evidence;

          let evidenceValue: CourseDecision["evidence"] | undefined;
          let scope: CourseDecisionScope = "same_block";

          if (evidence !== undefined) {
            const evidenceBlock = orderedBlocks[evidence.blockIndex];
            if (evidenceBlock !== undefined) {
              evidenceValue = Object.freeze({
                blockId: evidenceBlock.id,
                sourceSpan: evidence.span,
              });
              if (evidence.blockIndex !== blockIndex) scope = "cross_block";
            }
          }

          blockDecisions.push(
            Object.freeze({
              blockId: block.id,
              lineIndex: event.line,
              sourceSpan: event.span,
              courseKind,
              ...(evidenceValue === undefined ? {} : { evidence: evidenceValue }),
              scope,
            }),
          );
        }

        context = applyPatternEvent(context, event, blockIndex);
      }

      const analysis: CrossBlockBlockCourseAnalysis = Object.freeze({
        blockId: block.id,
        text: block.text,
        lineStarts: Object.freeze(lineStarts),
        decisions: Object.freeze(blockDecisions),
      });

      analyses.set(block.id, analysis);
      decisions.set(block.id, analysis.decisions);
    });

    return Object.freeze({
      status: "enabled",
      blocks: analyses,
      decisions,
      joinedText: joinedParts.join("\n"),
      blockStarts,
    });
  } catch {
    return disabledCrossBlock("prepass_error");
  }
};


/**
 * The lexical line of `position` in the analyzed block text: the number of
 * line breaks that end at or before it, so an offset on a line break belongs
 * to the line the break ends. Undefined outside 0..text.length, and between
 * the two halves of a CRLF, which production's line split puts in no line.
 */
export const lineIndexAt = (analysis: BlockCourseAnalysis, position: number): number | undefined => {
  if (!Number.isSafeInteger(position) || position < 0 || position > analysis.text.length) {
    return undefined;
  }
  if (analysis.text[position - 1] === "\r" && analysis.text[position] === "\n") return undefined;
  let line = 0;
  while (line + 1 < analysis.lineStarts.length && analysis.lineStarts[line + 1]! <= position) {
    line += 1;
  }
  return line;
};
