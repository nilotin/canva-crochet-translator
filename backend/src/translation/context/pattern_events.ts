/**
 * Typed pattern events (Stage 2, Task 5; in production since next-stage Task 8
 * only through the course-decision pre-pass, `./course_decisions.ts`).
 *
 * The only input to PatternContext. Each event is a normalized view of a
 * typed-path decision that already exists; nothing here reads Turkish text
 * beyond exact token comparisons:
 *
 *  - `instruction`      a leading instruction marker, from `number_paren`
 *                       (`12)`, `2-25)`) or `number_dot` (`12.`, first === last);
 *  - `course_end_turn`  the `course_end_turn` frame (its `scope` only);
 *  - `course_count`     the `course_count` frame;
 *  - `course_reset`     a line-structure boundary (Task 9, `courseResetEventsOf`):
 *                       a blank line, or a line with the yarn cut
 *                       `ipimizi kesiyoruz`.
 *
 * Everything else (Opaque nodes, other frames, `row_round_label` and
 * `ordinal_or_ordinary` decisions) produces no event, so it can never change
 * the context. `line` is a lexical fact: the number of lexer `line_break`
 * tokens before the event, within the given source. `numberedLine` says
 * whether a leading `N)` / `A-B)` instruction marker is on the same lexical
 * line: production's numbered-line rule, where `N.` does not count.
 *
 * `patternEventsOf` gives the marker and frame events; `contextEventsOf` merges
 * in the reset events, in source order, and is what PatternContext folds.
 *
 * Import rules: the lexer, the parser IR and parser-space classifiers only. No
 * translator, normalizer, validator, provider or corpus code.
 */
import { lexSource, type LexToken } from "../lexer/typed_lexer.js";
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
  /** A leading `N)` / `A-B)` marker is on the same line. */
  readonly numberedLine: boolean;
};

export type CourseCountEvent = {
  readonly type: "course_count";
  readonly courses: number;
  readonly count: number;
  readonly stitch: StitchConcept;
  readonly span: SourceSpan;
  readonly line: number;
  /** A leading `N)` / `A-B)` marker is on the same line. */
  readonly numberedLine: boolean;
};

/**
 * A boundary that ends the current construction, mirroring production's
 * numbered-instruction inference, which stops looking back at a blank line
 * and at any line containing the yarn cut `ipimizi kesiyoruz`:
 *
 *  - `blank_line`  a lexical line with only whitespace (or nothing); `span` is
 *                  that line;
 *  - `yarn_cut`    the words `ipimizi kesiyoruz` (`trigger`); the reset takes
 *                  effect at the END of their line (`span`, zero width), so it
 *                  voids everything on that line and before it, but not a
 *                  course_count on the same line;
 *  - `attached_marker`  a line-leading `N)` glued to its text (`trigger`),
 *                  which production counts as a numbered line but the typed
 *                  path does not; also at the end of its line.
 */
export type CourseResetEvent = {
  readonly type: "course_reset";
  readonly reason: "blank_line" | "yarn_cut" | "attached_marker";
  readonly span: SourceSpan;
  readonly trigger: SourceSpan;
  readonly line: number;
};

/** The marker and frame events: `patternEventsOf`'s output. */
export type DecisionEvent = InstructionEvent | CourseEndTurnEvent | CourseCountEvent;

export type PatternEvent = DecisionEvent | CourseResetEvent;

export class PatternEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatternEventError";
  }
}

/** An event before its line facts are known. */
type Unplaced<Event> = Event extends DecisionEvent ? Omit<Event, "line" | "numberedLine"> : never;

/**
 * Start offsets of the lexical lines of `tokens`: 0, then each line_break's
 * end. Line `n` spans lineStarts[n] up to the next line break (or the end).
 */
const lineBreakStartsOf = (tokens: readonly LexToken[]): number[] =>
  tokens.filter(({ kind }) => kind === "line_break").map(({ start }) => start);

const lineOfOffset = (lineBreakStarts: readonly number[], offset: number): number =>
  lineBreakStarts.filter((start) => start < offset).length;

/**
 * Every typed pattern event in `source`, in source order. Deterministic.
 * Throws `PatternEventError` if two events overlap, which would mean two typed
 * owners claimed the same text.
 */
export const patternEventsOf = (source: string): readonly DecisionEvent[] => {
  const tokens = lexSource(source);
  const unplaced: Unplaced<DecisionEvent>[] = [];
  const lineBreakStarts = lineBreakStartsOf(tokens);
  const numberedLines = new Set<number>();

  for (const decision of classifyNumberParens(source)) {
    if (decision.kind !== "instruction_marker") continue;
    numberedLines.add(lineOfOffset(lineBreakStarts, decision.span.start));
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

  return sorted.map((event): DecisionEvent => {
    const line = lineOfOffset(lineBreakStarts, event.span.start);
    return event.type === "course_end_turn" || event.type === "course_count"
      ? { ...event, line, numberedLine: numberedLines.has(line) }
      : { ...event, line };
  });
};

/**
 * Production's yarn-cut test is `/\bipimizi\s+kesiyoruz\b/iu` on one line.
 * Its words compare with JavaScript's simple case folding: ASCII letters
 * fold, as do U+212A KELVIN SIGN (to k) and U+017F LONG S (to s); U+0130 (İ)
 * does not. Its `\b` is an ASCII word boundary, where those two folding
 * characters also count as word characters.
 */
const foldsTo = (raw: string, word: string): boolean =>
  raw.length === word.length &&
  [...raw].every((character, index) => {
    const folded = character === "\u017f" ? "s" : character.toLowerCase();
    return folded === word[index];
  });

const isBoundaryWordCharacter = (character: string | undefined): boolean => {
  if (character === undefined || character.length !== 1) return false;
  const code = character.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    code === 0x017f ||
    code === 0x212a
  );
};

const YARN_CUT = ["ipimizi", "kesiyoruz"] as const;

/**
 * The course-reset events of `source`, in source order:
 *
 *  - `blank_line`      one per blank lexical line;
 *  - `yarn_cut`        one per yarn cut, placed at the end of its line: a word
 *                      token ending in `ipimizi`, one whitespace token, and a
 *                      word token starting with `kesiyoruz`, with production's
 *                      word boundaries on both outer sides;
 *  - `attached_marker` one per line-leading `N)` glued to the next text
 *                      (`number_paren` reason `attached-right`), placed at the
 *                      end of its line. Production counts such a line as a
 *                      numbered instruction; the typed path does not, so it
 *                      cannot prove continuity across it and resets instead.
 *
 * Deterministic, never throws.
 */
export const courseResetEventsOf = (source: string): readonly CourseResetEvent[] => {
  const tokens = lexSource(source);
  const lineBreakStarts = lineBreakStartsOf(tokens);
  const lineEnds = [...lineBreakStarts, source.length];
  const lineStarts = [0, ...tokens.filter(({ kind }) => kind === "line_break").map(({ end }) => end)];
  const spanOf = (start: number, end: number): SourceSpan => ({ start, end, raw: source.slice(start, end) });
  const events: CourseResetEvent[] = [];

  lineStarts.forEach((start, line) => {
    const end = lineEnds[line]!;
    const content = tokens.filter((token) => token.start >= start && token.end <= end);
    if (content.every(({ kind }) => kind === "whitespace")) {
      events.push({ type: "course_reset", reason: "blank_line", span: spanOf(start, end), trigger: spanOf(start, end), line });
    }
  });

  const atLineEnd = (reason: "yarn_cut" | "attached_marker", trigger: SourceSpan): void => {
    const line = lineOfOffset(lineBreakStarts, trigger.start);
    const end = lineEnds[line]!;
    events.push({ type: "course_reset", reason, span: spanOf(end, end), trigger, line });
  };

  tokens.forEach((token, index) => {
    const space = tokens[index + 1];
    const next = tokens[index + 2];
    if (token.kind !== "word" || space?.kind !== "whitespace" || next?.kind !== "word") return;
    const [first, second] = YARN_CUT;
    const firstStart = token.end - first.length;
    const secondEnd = next.start + second.length;
    if (firstStart < token.start || secondEnd > next.end) return;
    if (!foldsTo(source.slice(firstStart, token.end), first) || !foldsTo(source.slice(next.start, secondEnd), second)) return;
    if (isBoundaryWordCharacter(source[firstStart - 1]) || isBoundaryWordCharacter(source[secondEnd])) return;
    atLineEnd("yarn_cut", spanOf(firstStart, secondEnd));
  });

  for (const decision of classifyNumberParens(source)) {
    if (decision.kind === "ordinary" && decision.reason === "attached-right") atLineEnd("attached_marker", decision.span);
  }

  return [...events].sort((left, right) => left.span.start - right.span.start);
};

/**
 * Every event PatternContext folds: `patternEventsOf` plus `courseResetEventsOf`,
 * in source order (a reset at the same offset as another event comes after it).
 */
export const contextEventsOf = (source: string): readonly PatternEvent[] =>
  [...patternEventsOf(source), ...courseResetEventsOf(source)].sort(
    (left, right) => left.span.start - right.span.start,
  );
