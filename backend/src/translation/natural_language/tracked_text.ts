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
/**
 * Range channels: the two mark kinds, plus `positioned` source data, whose
 * ranges are placed by `compose` itself and need no mark code points (the
 * fallback when the text already holds one and marks are off).
 */
type Channel = Kind | "positioned";
type Ranges = Record<Channel, readonly DeterministicSpan[]>;
type Broken = Record<Channel, boolean>;
const NO_RANGES: Ranges = { deterministic: [], source: [], positioned: [] };

/** A replacement built by `compose` with the exact offsets of its source data. */
export type ComposedRendering = {
  readonly text: string;
  readonly sourceData: readonly { readonly start: number; readonly end: number }[];
};
/** What `compose` returns: a plain (or marked) string, or a positioned rendering. */
export type Composed = string | ComposedRendering;

/** Source text (e.g. a yarn brand) to copy verbatim into a `compose` rendering. */
export class SourceDataPiece {
  constructor(readonly text: string) {}
}

// Mirrors the replacer type of `String.prototype.replace`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Replacer = (substring: string, ...args: any[]) => Composed;

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
  const invalid: Broken = { deterministic: false, source: false, positioned: false };
  if (!MARKS.test(raw)) return { text: raw, spans: NO_RANGES, invalid };
  let text = "";
  const open: Record<Kind, number | undefined> = { deterministic: undefined, source: undefined };
  const spans: Record<Channel, DeterministicSpan[]> = { deterministic: [], source: [], positioned: [] };
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
  kind: Channel,
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
    /** Recording was asked for (it is still off when the text holds a mark). */
    private readonly requested: boolean,
  ) {}

  /**
   * Starts tracking `text`. Recording is off (marks become plain text) when
   * not requested or when the text already holds a mark code point, so the
   * output is never changed by tracking.
   */
  static of(text: string, record: boolean): TrackedText {
    return new TrackedText(
      text,
      NO_RANGES,
      { deterministic: false, source: false, positioned: false },
      record && !MARKS.test(text),
      record,
    );
  }

  /** Wraps a rendering so the enclosing `replace` records its exact range. */
  mark(rendered: string): string;
  mark(rendered: Composed): Composed;
  mark(rendered: Composed): Composed {
    return this.recording && typeof rendered === "string" ? `${OPEN}${rendered}${CLOSE}` : rendered;
  }

  /** Source text to copy verbatim into a `compose` rendering as source data. */
  sourceData(text: string): SourceDataPiece {
    return new SourceDataPiece(text);
  }

  /**
   * Builds one rendering from literal text, values and `sourceData` pieces.
   * With recording on, a piece is marked exactly like `markSourceData`. When
   * recording was requested but is off (the text holds a mark code point),
   * each piece's offset is recorded while the rendering is concatenated, so
   * its range is known by construction and never searched for; the enclosing
   * `replace` records it as positioned source data. Otherwise the rendering
   * is plain text. The rendered text is the same in every case.
   */
  compose(literals: TemplateStringsArray, ...values: readonly (Composed | SourceDataPiece)[]): Composed {
    const positioned = !this.recording && this.requested;
    let text = "";
    const sourceData: { start: number; end: number }[] = [];
    literals.forEach((literal, index) => {
      text += literal;
      if (index >= values.length) return;
      const value = values[index];
      if (value instanceof SourceDataPiece) {
        if (this.recording) text += this.markSourceData(value.text);
        else {
          if (positioned) sourceData.push({ start: text.length, end: text.length + value.text.length });
          text += value.text;
        }
      } else if (typeof value === "string") {
        text += value;
      } else if (value !== undefined) {
        if (positioned) {
          const shift = text.length;
          sourceData.push(...value.sourceData.map(({ start, end }) => ({ start: start + shift, end: end + shift })));
        }
        text += value.text;
      }
    });
    return sourceData.length > 0 ? { text, sourceData } : text;
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
    const invalidMarks: Broken = { deterministic: false, source: false, positioned: false };
    const input = this.text;
    const text = input.replace(pattern, (...args: unknown[]) => {
      const match = args[0] as string;
      const hasNamed = typeof args[args.length - 1] === "object" && args[args.length - 1] !== null;
      const named = hasNamed ? (args[args.length - 1] as Record<string, string | undefined>) : undefined;
      const offset = args[args.length - (hasNamed ? 3 : 2)] as number;
      const groups = args.slice(1, args.length - (hasNamed ? 3 : 2)) as (string | undefined)[];
      const composed =
        typeof replacement === "function"
          ? replacement(...(args as [string, ...unknown[]]))
          : expandReplacement(replacement, match, groups, offset, input, named);
      const raw = typeof composed === "string" ? composed : composed.text;
      // Without recording no mark was ever written, so any mark code point
      // came from the text itself: it is kept verbatim and never read as a
      // range (the text stays exactly what plain `replace` produces). Only
      // positions recorded by `compose` become (positioned) source data.
      if (!this.recording) {
        const positioned =
          typeof composed === "string" || !this.requested
            ? []
            : composed.sourceData.map(({ start, end }) => ({ start, end, text: raw.slice(start, end) }));
        edits.push({ start: offset, end: offset + match.length, inserted: raw, spans: { ...NO_RANGES, positioned } });
        return raw;
      }
      // With recording on `compose` never positions; a positioned rendering
      // here cannot be placed through the marks, so it breaks that channel.
      if (typeof composed !== "string") invalidMarks.positioned = true;
      const unmarked = unmark(raw);
      for (const kind of KINDS) if (unmarked.invalid[kind]) invalidMarks[kind] = true;
      edits.push({ start: offset, end: offset + match.length, inserted: unmarked.text, spans: unmarked.spans });
      return unmarked.text;
    });
    if (edits.length === 0) return this;

    const deterministic = moveRanges(this.ranges.deterministic, edits, "deterministic");
    const source = moveRanges(this.ranges.source, edits, "source");
    const positioned = moveRanges(this.ranges.positioned, edits, "positioned");
    return new TrackedText(
      text,
      { deterministic: deterministic.ranges, source: source.ranges, positioned: positioned.ranges },
      {
        deterministic: this.broken.deterministic || deterministic.touched || invalidMarks.deterministic,
        source: this.broken.source || source.touched || invalidMarks.source,
        positioned: this.broken.positioned || positioned.touched || invalidMarks.positioned,
      },
      this.recording,
      this.requested,
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

  /**
   * Source-data ranges placed by `compose` while marks were off because the
   * text held a mark code point (requested recording only), with the same
   * fail-closed rules as `spans`. Deterministic spans are never recovered
   * this way.
   */
  positionedSourceDataSpans(): DeterministicSpan[] {
    return validRanges(this.text, this.ranges.positioned, this.broken.positioned || this.recording || !this.requested);
  }
}
