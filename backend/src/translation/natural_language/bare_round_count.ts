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
  roundWord: "round" | "rounds";
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
  roundWord: "round" | "rounds";
};

export type LogicalLine = {
  text: string;
  start: number;
  end: number;
  separator: string;
};

const SOURCE_LINE_PATTERN =
  /^([\t ]*(?:(\d+(?:-\d+)?)\)[\t ]*)?)(\d+)[\t ]+sıra[\t ]+(\d+)[\t ]*x([.]?[\t ]*)$/iu;

const TARGET_LINE_PATTERN =
  /^([\t ]*(?:(\d+(?:-\d+)?)\)[\t ]*)?)(\d+)sc[\t ]+for[\t ]+(\d+)[\t ]+(round|rounds)([.]?[\t ]*)$/iu;

const ROUND_COUNT_YARN_CUT_SOURCE_PATTERN =
  /(?<![\p{L}\p{N}_])((?:(\d+(?:-\d+)?)\)[\t ]*)?)(\d+)[\t ]+sıra[\t ]+(\d+)[\t ]*x[\t ]*(?:-+|–|—|,|;)[\t ]*[iİ]pimizi[\t ]+kesiyoruz(?:\.(?:([\t ]+)(?=\S)|([\t ]*)(?=$|[\r\n]))|([\t ]*)(?=$|[\r\n]))/dgimu;

const ROUND_COUNT_YARN_CUT_TARGET_PATTERN =
  /(?<![\p{L}\p{N}_])((?:(\d+(?:-\d+)?)\)[\t ]*)?)(\d+)sc for (\d+) (round|rounds) — cut the yarn\.(?:([\t ]+)(?=\S)|([\t ]*)(?=$|[\r\n]))/dgmu;

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
    roundWord: (match[5]?.toLocaleLowerCase("en") ?? "round") as
      | "round"
      | "rounds",
    suffix: match[6] ?? "",
  };
};

export const renderEnglishBareRoundCountLine = (
  source: BareRoundCountSourceLine,
  stitchNotation: "x" | "sc",
): string => {
  const roundWord = Number(source.rounds) === 1 ? "round" : "rounds";
  return `${source.prefix}${source.stitches}${stitchNotation} for ${source.rounds} ${roundWord}${source.suffix}`;
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
      roundWord: (match[5] ?? "round") as "round" | "rounds",
      suffix: match[6] ?? match[7] ?? "",
      roundsSpan,
      stitchesSpan,
    }];
  });

export const renderEnglishRoundCountYarnCutSpan = (
  source: RoundCountYarnCutSourceSpan,
  stitchNotation: "x" | "sc",
): string => {
  const roundWord = Number(source.rounds) === 1 ? "round" : "rounds";
  return `${source.prefix}${source.stitches}${stitchNotation} for ${source.rounds} ${roundWord} — cut the yarn.${source.suffix}`;
};

export const normalizeRoundCountYarnCutSourceSpans = (
  source: string,
  stitchNotation: "x" | "sc",
): string => {
  const spans = scanRoundCountYarnCutSourceSpans(source);
  let normalized = source;
  for (const span of [...spans].reverse()) {
    normalized =
      normalized.slice(0, span.start) +
      renderEnglishRoundCountYarnCutSpan(span, stitchNotation) +
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
): string =>
  splitLogicalLines(source)
    .map((line) => {
      const parsed = parseBareRoundCountSourceLine(line.text);
      const text = parsed
        ? renderEnglishBareRoundCountLine(parsed, stitchNotation)
        : line.text;
      return text + line.separator;
    })
    .join("");
