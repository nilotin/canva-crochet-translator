export type CrochetCountUnit = "round" | "row";

export type CrochetCountUnitWord =
  | "round"
  | "rounds"
  | "row"
  | "rows";

const crochetCountUnitWord = (
  count: string,
  unit: CrochetCountUnit,
): CrochetCountUnitWord =>
  Number(count) === 1
    ? unit
    : unit === "round"
      ? "rounds"
      : "rows";

export type BareRoundCountSourceLine = {
  prefix: string;
  range: string | undefined;
  rounds: string;
  stitches: string;
  suffix: string;
};

export type BareRoundCountTargetLine = {
  prefix: string;
  range: string | undefined;
  stitches: string;
  rounds: string;
  roundWord: CrochetCountUnitWord;
  suffix: string;
};

export type NumericTokenSpan = {
  start: number;
  end: number;
};

export type RoundCountYarnCutSourceSpan = {
  start: number;
  end: number;
  text: string;
  prefix: string;
  range: string | undefined;
  rounds: string;
  stitches: string;
  suffix: string;
  roundsSpan: NumericTokenSpan;
  stitchesSpan: NumericTokenSpan;
};

export type RoundCountYarnCutTargetSpan = RoundCountYarnCutSourceSpan & {
  roundWord: CrochetCountUnitWord;
};

export type LogicalLine = {
  text: string;
  start: number;
  end: number;
  separator: string;
};

export type RoundCountTrailingActionKind =
  | "buttonhole_chain"
  | "chain_and_cut";

export type RoundCountTrailingActionSourceSpan = {
  start: number;
  end: number;
  text: string;
  prefix: string;
  range: string | undefined;
  rounds: string;
  stitches: string;
  chains: string;
  kind: RoundCountTrailingActionKind;
  suffix: string;
  roundsSpan: NumericTokenSpan;
  stitchesSpan: NumericTokenSpan;
};

export type RoundCountTrailingActionTargetSpan =
  RoundCountTrailingActionSourceSpan & {
    roundWord: CrochetCountUnitWord;
  };

const SOURCE_LINE_PATTERN =
  /^([\t ]*(?:(\d+(?:-\d+)?)\)[\t ]*)?)(\d+)[\t ]+sıra[\t ]+(\d+)[\t ]*x([.]?[\t ]*)$/iu;

const TARGET_LINE_PATTERN =
  /^([\t ]*(?:(\d+(?:-\d+)?)\)[\t ]*)?)(\d+)sc[\t ]+for[\t ]+(\d+)[\t ]+(round|rounds|row|rows)([.]?[\t ]*)$/iu;

const ROUND_COUNT_YARN_CUT_SOURCE_PATTERN =
  /(?<![\p{L}\p{N}_])((?:(\d+(?:-\d+)?)\)[\t ]*)?)(\d+)[\t ]+sıra[\t ]+(\d+)[\t ]*x[\t ]*(?:-+|–|—|,|;)[\t ]*[iİ]pimizi[\t ]+kesiyoruz(?:\.(?:([\t ]+)(?=\S)|([\t ]*)(?=$|[\r\n]))|([\t ]*)(?=$|[\r\n]))/dgimu;

const ROUND_COUNT_YARN_CUT_TARGET_PATTERN =
  /(?<![\p{L}\p{N}_])((?:(\d+(?:-\d+)?)\)[\t ]*)?)(\d+)sc for (\d+) (round|rounds|row|rows) — cut the yarn\.(?:([\t ]+)(?=\S)|([\t ]*)(?=$|[\r\n]))/dgmu;

const ROUND_COUNT_TRAILING_ACTION_SOURCE_PATTERN =
  /(?<![\p{L}\p{N}_])((?:(\d+(?:-\d+)?)\)[\t ]*)?)(\d+)[\t ]+sıra[\t ]+(\d+)[\t ]*x[\t ]*[,，][\t ]*(\d+)[\t ]+zincir(?:(?:[\t ]*\([\t ]*düğme[\t ]+iliği[\t ]*\))|(?:[\t ]+çekip[\t ]+ipimizi[\t ]+kesiyoruz\.?))(?:([\t ]+)(?=\S)|([\t ]*)(?=$|[\r\n]))/dgimu;

const ROUND_COUNT_TRAILING_ACTION_TARGET_PATTERN =
  /(?<![\p{L}\p{N}_])((?:(\d+(?:-\d+)?)\)[\t ]*)?)(\d+)sc[\t ]+for[\t ]+(\d+)[\t ]+(round|rounds|row|rows)[\t ]*[,，][\t ]*ch[\t ]+(\d+)(?:(?:[\t ]*\([\t ]*buttonhole[\t ]*\))|(?:[\t ]+and[\t ]+cut[\t ]+the[\t ]+yarn\.?))(?:([\t ]+)(?=\S)|([\t ]*)(?=$|[\r\n]))/dgimu;

export const parseBareRoundCountSourceLine = (
  source: string,
): BareRoundCountSourceLine | undefined => {
  const match = SOURCE_LINE_PATTERN.exec(source);
  if (!match) return undefined;

  return {
    prefix: match[1] ?? "",
    range: match[2],
    rounds: match[3] ?? "",
    stitches: match[4] ?? "",
    suffix: match[5] ?? "",
  };
};

export const parseBareRoundCountTargetLine = (
  target: string,
): BareRoundCountTargetLine | undefined => {
  const match = TARGET_LINE_PATTERN.exec(target);
  if (!match) return undefined;

  return {
    prefix: match[1] ?? "",
    range: match[2],
    stitches: match[3] ?? "",
    rounds: match[4] ?? "",
    roundWord: (match[5]?.toLocaleLowerCase("en") ??
      "round") as CrochetCountUnitWord,
    suffix: match[6] ?? "",
  };
};

export const renderEnglishBareRoundCountLine = (
  source: BareRoundCountSourceLine,
  stitchNotation: "x" | "sc",
  unit: CrochetCountUnit = "round",
  /** Marks deterministic English for the normalizer's carrier; identity elsewhere. */
  carry: (text: string) => string = (text) => text,
): string => {
  const unitWord = crochetCountUnitWord(source.rounds, unit);
  return `${source.prefix}${source.stitches}${stitchNotation} ${carry("for")} ${source.rounds} ${carry(unitWord)}${source.suffix}`;
};

const captureSpan = (
  match: RegExpMatchArray,
  captureIndex: number,
): NumericTokenSpan | undefined => {
  const indices = match.indices?.[captureIndex];
  return indices ? { start: indices[0], end: indices[1] } : undefined;
};

export const scanRoundCountYarnCutSourceSpans = (
  source: string,
): RoundCountYarnCutSourceSpan[] =>
  [...source.matchAll(ROUND_COUNT_YARN_CUT_SOURCE_PATTERN)].flatMap((match) => {
    const roundsSpan = captureSpan(match, 3);
    const stitchesSpan = captureSpan(match, 4);
    if (match.index === undefined || !roundsSpan || !stitchesSpan) return [];

    return [{
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
      prefix: match[1] ?? "",
      range: match[2],
      rounds: match[3] ?? "",
      stitches: match[4] ?? "",
      suffix: match[5] ?? match[6] ?? match[7] ?? "",
      roundsSpan,
      stitchesSpan,
    }];
  });

export const scanRoundCountYarnCutTargetSpans = (
  target: string,
): RoundCountYarnCutTargetSpan[] =>
  [...target.matchAll(ROUND_COUNT_YARN_CUT_TARGET_PATTERN)].flatMap((match) => {
    const stitchesSpan = captureSpan(match, 3);
    const roundsSpan = captureSpan(match, 4);
    if (match.index === undefined || !roundsSpan || !stitchesSpan) return [];

    return [{
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
      prefix: match[1] ?? "",
      range: match[2],
      stitches: match[3] ?? "",
      rounds: match[4] ?? "",
      roundWord: (match[5] ?? "round") as CrochetCountUnitWord,
      suffix: match[6] ?? match[7] ?? "",
      roundsSpan,
      stitchesSpan,
    }];
  });

const trailingActionKindFromSource = (
  text: string,
): RoundCountTrailingActionKind =>
  /düğme\s+iliği/iu.test(text) ? "buttonhole_chain" : "chain_and_cut";

const trailingActionKindFromTarget = (
  text: string,
): RoundCountTrailingActionKind =>
  /buttonhole/iu.test(text) ? "buttonhole_chain" : "chain_and_cut";

export const scanRoundCountTrailingActionSourceSpans = (
  source: string,
): RoundCountTrailingActionSourceSpan[] =>
  [...source.matchAll(ROUND_COUNT_TRAILING_ACTION_SOURCE_PATTERN)].flatMap(
    (match) => {
      const roundsSpan = captureSpan(match, 3);
      const stitchesSpan = captureSpan(match, 4);

      if (match.index === undefined || !roundsSpan || !stitchesSpan) return [];

      return [{
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        prefix: match[1] ?? "",
        range: match[2],
        rounds: match[3] ?? "",
        stitches: match[4] ?? "",
        chains: match[5] ?? "",
        kind: trailingActionKindFromSource(match[0]),
        suffix: match[6] ?? match[7] ?? "",
        roundsSpan,
        stitchesSpan,
      }];
    },
  );

export const scanRoundCountTrailingActionTargetSpans = (
  target: string,
): RoundCountTrailingActionTargetSpan[] =>
  [...target.matchAll(ROUND_COUNT_TRAILING_ACTION_TARGET_PATTERN)].flatMap(
    (match) => {
      const stitchesSpan = captureSpan(match, 3);
      const roundsSpan = captureSpan(match, 4);

      if (match.index === undefined || !roundsSpan || !stitchesSpan) return [];

      return [{
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        prefix: match[1] ?? "",
        range: match[2],
        stitches: match[3] ?? "",
        rounds: match[4] ?? "",
        roundWord: (match[5] ?? "round") as CrochetCountUnitWord,
        chains: match[6] ?? "",
        kind: trailingActionKindFromTarget(match[0]),
        suffix: match[7] ?? match[8] ?? "",
        roundsSpan,
        stitchesSpan,
      }];
    },
  );

export const renderEnglishRoundCountTrailingActionSpan = (
  source: RoundCountTrailingActionSourceSpan,
  stitchNotation: "x" | "sc",
  unit: CrochetCountUnit = "round",
  /** Marks deterministic English for the normalizer's carrier; identity elsewhere. */
  carry: (text: string) => string = (text) => text,
): string => {
  const unitWord = crochetCountUnitWord(source.rounds, unit);
  const core =
    `${source.prefix}${source.stitches}${stitchNotation} ${carry("for")} ` +
    `${source.rounds} ${carry(`${unitWord}, ch`)} ${source.chains}`;

  const action =
    source.kind === "buttonhole_chain"
      ? ` ${carry("(buttonhole)")}`
      : ` ${carry("and cut the yarn.")}`;

  return `${core}${action}${source.suffix}`;
};

export const inferCrochetCountUnitAtSourcePosition = (
  source: string,
  position: number,
): CrochetCountUnit => {
  const lines = splitLogicalLines(source);
  const lineIndex = lines.findIndex(
    ({ start, end }) => start <= position && position <= end,
  );

  if (lineIndex < 0) return "round";

  const numberedInstructionPattern =
    /^\s*(\d+)(?:-(\d+))?\)\s*/u;

  const currentLine = lines[lineIndex]?.text ?? "";
  const currentInstruction = currentLine.match(numberedInstructionPattern);

  // Only numbered crochet instructions can inherit construction context.
  if (!currentInstruction) return "round";

  const currentStart = Number(currentInstruction[1]);

  // A fresh 1) starts a new numbered construction. It must never inherit
  // turning-row state from an earlier section, even if headings/bullets
  // separate the two sections.
  if (!Number.isFinite(currentStart) || currentStart <= 1) {
    return "round";
  }

  let expectedPreviousNumber = currentStart - 1;

  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const previousLine = lines[index]?.text ?? "";

    if (previousLine.trim() === "") break;

    // Cutting the yarn closes the preceding construction.
    if (/\bipimizi\s+kesiyoruz\b/iu.test(previousLine)) break;

    const previousInstruction =
      previousLine.match(numberedInstructionPattern);

    // Non-numbered headings/bullets may occur inside one construction.
    if (!previousInstruction) continue;

    const previousStart = Number(previousInstruction[1]);
    const previousEnd = Number(
      previousInstruction[2] ?? previousInstruction[1],
    );

    if (
      !Number.isFinite(previousStart) ||
      !Number.isFinite(previousEnd) ||
      previousEnd !== expectedPreviousNumber
    ) {
      // Numbering is no longer contiguous, so continuity is unprovable.
      break;
    }

    if (
      /\bbütün\s+sıra\s+sonlarında\b[\s\S]{0,80}\bdönüyoruz\b/iu.test(
        previousLine,
      )
    ) {
      return "row";
    }

    expectedPreviousNumber = previousStart - 1;

    if (expectedPreviousNumber < 1) break;
  }

  return "round";
};

/**
 * The one authority for a course-count unit (row or round) at `position` in
 * `sourceContext`. Every row/round decision in the normalizer, the style
 * normalizer and the validator asks a resolver; callers that pass none get
 * `legacyCourseUnitResolver`, the existing numbered-instruction inference, so
 * behavior is unchanged. A later layer can supply another resolver without
 * this module depending on it.
 */
export type CourseUnitResolver = (sourceContext: string, position: number) => CrochetCountUnit;

export const legacyCourseUnitResolver: CourseUnitResolver = inferCrochetCountUnitAtSourcePosition;

export const normalizeRoundCountTrailingActionSourceSpans = (
  source: string,
  stitchNotation: "x" | "sc",
  sourceContext: string = source,
  sourceOffset = 0,
  resolveCourseUnit: CourseUnitResolver = legacyCourseUnitResolver,
): string => {
  const spans = scanRoundCountTrailingActionSourceSpans(source);
  let normalized = source;

  for (const span of [...spans].reverse()) {
    normalized =
      normalized.slice(0, span.start) +
      renderEnglishRoundCountTrailingActionSpan(
        span,
        stitchNotation,
        resolveCourseUnit(
          sourceContext,
          sourceOffset + span.start,
        ),
      ) +
      normalized.slice(span.end);
  }

  return normalized;
};

export const renderEnglishRoundCountYarnCutSpan = (
  source: RoundCountYarnCutSourceSpan,
  stitchNotation: "x" | "sc",
  unit: CrochetCountUnit = "round",
  /** Marks deterministic English for the normalizer's carrier; identity elsewhere. */
  carry: (text: string) => string = (text) => text,
): string => {
  const unitWord = crochetCountUnitWord(source.rounds, unit);
  return `${source.prefix}${source.stitches}${stitchNotation} ${carry("for")} ${source.rounds} ${carry(`${unitWord} — cut the yarn.`)}${source.suffix}`;
};

export const normalizeRoundCountYarnCutSourceSpans = (
  source: string,
  stitchNotation: "x" | "sc",
  sourceContext: string = source,
  sourceOffset = 0,
  resolveCourseUnit: CourseUnitResolver = legacyCourseUnitResolver,
): string => {
  const spans = scanRoundCountYarnCutSourceSpans(source);
  let normalized = source;
  for (const span of [...spans].reverse()) {
    normalized =
      normalized.slice(0, span.start) +
      renderEnglishRoundCountYarnCutSpan(
        span,
        stitchNotation,
        resolveCourseUnit(
          sourceContext,
          sourceOffset + span.start,
        ),
      ) +
      normalized.slice(span.end);
  }
  return normalized;
};

export const splitLogicalLines = (source: string): LogicalLine[] => {
  const lines: LogicalLine[] = [];
  let start = 0;

  while (start <= source.length) {
    let end = start;
    while (
      end < source.length &&
      source[end] !== "\r" &&
      source[end] !== "\n"
    ) {
      end += 1;
    }

    let separator = "";
    if (end < source.length) {
      separator = source[end] ?? "";
      if (separator === "\r" && source[end + 1] === "\n") {
        separator = "\r\n";
      }
    }

    lines.push({ text: source.slice(start, end), start, end, separator });

    if (end >= source.length) break;
    start = end + separator.length;
  }

  return lines;
};

export const normalizeBareRoundCountSourceLines = (
  source: string,
  stitchNotation: "x" | "sc",
  sourceContext: string = source,
  sourceOffset = 0,
  resolveCourseUnit: CourseUnitResolver = legacyCourseUnitResolver,
): string =>
  splitLogicalLines(source)
    .map((line) => {
      const parsed = parseBareRoundCountSourceLine(line.text);
      const text = parsed
        ? renderEnglishBareRoundCountLine(
            parsed,
            stitchNotation,
            resolveCourseUnit(
              sourceContext,
              sourceOffset + line.start,
            ),
          )
        : line.text;
      return text + line.separator;
    })
    .join("");

/** Existing arm-joining sentence structure; unit semantics belong to the resolver. */
export const ARM_JOINING_SOURCE_PATTERN =
  /^(\s*(?:\d+(?:-\d+)?\)\s*)?)(\d+)\s+sıra\s+(\d+)\s*x\s*[,，]\s*[iİ]pimizi\s+kesmeden\s+kol\s+birleştirme\s+ile\s+devam\s+ediyoruz([.]?\s*)$/iu;

/** Existing whole-line written-chain yarn-cut structure (style line rebuild). */
export const WRITTEN_CHAIN_CUT_LINE_PATTERN =
  /^(\s*(?:\d+(?:-\d+)?\)\s*)?)(\d+)\s+sıra\s+(\d+)\s*x\s+bir\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz([.]?\s*)$/iu;

const WRITTEN_CHAIN_CUT_SOURCE_PATTERN =
  /((?:\d+(?:-\d+)?\)\s*)?)(\d+)\s+sıra\s+(\d+)\s*x\s+bir\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz\b/giu;

/** A course-count clause whose unit the resolver decides, as matched in source. */
export type CourseCountClauseSource = {
  start: number;
  end: number;
  prefix: string;
  rounds: string;
  stitches: string;
  suffix: string;
};

/** Written-chain yarn-cut spans anywhere in `source` (the normalizer's scan). */
export const scanWrittenChainCutSourceSpans = (
  source: string,
): CourseCountClauseSource[] =>
  [...source.matchAll(WRITTEN_CHAIN_CUT_SOURCE_PATTERN)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    prefix: match[1] ?? "",
    rounds: match[2] ?? "",
    stitches: match[3] ?? "",
    suffix: "",
  }));

export const renderEnglishWrittenChainCutSpan = (
  source: CourseCountClauseSource,
  unit: CrochetCountUnit,
  /** Marks deterministic English for the normalizer's carrier; identity elsewhere. */
  carry: (text: string) => string = (text) => text,
): string =>
  `${source.prefix}${source.rounds} ${carry(`${crochetCountUnitWord(source.rounds, unit)},`)} ${source.stitches}sc. ${carry("Ch 1 and cut the yarn")}${source.suffix}`;

export const renderEnglishArmJoiningSpan = (
  source: CourseCountClauseSource,
  stitchNotation: "x" | "sc",
  unit: CrochetCountUnit,
  /** Marks deterministic English for the normalizer's carrier; identity elsewhere. */
  carry: (text: string) => string = (text) => text,
): string =>
  `${source.prefix}${source.rounds} ${carry(`${crochetCountUnitWord(source.rounds, unit)},`)} ${source.stitches}${stitchNotation}. ${carry("Without cutting the yarn, continue by joining the arms")}${source.suffix}`;

/**
 * "Mx, K zincir çekip ipimizi kesiyoruz": a compact chain-cut the normalizer
 * renders before the generic course count, so it takes precedence over it.
 */
export const COMPACT_CHAIN_CUT_SOURCE_PATTERN =
  /((?:\d+\)\s*)?)(\d+)\s*x\s*[,，]\s*(\d+)\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz\b/giu;

export const scanCompactChainCutSourceSpans = (
  source: string,
): { start: number; end: number }[] =>
  [...source.matchAll(COMPACT_CHAIN_CUT_SOURCE_PATTERN)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));

const GENERIC_COURSE_COUNT_SOURCE_PATTERN = /\b(\d+)\s+sıra\s+(\d+)\s*x\b/giu;

/** Every generic "N sıra Mx" course count in `source`, as the normalizer matches it. */
export const scanGenericCourseCountSourceSpans = (
  source: string,
): CourseCountClauseSource[] =>
  [...source.matchAll(GENERIC_COURSE_COUNT_SOURCE_PATTERN)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    prefix: "",
    rounds: match[1] ?? "",
    stitches: match[2] ?? "",
    suffix: "",
  }));

/** "N rows, Mx": the generic course count, unit decided by the caller's resolver. */
export const renderEnglishGenericCourseCountSpan = (
  source: CourseCountClauseSource,
  stitchNotation: "x" | "sc",
  unit: CrochetCountUnit,
  /** Marks deterministic English for the normalizer's carrier; identity elsewhere. */
  carry: (text: string) => string = (text) => text,
): string =>
  `${source.prefix}${source.rounds} ${carry(`${crochetCountUnitWord(source.rounds, unit)},`)} ${source.stitches}${stitchNotation}${source.suffix}`;

const WORKED_CHAIN_CUT_SOURCE_PATTERN =
  /((?:\d+(?:-\d+)?\)\s*)?)(\d+)\s+sıra\s+(\d+)\s*x\s+örüyoruz\s*,\s*(\d+)\s+zincir\s+çekip\s+ipimizi\s+kesiyoruz\b/giu;

export type WorkedChainCutSource = CourseCountClauseSource & { chains: string };

/** "N sıra Mx örüyoruz, K zincir çekip ipimizi kesiyoruz" spans anywhere in `source`. */
export const scanWorkedChainCutSourceSpans = (
  source: string,
): WorkedChainCutSource[] =>
  [...source.matchAll(WORKED_CHAIN_CUT_SOURCE_PATTERN)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    prefix: match[1] ?? "",
    rounds: match[2] ?? "",
    stitches: match[3] ?? "",
    chains: match[4] ?? "",
    suffix: "",
  }));

export const renderEnglishWorkedChainCutSpan = (
  source: WorkedChainCutSource,
  unit: CrochetCountUnit,
  /** Marks deterministic English for the normalizer's carrier; identity elsewhere. */
  carry: (text: string) => string = (text) => text,
): string =>
  `${source.prefix}${source.rounds} ${carry(`${crochetCountUnitWord(source.rounds, unit)},`)} ${source.stitches} ${carry("sc. Ch")} ${source.chains} ${carry("and cut the yarn")}${source.suffix}`;

/** Parses one whole line with a line-anchored clause pattern (arm-joining, written-chain). */
export const parseCourseCountClauseLine = (
  pattern: RegExp,
  line: string,
): CourseCountClauseSource | undefined => {
  const match = pattern.exec(line);
  if (!match) return undefined;
  return {
    start: 0,
    end: line.length,
    prefix: match[1] ?? "",
    rounds: match[2] ?? "",
    stitches: match[3] ?? "",
    suffix: match[4] ?? "",
  };
};
