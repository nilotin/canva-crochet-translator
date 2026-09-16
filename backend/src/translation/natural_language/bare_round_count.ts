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
