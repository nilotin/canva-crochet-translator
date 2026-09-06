import type { TargetLanguage } from "../types.js";

export type RoundReference = {
  source: string;
  start: number;
  end: number;
  number: string;
  relation: "round" | "in" | "from" | "of";
  loop?: "FLO" | "BLO";
};

// Only the crochet-specific sıra construction, never generic ordinals/decimals.
const roundPattern =
  /(?<![\p{L}\p{N}_.,])(\d+)\.[ \t]*sıra(nın|dan|da)?(?!\p{L})/giu;
const loopPattern =
  /^[ \t]+(FLO|BLO)[ \t]*[’'ʼ]?[ \t]*(sundan|sından|su|sı|dan|den)(?!\p{L})/iu;

export const extractRoundReferences = (source: string): RoundReference[] =>
  [...source.matchAll(roundPattern)].map((match) => {
    const suffix = (match[2] ?? "").toLocaleLowerCase("tr-TR");
    let end = match.index + match[0].length;
    const candidate =
      suffix === "nın" ? loopPattern.exec(source.slice(end)) : null;
    // A relative clause describes stitches worked in a loop, not necessarily
    // the loop now being used. Leave that clause to sentence translation.
    const nestedClause =
      candidate &&
      /^[ \t]+ördüğümüz(?!\p{L})/iu.test(
        source.slice(end + candidate[0].length),
      );
    const loop =
      candidate && !nestedClause
        ? (candidate[1]?.toUpperCase() as "FLO" | "BLO")
        : undefined;
    if (loop && candidate) end += candidate[0].length;
    return {
      source: source.slice(match.index, end),
      start: match.index,
      end,
      number: match[1] ?? "",
      relation:
        suffix === "da"
          ? "in"
          : suffix === "dan"
            ? "from"
            : suffix === "nın"
              ? "of"
              : "round",
      ...(loop ? { loop } : {}),
    };
  });

export const renderRoundReference = (
  reference: Pick<RoundReference, "number" | "relation" | "loop">,
  targetLanguage: TargetLanguage,
): string => {
  const round = `${targetLanguage === "en" ? "Round" : "Vuelta"} ${reference.number}`;
  if (reference.loop)
    return targetLanguage === "en"
      ? `the ${reference.loop} of ${round}`
      : `${reference.loop === "FLO" ? "Flo" : "Blo"} de la ${round}`;
  if (reference.relation === "in")
    return `${targetLanguage === "en" ? "in" : "en la"} ${round}`;
  if (reference.relation === "from")
    return `${targetLanguage === "en" ? "from" : "desde la"} ${round}`;
  return round;
};

export const validateRoundReferences = (
  source: string,
  translated: string,
  targetLanguage: TargetLanguage,
) => {
  const references = extractRoundReferences(source);
  if (!references.length) return [];
  const roundWord = targetLanguage === "en" ? "Round" : "Vuelta";
  const actual = [
    ...translated.matchAll(
      new RegExp(`\\b${roundWord}\\s+(\\d+)(?!\\d|[.,]\\d)`, "giu"),
    ),
  ].map((match) => match[1]);
  const validNumbers =
    references.length === actual.length &&
    references.every((reference, i) => reference.number === actual[i]);
  // Check a local grammatical relation, allowing common alternatives around
  // it (attach to / work into / from / in) rather than fixing sentence order.
  const expectedLoops = references.filter(({ loop }) => loop);
  const relationPattern =
    targetLanguage === "en"
      ? /\b(FLO|BLO)\s+(?:of|in|from|on)\s+(?:the\s+)?Round\s+(\d+)(?!\d|[.,]\d)/gu
      : /\b(Flo|Blo)\s+de\s+la\s+Vuelta\s+(\d+)(?!\d|[.,]\d)/gu;
  const actualLoops = [...translated.matchAll(relationPattern)];
  const validLoops =
    !expectedLoops.length ||
    (expectedLoops.length === actualLoops.length &&
      expectedLoops.every(
        (reference, index) =>
          reference.loop === actualLoops[index]?.[1]?.toUpperCase() &&
          reference.number === actualLoops[index]?.[2],
      ));
  const malformed =
    targetLanguage === "en" &&
    /\b\d+(?:the\s+round|(?:st|nd|rd|th)\s+round\s+(?:FLO|BLO))\b|\bRound\s+\d+[’']s\s+(?:FLO|BLO)\b/iu.test(
      translated,
    );
  return validNumbers && validLoops && !malformed
    ? []
    : [
        {
          code: "ROUND_REFERENCE_MISMATCH" as const,
          message:
            "The round reference lost its number or FLO/BLO relationship, or contains malformed ordinal phrasing.",
        },
      ];
};
