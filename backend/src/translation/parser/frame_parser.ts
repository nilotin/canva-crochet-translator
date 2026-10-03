/**
 * Turkish frame parser (Stage 1, Tasks 2-3).
 *
 * Consumes typed-lexer tokens and produces the Frame / Opaque IR
 * (`./frame_ir.ts`). Its only production use is the same-block course-decision
 * pre-pass (`context/course_decisions.ts`, next-stage Task 8), which decides
 * nothing unless the legacy unit inference agrees; translated text is still
 * produced entirely by the existing normalizer, protection and mixed-segment
 * code.
 *
 * Mechanics: a token cursor tries each matcher at each token. A matcher looks
 * at a small, bounded window of tokens and returns either nothing or its
 * nodes: one frame (one action), or, for the single linked pair, two frames
 * with the exact whitespace between them. Tokens no matcher claims go into
 * maximal Opaque runs. There are no clause-level regexes and no calls into
 * the legacy normalizer or protection helpers.
 *
 * Implemented:
 *  - `stitch_count`, "N<stitch> örüyoruz" (work N stitches);
 *  - one linked pair, `chain` (converb) + `turn` (finite):
 *    "N zincir çekip dönüyoruz". Chain and turn are recognized ONLY as this
 *    pair, never on their own;
 *  - `course_end_turn` (Stage 2): an exact course-end phrase followed by the
 *    same pair window, "[Bütün] sıra sonlarında|sonunda N zincir çekip
 *    dönüyoruz", as one flat frame. It records the phrase's `scope` only;
 *  - `course_count` (Stage 2): "N sıra Mx", work M stitches for N courses. It
 *    records the course noun's span only, never row or round.
 *
 * Lexicon:
 *  - Families admit glossary CONCEPT IDS (`STITCH_COUNT_CONCEPTS`,
 *    `CHAIN_CONCEPT`). Abbreviation spellings are read from `PROJECT_NOTATION`,
 *    never listed here, so the parser cannot drift from the glossary. A
 *    spelling must match the glossary form exactly (case included).
 *  - Full nouns (`zincir`) and verb forms (`örüyoruz`, `çekip`, `dönüyoruz`)
 *    are parser lexicon, whole words only: the glossary has no verbs, and its
 *    descriptions are never used as spellings. So are the course-end phrase
 *    words (`COURSE_END_PHRASES`) and the course noun (`COURSE_WORDS`), and
 *    the further continuation words the course_count boundary exceptions
 *    below compare against (`bir`, `ipimizi`, `kesiyoruz`, `ve`, `dikiyoruz`).
 *
 * FIRST-SLICE ADMISSION RULES. The left and right boundary checks below are a
 * deliberately conservative admission policy for this first migrated slice,
 * NOT a claim about Turkish grammar. A stitch-count clause preceded by an
 * adjunct ("ilk kolda 13x örüyoruz") or followed directly by another clause
 * ("66x örüyoruz ipimizi kesmeden ...") is perfectly meaningful; it simply
 * stays Opaque until a later task widens admission together with the context
 * it needs. For the linked pair the same rules apply outside the pair only.
 *
 * Narrow course_count exceptions: a course count may also be followed by one
 * of three exact, single-line yarn-cut continuations, recognized from typed
 * tokens only (`followedByWrittenChainCut`, `followedByWorkedChainCut`,
 * `followedByDashYarnCut`): "bir zincir çekip ipimizi kesiyoruz",
 * "örüyoruz, K zincir çekip ipimizi kesiyoruz", and a dash run before
 * "ipimizi kesiyoruz" (optionally "ve dikiyoruz"). Each must end at a right
 * boundary. Only the count becomes a frame; the continuation stays Opaque and
 * no chain, work or yarn-cut frame is parsed from it.
 *
 * Import rules: `../lexer/typed_lexer.js`, `../glossary.js` and `./frame_ir.js`
 * only. No translator, normalizer, validator, provider or corpus code.
 */
import { PROJECT_NOTATION } from "../glossary.js";
import { lexSource, type LexToken } from "../lexer/typed_lexer.js";
import type {
  ChainFrame,
  CourseCountFrame,
  CourseEndScope,
  CourseEndTurnFrame,
  FrameParse,
  Opaque,
  ParseNode,
  SourceSpan,
  StitchCountFrame,
  TurnFrame,
} from "./frame_ir.js";

// ---------------------------------------------------------------------------
// Lexicon
// ---------------------------------------------------------------------------

/** Glossary concepts that name a stitch TYPE worked N times. */
export const STITCH_COUNT_CONCEPTS: readonly string[] = [
  "single_crochet",
  "half_double_crochet",
  "double_crochet",
  "treble_crochet",
  "extended_single_crochet",
];

/** Finite "we work" forms. Exact spelling; no case folding. */
export const STITCH_COUNT_VERBS: ReadonlySet<string> = new Set(["örüyoruz"]);

/** Exact glossary Turkish spelling -> concept id, for the admitted concepts only. */
export const STITCH_COUNT_FORMS: ReadonlyMap<string, string> = new Map(
  PROJECT_NOTATION.filter((entry) => STITCH_COUNT_CONCEPTS.includes(entry.concept)).map(
    (entry): [string, string] => [entry.tr.abbreviation, entry.concept],
  ),
);

/** The glossary concept a chain frame's unit names. */
export const CHAIN_CONCEPT = "chain";

/**
 * Chain unit spellings -> concept id. The abbreviation (`zn`) is read from
 * `PROJECT_NOTATION`; the noun `zincir` is parser lexicon, because glossary
 * DESCRIPTIONS are never a source of spellings. Exact spelling only.
 */
export const CHAIN_UNIT_FORMS: ReadonlyMap<string, string> = new Map([
  ...PROJECT_NOTATION.filter((entry) => entry.concept === CHAIN_CONCEPT).map(
    (entry): [string, string] => [entry.tr.abbreviation, entry.concept],
  ),
  ["zincir", CHAIN_CONCEPT],
]);

/** Converb forms of "make chains" admitted in this task. */
export const CHAIN_CONVERBS: ReadonlySet<string> = new Set(["çekip"]);

/** Finite "we turn" forms admitted in this task. */
export const TURN_FINITE_VERBS: ReadonlySet<string> = new Set(["dönüyoruz"]);

/** Course nouns for `course_count`. Exact lowercase only; no row/round meaning. */
export const COURSE_WORDS: ReadonlySet<string> = new Set(["sıra"]);

/**
 * Course-end phrases before a chain -> turn pair, word by word. Exact finite
 * spellings only; the phrase-initial word may be capitalized. No stems, no
 * other inflections, no other quantifiers.
 */
export const COURSE_END_PHRASES: readonly {
  readonly words: readonly ReadonlySet<string>[];
  readonly scope: CourseEndScope;
}[] = [
  {
    words: [new Set(["Bütün", "bütün"]), new Set(["sıra"]), new Set(["sonlarında"])],
    scope: "every",
  },
  { words: [new Set(["Sıra", "sıra"]), new Set(["sonlarında"])], scope: "plural" },
  { words: [new Set(["Sıra", "sıra"]), new Set(["sonunda"])], scope: "single" },
];

// ---------------------------------------------------------------------------
// First-slice admission rules (see the module comment)
// ---------------------------------------------------------------------------

const LEFT_PUNCTUATION: ReadonlySet<string> = new Set([".", "!", "?", ";", ":"]);
const RIGHT_PUNCTUATION: ReadonlySet<string> = new Set([".", ",", ";", ":", "!", "?"]);

/** The token before `index`, looking back over at most one whitespace token. */
const previousSignificant = (tokens: readonly LexToken[], index: number): LexToken | undefined => {
  const previous = tokens[index - 1];
  return previous?.kind === "whitespace" ? tokens[index - 2] : previous;
};

/** The token after `index`, looking ahead over at most one whitespace token. */
const nextSignificant = (tokens: readonly LexToken[], index: number): LexToken | undefined => {
  const next = tokens[index + 1];
  return next?.kind === "whitespace" ? tokens[index + 2] : next;
};

const admitsLeft = (token: LexToken | undefined): boolean =>
  token === undefined ||
  token.kind === "line_break" ||
  (token.kind === "punctuation" && LEFT_PUNCTUATION.has(token.raw)) ||
  (token.kind === "bracket" && token.raw === ")");

const admitsRight = (token: LexToken | undefined): boolean =>
  token === undefined ||
  token.kind === "line_break" ||
  (token.kind === "punctuation" && RIGHT_PUNCTUATION.has(token.raw)) ||
  (token.kind === "bracket" && token.raw === "(");

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

/** Nodes one matcher claims, starting at `start`, and the next token index. */
type Match = { start: number; nodes: ParseNode[]; next: number };

const spanOf = (source: string, start: number, end: number): SourceSpan => ({
  start,
  end,
  raw: source.slice(start, end),
});

const tokenSpan = (token: LexToken): SourceSpan => ({
  start: token.start,
  end: token.end,
  raw: token.raw,
});

const DIGITS_ONLY = /^[0-9]+$/;

/** An integer count token, or undefined. */
const countValue = (token: LexToken | undefined): number | undefined => {
  if (token?.kind !== "number" || !DIGITS_ONLY.test(token.raw)) return undefined;
  const value = Number(token.raw);
  return Number.isSafeInteger(value) ? value : undefined;
};

/**
 * `stitch_count`: number, adjacent glossary stitch form, one whitespace run,
 * finite verb. Four tokens, plus one boundary token on each side.
 */
const matchStitchCount = (
  source: string,
  tokens: readonly LexToken[],
  index: number,
): Match | undefined => {
  const count = tokens[index];
  const stitch = tokens[index + 1];
  const space = tokens[index + 2];
  const verb = tokens[index + 3];
  if (
    count?.kind !== "number" ||
    !DIGITS_ONLY.test(count.raw) ||
    stitch?.kind !== "abbreviation" ||
    stitch.start !== count.end ||
    space?.kind !== "whitespace" ||
    verb?.kind !== "word" ||
    !STITCH_COUNT_VERBS.has(verb.raw)
  ) {
    return undefined;
  }
  const concept = STITCH_COUNT_FORMS.get(stitch.raw);
  const value = Number(count.raw);
  if (concept === undefined || !Number.isSafeInteger(value)) return undefined;
  if (!admitsLeft(previousSignificant(tokens, index))) return undefined;
  if (!admitsRight(nextSignificant(tokens, index + 3))) return undefined;

  const frame: StitchCountFrame = {
    kind: "frame",
    action: "stitch_count",
    span: spanOf(source, count.start, verb.end),
    slots: {
      count: { span: tokenSpan(count), value },
      stitch: { span: tokenSpan(stitch), concept },
      verb: { span: tokenSpan(verb), form: "finite" },
    },
  };
  return { start: count.start, nodes: [frame], next: index + 4 };
};

/** The exact tokens of one chain(converb) -> turn(finite) pair, before boundary checks. */
type ChainTurnCore = {
  readonly count: LexToken;
  readonly value: number;
  readonly unit: LexToken;
  readonly concept: string;
  readonly converb: LexToken;
  readonly separator: LexToken;
  readonly turn: LexToken;
};

/**
 * The exact seven-token pair window starting at `index`: count, whitespace,
 * unit, whitespace, converb, whitespace, finite verb. No boundary checks: the
 * standalone pair and `course_end_turn` add their own.
 */
const chainTurnCore = (tokens: readonly LexToken[], index: number): ChainTurnCore | undefined => {
  const count = tokens[index];
  const unit = tokens[index + 2];
  const converb = tokens[index + 4];
  const separator = tokens[index + 5];
  const turn = tokens[index + 6];
  const value = countValue(count);
  if (
    count === undefined ||
    value === undefined ||
    tokens[index + 1]?.kind !== "whitespace" ||
    unit === undefined ||
    (unit.kind !== "word" && unit.kind !== "abbreviation") ||
    tokens[index + 3]?.kind !== "whitespace" ||
    converb?.kind !== "word" ||
    !CHAIN_CONVERBS.has(converb.raw) ||
    separator?.kind !== "whitespace" ||
    turn?.kind !== "word" ||
    !TURN_FINITE_VERBS.has(turn.raw)
  ) {
    return undefined;
  }
  const concept = CHAIN_UNIT_FORMS.get(unit.raw);
  if (concept === undefined) return undefined;
  return { count, value, unit, concept, converb, separator, turn };
};

/** Tokens in one chain -> turn pair window. */
const CHAIN_TURN_TOKENS = 7;

/**
 * The one linked pair of this task: `chain` (converb) followed by `turn`
 * (finite), "N zincir çekip dönüyoruz" / "N zn çekip dönüyoruz".
 *
 * Seven tokens: count, whitespace, unit, whitespace, converb, whitespace,
 * finite verb. Both frames are emitted or neither is. The first-slice
 * boundaries are checked only outside the pair (before the count, after the
 * finite verb); the members are joined by exactly one whitespace token, which
 * stays an exact Opaque node. This is a fixed two-member shape, not a general
 * sequence or coordination matcher.
 */
const matchChainTurnPair = (
  source: string,
  tokens: readonly LexToken[],
  index: number,
): Match | undefined => {
  const core = chainTurnCore(tokens, index);
  if (core === undefined) return undefined;
  if (!admitsLeft(previousSignificant(tokens, index))) return undefined;
  if (!admitsRight(nextSignificant(tokens, index + CHAIN_TURN_TOKENS - 1))) return undefined;
  const { count, value, unit, concept, converb, separator, turn } = core;

  const chain: ChainFrame = {
    kind: "frame",
    action: "chain",
    span: spanOf(source, count.start, converb.end),
    slots: {
      count: { span: tokenSpan(count), value },
      unit: { span: tokenSpan(unit), concept },
      verb: { span: tokenSpan(converb), form: "converb" },
    },
  };
  const between: Opaque = { kind: "opaque", span: tokenSpan(separator) };
  const turnFrame: TurnFrame = {
    kind: "frame",
    action: "turn",
    span: tokenSpan(turn),
    slots: { verb: { span: tokenSpan(turn), form: "finite" } },
  };
  return { start: count.start, nodes: [chain, between, turnFrame], next: index + CHAIN_TURN_TOKENS };
};

/**
 * `course_end_turn`: one exact course-end phrase (`COURSE_END_PHRASES`), one
 * whitespace token, then the exact chain -> turn pair window. One flat frame;
 * the pair's parts become slots, so no standalone chain or turn is emitted.
 * The first-slice boundaries apply before the first phrase word and after the
 * finite verb. The phrase only records what the Turkish says (`scope`); it
 * decides no row or round meaning.
 */
const matchCourseEndTurn = (
  source: string,
  tokens: readonly LexToken[],
  index: number,
): Match | undefined => {
  for (const phrase of COURSE_END_PHRASES) {
    const last = index + (phrase.words.length - 1) * 2;
    const words = phrase.words.every((spellings, offset) => {
      const word = tokens[index + offset * 2];
      const gap = tokens[index + offset * 2 + 1];
      return (
        word?.kind === "word" &&
        spellings.has(word.raw) &&
        (offset === phrase.words.length - 1 || gap?.kind === "whitespace")
      );
    });
    if (!words || tokens[last + 1]?.kind !== "whitespace") continue;
    const core = chainTurnCore(tokens, last + 2);
    if (core === undefined) continue;
    if (!admitsLeft(previousSignificant(tokens, index))) return undefined;
    if (!admitsRight(nextSignificant(tokens, last + 2 + CHAIN_TURN_TOKENS - 1))) return undefined;

    const first = tokens[index]!;
    const scopeEnd = tokens[last]!;
    const { value, count, unit, concept, converb, turn } = core;
    const frame: CourseEndTurnFrame = {
      kind: "frame",
      action: "course_end_turn",
      span: spanOf(source, first.start, turn.end),
      slots: {
        scope: { span: spanOf(source, first.start, scopeEnd.end), value: phrase.scope },
        count: { span: tokenSpan(count), value },
        unit: { span: tokenSpan(unit), concept },
        converb: { span: tokenSpan(converb), form: "converb" },
        verb: { span: tokenSpan(turn), form: "finite" },
      },
    };
    return { start: first.start, nodes: [frame], next: last + 2 + CHAIN_TURN_TOKENS };
  }
  return undefined;
};

/**
 * A written-one-chain yarn-cut continuation bounds a preceding course count.
 * Inspect exact typed tokens only; the continuation remains Opaque. This does
 * not admit arbitrary prose after a count or parse a chain/yarn-cut frame.
 */
const followedByWrittenChainCut = (tokens: readonly LexToken[], stitchIndex: number): boolean => {
  if (tokens[stitchIndex]?.raw !== "x") return false;
  const words = ["bir", "zincir", "çekip", "ipimizi", "kesiyoruz"];
  for (const [offset, word] of words.entries()) {
    const space = tokens[stitchIndex + 1 + offset * 2];
    const token = tokens[stitchIndex + 2 + offset * 2];
    if (space?.kind !== "whitespace" || token?.kind !== "word" || token.raw !== word) return false;
  }
  return admitsRight(nextSignificant(tokens, stitchIndex + words.length * 2));
};

/**
 * A worked chain-and-cut continuation ("örüyoruz, K zincir çekip ipimizi
 * kesiyoruz") bounds a preceding course count. Exact typed tokens on one line
 * only, optional whitespace before the comma; the continuation remains Opaque.
 * This does not parse a work, chain or yarn-cut frame.
 */
const followedByWorkedChainCut = (tokens: readonly LexToken[], stitchIndex: number): boolean => {
  if (tokens[stitchIndex]?.raw !== "x") return false;
  let index = stitchIndex + 1;
  const space = (): boolean => {
    if (tokens[index]?.kind !== "whitespace") return false;
    index += 1;
    return true;
  };
  const word = (raw: string): boolean => {
    if (tokens[index]?.kind !== "word" || tokens[index]?.raw !== raw) return false;
    index += 1;
    return true;
  };
  if (!space() || !word("örüyoruz")) return false;
  if (tokens[index]?.kind === "whitespace") index += 1;
  if (tokens[index]?.kind !== "punctuation" || tokens[index]?.raw !== ",") return false;
  index += 1;
  if (!space() || countValue(tokens[index]) === undefined) return false;
  index += 1;
  for (const raw of ["zincir", "çekip", "ipimizi", "kesiyoruz"]) {
    if (!space() || !word(raw)) return false;
  }
  return admitsRight(nextSignificant(tokens, index - 1));
};

/**
 * A dash-separated yarn cut ("--- ipimizi kesiyoruz", "– ipimizi kesiyoruz",
 * optionally "... ve dikiyoruz") bounds a preceding course count. Exact typed
 * tokens on one line only: optional whitespace, a run of "-" or one "–"/"—",
 * optional whitespace, the yarn-cut words, then a right boundary. The
 * continuation remains Opaque; a dash followed by anything else (e.g. "16x-2")
 * is still rejected.
 */
const followedByDashYarnCut = (tokens: readonly LexToken[], stitchIndex: number): boolean => {
  if (tokens[stitchIndex]?.raw !== "x") return false;
  let index = stitchIndex + 1;
  const optionalSpace = () => {
    if (tokens[index]?.kind === "whitespace") index += 1;
  };
  const words = (...raws: string[]): boolean => {
    for (const [offset, raw] of raws.entries()) {
      if (offset > 0) {
        if (tokens[index]?.kind !== "whitespace") return false;
        index += 1;
      }
      if (tokens[index]?.kind !== "word" || tokens[index]?.raw !== raw) return false;
      index += 1;
    }
    return true;
  };

  optionalSpace();
  const dash = tokens[index];
  if (dash?.kind !== "dash") return false;
  if (dash.raw === "-") {
    while (tokens[index]?.kind === "dash" && tokens[index]?.raw === "-") index += 1;
  } else if (dash.raw === "–" || dash.raw === "—") {
    index += 1;
  } else {
    return false;
  }
  optionalSpace();
  if (!words("ipimizi", "kesiyoruz")) return false;
  if (admitsRight(nextSignificant(tokens, index - 1))) return true;
  if (tokens[index]?.kind !== "whitespace") return false;
  index += 1;
  return words("ve", "dikiyoruz") && admitsRight(nextSignificant(tokens, index - 1));
};

/**
 * `course_count`: "N sıra Mx", work M stitches of one type for N courses.
 * Six tokens: course count, whitespace, course noun, whitespace, stitch count,
 * attached glossary stitch form (the `stitch_count` spellings). Markers such as
 * `13)` or `2-25)` stay outside the frame. No verb, and no row/round meaning.
 */
const matchCourseCount = (
  source: string,
  tokens: readonly LexToken[],
  index: number,
): Match | undefined => {
  const courses = tokens[index];
  const course = tokens[index + 2];
  const count = tokens[index + 4];
  const stitch = tokens[index + 5];
  const coursesValue = countValue(courses);
  const stitchCountValue = countValue(count);
  if (
    courses === undefined ||
    coursesValue === undefined ||
    tokens[index + 1]?.kind !== "whitespace" ||
    course?.kind !== "word" ||
    !COURSE_WORDS.has(course.raw) ||
    tokens[index + 3]?.kind !== "whitespace" ||
    count === undefined ||
    stitchCountValue === undefined ||
    stitch?.kind !== "abbreviation" ||
    stitch.start !== count.end
  ) {
    return undefined;
  }
  const concept = STITCH_COUNT_FORMS.get(stitch.raw);
  if (concept === undefined) return undefined;
  if (!admitsLeft(previousSignificant(tokens, index))) return undefined;
  if (
    !admitsRight(nextSignificant(tokens, index + 5)) &&
    !followedByWrittenChainCut(tokens, index + 5) &&
    !followedByWorkedChainCut(tokens, index + 5) &&
    !followedByDashYarnCut(tokens, index + 5)
  ) return undefined;

  const frame: CourseCountFrame = {
    kind: "frame",
    action: "course_count",
    span: spanOf(source, courses.start, stitch.end),
    slots: {
      courses: { span: tokenSpan(courses), value: coursesValue },
      course: { span: tokenSpan(course) },
      count: { span: tokenSpan(count), value: stitchCountValue },
      stitch: { span: tokenSpan(stitch), concept },
    },
  };
  return { start: courses.start, nodes: [frame], next: index + 6 };
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parses `source` into Frame and Opaque nodes. Pure, deterministic and total:
 * every input is covered exactly, and anything unrecognized is Opaque.
 */
export const parseFrames = (source: string): FrameParse => {
  const tokens = lexSource(source);
  const nodes: ParseNode[] = [];
  let opaqueStart: number | undefined;

  const flushOpaque = (end: number): void => {
    if (opaqueStart !== undefined && end > opaqueStart) {
      const opaque: Opaque = { kind: "opaque", span: spanOf(source, opaqueStart, end) };
      nodes.push(opaque);
    }
    opaqueStart = undefined;
  };

  let index = 0;
  while (index < tokens.length) {
    const match =
      matchStitchCount(source, tokens, index) ??
      matchChainTurnPair(source, tokens, index) ??
      matchCourseEndTurn(source, tokens, index) ??
      matchCourseCount(source, tokens, index);
    if (match !== undefined) {
      flushOpaque(match.start);
      nodes.push(...match.nodes);
      index = match.next;
      continue;
    }
    opaqueStart ??= tokens[index]?.start;
    index += 1;
  }
  flushOpaque(source.length);

  return { source, nodes };
};
