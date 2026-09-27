/**
 * Typed pattern events (Stage 2, Task 5: SHADOW ONLY).
 *
 * The only input to PatternContext. Each event is a normalized view of a
 * typed-path decision that already exists; nothing here reads Turkish text:
 *
 *  - `instruction`      a leading instruction marker, from `number_paren`
 *                       (`12)`, `2-25)`) or `number_dot` (`12.`, first === last);
 *  - `course_end_turn`  the `course_end_turn` frame (its `scope` only);
 *  - `course_count`     the `course_count` frame.
 *
 * Everything else (Opaque nodes, other frames, `row_round_label` and
 * `ordinal_or_ordinary` decisions) produces no event, so it can never change
 * the context. `line` is a lexical fact: the number of lexer `line_break`
 * tokens before the event, within the given source.
 *
 * Import rules: the lexer, the parser IR and parser-space classifiers only. No
 * translator, normalizer, validator, provider or corpus code.
 */
import { lexSource } from "../lexer/typed_lexer.js";
import type { CourseEndScope, SourceSpan, StitchConcept } from "../parser/frame_ir.js";
import { parseFrames } from "../parser/frame_parser.js";
import { classifyNumberDots } from "../parser/number_dot.js";
import { classifyNumberParens } from "../parser/number_paren.js";

export type InstructionEvent = {
  readonly type: "instruction";
  readonly first: number;
  readonly last: number;
  readonly span: SourceSpan;
  readonly line: number;
};

export type CourseEndTurnEvent = {
  readonly type: "course_end_turn";
  readonly scope: CourseEndScope;
  readonly span: SourceSpan;
  readonly line: number;
};

export type CourseCountEvent = {
  readonly type: "course_count";
  readonly courses: number;
  readonly count: number;
  readonly stitch: StitchConcept;
  readonly span: SourceSpan;
  readonly line: number;
};

export type PatternEvent = InstructionEvent | CourseEndTurnEvent | CourseCountEvent;

export class PatternEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatternEventError";
  }
}

/** An event before its line number is known. */
type Unplaced<Event> = Event extends PatternEvent ? Omit<Event, "line"> : never;

/**
 * Every typed pattern event in `source`, in source order. Deterministic.
 * Throws `PatternEventError` if two events overlap, which would mean two typed
 * owners claimed the same text.
 */
export const patternEventsOf = (source: string): readonly PatternEvent[] => {
  const tokens = lexSource(source);
  const unplaced: Unplaced<PatternEvent>[] = [];

  for (const decision of classifyNumberParens(source)) {
    if (decision.kind !== "instruction_marker") continue;
    unplaced.push({ type: "instruction", first: decision.first, last: decision.last, span: decision.span });
  }
  for (const decision of classifyNumberDots(source)) {
    if (decision.kind !== "instruction_marker") continue;
    // The decision's number token (digits only); an unsafe integer gives no event.
    const value = Number(tokens[decision.index]?.raw);
    if (!Number.isSafeInteger(value)) continue;
    unplaced.push({ type: "instruction", first: value, last: value, span: decision.span });
  }
  for (const node of parseFrames(source).nodes) {
    if (node.kind !== "frame") continue;
    if (node.action === "course_end_turn") {
      unplaced.push({ type: "course_end_turn", scope: node.slots.scope.value, span: node.span });
    } else if (node.action === "course_count") {
      unplaced.push({
        type: "course_count",
        courses: node.slots.courses.value,
        count: node.slots.count.value,
        stitch: node.slots.stitch.concept,
        span: node.span,
      });
    }
  }

  const sorted = [...unplaced].sort((left, right) => left.span.start - right.span.start);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    if (current.span.start < previous.span.end) {
      throw new PatternEventError(
        `Pattern events overlap: ${previous.type} ${previous.span.start}..${previous.span.end} ` +
          `and ${current.type} ${current.span.start}..${current.span.end}.`,
      );
    }
  }

  const lineBreakStarts = tokens.filter(({ kind }) => kind === "line_break").map(({ start }) => start);
  const lineOf = (offset: number): number => lineBreakStarts.filter((start) => start < offset).length;
  return sorted.map((event): PatternEvent => ({ ...event, line: lineOf(event.span.start) }));
};
