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
// One pair per kind of range: deterministic renderings and exact source data.
const OPEN = "\uE000";
const CLOSE = "\uE001";
const SOURCE_OPEN = "\uE002";
const SOURCE_CLOSE = "\uE003";
const MARKS = /[\uE000-\uE003]/u;

type Kind = "deterministic" | "source";
const KINDS: readonly Kind[] = ["deterministic", "source"];
const DELIMITERS: Record<Kind, readonly [string, string]> = {
  deterministic: [OPEN, CLOSE],
  source: [SOURCE_OPEN, SOURCE_CLOSE],
};
type Ranges = Record<Kind, readonly DeterministicSpan[]>;
type Broken = Record<Kind, boolean>;

// Mirrors the replacer type of `String.prototype.replace`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Replacer = (substring: string, ...args: any[]) => string;

type Edit = {
  readonly start: number;
  readonly end: number;
  readonly inserted: string;
  readonly spans: Ranges;
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

/**
 * Removes the marks from one replacement and returns their ranges in it, per
 * kind. Each kind must be balanced on its own; a source-data range may sit
 * inside a deterministic one.
 */
const unmark = (raw: string): { text: string; spans: Ranges; invalid: Broken } => {
  const invalid: Broken = { deterministic: false, source: false };
  if (!MARKS.test(raw)) return { text: raw, spans: { deterministic: [], source: [] }, invalid };
  let text = "";
  const open: Record<Kind, number | undefined> = { deterministic: undefined, source: undefined };
  const spans: Record<Kind, DeterministicSpan[]> = { deterministic: [], source: [] };
  for (const character of raw) {
    const opened = KINDS.find((kind) => DELIMITERS[kind][0] === character);
    const closed = KINDS.find((kind) => DELIMITERS[kind][1] === character);
    if (opened) {
      if (open[opened] !== undefined) invalid[opened] = true;
      open[opened] = text.length;
    } else if (closed) {
      const start = open[closed];
      if (start === undefined) invalid[closed] = true;
      else spans[closed].push({ start, end: text.length, text: text.slice(start) });
      open[closed] = undefined;
    } else {
      text += character;
    }
  }
  // Marks of one kind never move the other kind's ranges (all marks are
  // stripped), so an unbalanced kind breaks only itself.
  for (const kind of KINDS) if (open[kind] !== undefined) invalid[kind] = true;
  return { text, spans, invalid };
};

/** Ranges of one kind moved through one `replace`; touched ranges break the kind. */
const moveRanges = (
  previous: readonly DeterministicSpan[],
  edits: readonly Edit[],
  kind: Kind,
): { ranges: DeterministicSpan[]; touched: boolean } => {
  let touched = false;
  const ranges: DeterministicSpan[] = [];
  // Existing ranges move by the length change of the edits before them.
  for (const range of previous) {
    let shift = 0;
    for (const edit of edits) {
      const touches =
        edit.start === edit.end
          ? edit.start > range.start && edit.start < range.end
          : edit.start < range.end && edit.end > range.start;
      if (touches) touched = true;
      // An insertion exactly at the range start lands before it.
      if (edit.end <= range.start) shift += edit.inserted.length - (edit.end - edit.start);
    }
    ranges.push({ start: range.start + shift, end: range.end + shift, text: range.text });
  }
  // New ranges are placed where their edit lands in the output.
  let shift = 0;
  for (const edit of edits) {
    const outputStart = edit.start + shift;
    for (const span of edit.spans[kind]) {
      ranges.push({ start: outputStart + span.start, end: outputStart + span.end, text: span.text });
    }
    shift += edit.inserted.length - (edit.end - edit.start);
  }
  return { ranges, touched };
};

/** The ranges of one kind, ordered, when every invariant holds; empty otherwise. */
const validRanges = (text: string, ranges: readonly DeterministicSpan[], broken: boolean): DeterministicSpan[] => {
  if (broken) return [];
  const ordered = [...ranges].sort((left, right) => left.start - right.start);
  let previousEnd = 0;
  for (const span of ordered) {
    if (
      span.start < previousEnd ||
      span.end <= span.start ||
      span.end > text.length ||
      text.slice(span.start, span.end) !== span.text
    )
      return [];
    previousEnd = span.end;
  }
  return ordered;
};

export class TrackedText {
  private constructor(
    readonly text: string,
    private readonly ranges: Ranges,
    private readonly broken: Broken,
    private readonly recording: boolean,
  ) {}

  /**
   * Starts tracking `text`. Recording is off (marks become plain text) when
   * not requested or when the text already holds a mark code point, so the
   * output is never changed by tracking.
   */
  static of(text: string, record: boolean): TrackedText {
    return new TrackedText(
      text,
      { deterministic: [], source: [] },
      { deterministic: false, source: false },
      record && !MARKS.test(text),
    );
  }

  /** Wraps a rendering so the enclosing `replace` records its exact range. */
  mark(rendered: string): string {
    return this.recording ? `${OPEN}${rendered}${CLOSE}` : rendered;
  }

  /**
   * Wraps text copied verbatim from the source (e.g. a yarn brand) so the
   * enclosing `replace` records its exact range as source data.
   */
  markSourceData(text: string): string {
    return this.recording ? `${SOURCE_OPEN}${text}${SOURCE_CLOSE}` : text;
  }

  replace(pattern: RegExp, replacement: string | Replacer): TrackedText {
    const edits: Edit[] = [];
    const invalidMarks: Broken = { deterministic: false, source: false };
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
      // Without recording no mark was ever written, so any mark code point
      // came from the text itself: it is kept verbatim and never read as a
      // range (the text stays exactly what plain `replace` produces).
      if (!this.recording) {
        edits.push({ start: offset, end: offset + match.length, inserted: raw, spans: { deterministic: [], source: [] } });
        return raw;
      }
      const unmarked = unmark(raw);
      for (const kind of KINDS) if (unmarked.invalid[kind]) invalidMarks[kind] = true;
      edits.push({ start: offset, end: offset + match.length, inserted: unmarked.text, spans: unmarked.spans });
      return unmarked.text;
    });
    if (edits.length === 0) return this;

    const deterministic = moveRanges(this.ranges.deterministic, edits, "deterministic");
    const source = moveRanges(this.ranges.source, edits, "source");
    return new TrackedText(
      text,
      { deterministic: deterministic.ranges, source: source.ranges },
      {
        deterministic: this.broken.deterministic || deterministic.touched || invalidMarks.deterministic,
        source: this.broken.source || source.touched || invalidMarks.source,
      },
      this.recording,
    );
  }

  /**
   * The recorded ranges, in source order, when every invariant holds; empty
   * otherwise (fail closed): no edit touched a range, ranges are in bounds,
   * non-empty, non-overlapping, and each one's text matches the output.
   */
  spans(): DeterministicSpan[] {
    return validRanges(this.text, this.ranges.deterministic, this.broken.deterministic || !this.recording);
  }

  /** The recorded source-data ranges, with the same fail-closed rules as `spans`. */
  sourceDataSpans(): DeterministicSpan[] {
    return validRanges(this.text, this.ranges.source, this.broken.source || !this.recording);
  }
}
