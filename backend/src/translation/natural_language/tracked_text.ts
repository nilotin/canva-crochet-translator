/**
 * Text being normalized together with the exact ranges of the deterministic
 * renderings it contains.
 *
 * A rule marks its rendering with `mark(rendered)` inside its replacement.
 * `replace` strips the marks from that one replacement immediately and turns
 * them into ranges in the output, so a range is known at the moment the
 * rendering is written and is never searched for later. Every later `replace`
 * shifts the ranges by the length change of the edits before them; an edit
 * that touches a range breaks the result, and a broken result exposes no
 * ranges at all (fail closed). The text itself is always exactly what plain
 * `String.prototype.replace` would produce.
 */

/** An exact range of normalized text that a deterministic renderer produced. */
export type DeterministicSpan = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

// Private-use code points that only ever live inside one replacement string.
const OPEN = "";
const CLOSE = "";
const MARKS = /[]/u;

// Mirrors the replacer type of `String.prototype.replace`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Replacer = (substring: string, ...args: any[]) => string;

type Edit = {
  readonly start: number;
  readonly end: number;
  readonly inserted: string;
  readonly spans: readonly DeterministicSpan[];
};

/** `$`-patterns of a string replacement, as `String.prototype.replace` expands them. */
const expandReplacement = (
  replacement: string,
  match: string,
  groups: readonly (string | undefined)[],
  offset: number,
  input: string,
  named: Record<string, string | undefined> | undefined,
): string =>
  replacement.replace(/\$(\$|&|`|'|\d{1,2}|<([^>]*)>)/gu, (token, kind: string, name?: string) => {
    if (kind === "$") return "$";
    if (kind === "&") return match;
    if (kind === "`") return input.slice(0, offset);
    if (kind === "'") return input.slice(offset + match.length);
    if (name !== undefined) return named === undefined ? token : (named[name] ?? "");
    const twoDigits = Number(kind);
    if (kind.length === 2 && twoDigits >= 1 && twoDigits <= groups.length) return groups[twoDigits - 1] ?? "";
    const oneDigit = Number(kind[0]);
    if (oneDigit >= 1 && oneDigit <= groups.length) return (groups[oneDigit - 1] ?? "") + kind.slice(1);
    return token;
  });

/** Removes the marks from one replacement and returns their ranges in it. */
const unmark = (raw: string): { text: string; spans: DeterministicSpan[]; valid: boolean } => {
  if (!MARKS.test(raw)) return { text: raw, spans: [], valid: true };
  let text = "";
  let open: number | undefined;
  let valid = true;
  const spans: DeterministicSpan[] = [];
  for (const character of raw) {
    if (character === OPEN) {
      if (open !== undefined) valid = false;
      open = text.length;
    } else if (character === CLOSE) {
      if (open === undefined) valid = false;
      else spans.push({ start: open, end: text.length, text: text.slice(open) });
      open = undefined;
    } else {
      text += character;
    }
  }
  return { text, spans, valid: valid && open === undefined };
};

export class TrackedText {
  private constructor(
    readonly text: string,
    private readonly ranges: readonly DeterministicSpan[],
    private readonly broken: boolean,
    private readonly recording: boolean,
  ) {}

  /**
   * Starts tracking `text`. Recording is off (marks become plain text) when
   * not requested or when the text already holds a mark code point, so the
   * output is never changed by tracking.
   */
  static of(text: string, record: boolean): TrackedText {
    return new TrackedText(text, [], false, record && !MARKS.test(text));
  }

  /** Wraps a rendering so the enclosing `replace` records its exact range. */
  mark(rendered: string): string {
    return this.recording ? `${OPEN}${rendered}${CLOSE}` : rendered;
  }

  replace(pattern: RegExp, replacement: string | Replacer): TrackedText {
    const edits: Edit[] = [];
    let broken = this.broken;
    const input = this.text;
    const text = input.replace(pattern, (...args: unknown[]) => {
      const match = args[0] as string;
      const hasNamed = typeof args[args.length - 1] === "object" && args[args.length - 1] !== null;
      const named = hasNamed ? (args[args.length - 1] as Record<string, string | undefined>) : undefined;
      const offset = args[args.length - (hasNamed ? 3 : 2)] as number;
      const groups = args.slice(1, args.length - (hasNamed ? 3 : 2)) as (string | undefined)[];
      const raw =
        typeof replacement === "function"
          ? replacement(...(args as [string, ...unknown[]]))
          : expandReplacement(replacement, match, groups, offset, input, named);
      const unmarked = unmark(raw);
      if (!unmarked.valid) broken = true;
      edits.push({ start: offset, end: offset + match.length, inserted: unmarked.text, spans: unmarked.spans });
      return unmarked.text;
    });
    if (edits.length === 0) return this;

    const ranges: DeterministicSpan[] = [];
    // Existing ranges move by the length change of the edits before them.
    for (const range of this.ranges) {
      let shift = 0;
      for (const edit of edits) {
        const touches =
          edit.start === edit.end
            ? edit.start > range.start && edit.start < range.end
            : edit.start < range.end && edit.end > range.start;
        if (touches) broken = true;
        // An insertion exactly at the range start lands before it.
        if (edit.end <= range.start) shift += edit.inserted.length - (edit.end - edit.start);
      }
      ranges.push({ start: range.start + shift, end: range.end + shift, text: range.text });
    }
    // New ranges are placed where their edit lands in the output.
    let shift = 0;
    for (const edit of edits) {
      const outputStart = edit.start + shift;
      for (const span of edit.spans) {
        ranges.push({ start: outputStart + span.start, end: outputStart + span.end, text: span.text });
      }
      shift += edit.inserted.length - (edit.end - edit.start);
    }
    return new TrackedText(text, ranges, broken, this.recording);
  }

  /**
   * The recorded ranges, in source order, when every invariant holds; empty
   * otherwise (fail closed): no edit touched a range, ranges are in bounds,
   * non-empty, non-overlapping, and each one's text matches the output.
   */
  spans(): DeterministicSpan[] {
    if (this.broken) return [];
    const ordered = [...this.ranges].sort((left, right) => left.start - right.start);
    let previousEnd = 0;
    for (const span of ordered) {
      if (
        span.start < previousEnd ||
        span.end <= span.start ||
        span.end > this.text.length ||
        this.text.slice(span.start, span.end) !== span.text
      )
        return [];
      previousEnd = span.end;
    }
    return ordered;
  }
}
