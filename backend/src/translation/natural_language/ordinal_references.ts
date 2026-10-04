/**
 * Numbered chain and stitch references (Beta Blocker #3): "3. zincirden" is
 * the 3rd chain, "7. sık iğneye" the 7th single crochet. The number belongs to
 * the noun, never to an instruction marker or a stitch count.
 *
 * Production recognizer, like `extractRoundReferences` for "N. sıra": an
 * integer, a period, at most one same-line space/tab run and one exact
 * case-marked head word, nothing more. The head decides the target and the
 * case decides the relation (ablative "-den" = from, dative "-e" = to). The
 * typed N. classifier's `ordinal_reference` decision mirrors this lexicon;
 * its shadow tests pin that both agree.
 *
 * Only evidenced heads are listed (corpus, captures, tests): "zincirden",
 * "zincire", "sık iğneye", "sık iğneden" (as in "ilk sık iğneden"), "ilmeğe".
 * The bare nominative "zincir" is never one: "N. zincir çekip" makes chains.
 */
export type OrdinalTarget = "chain" | "single_crochet" | "stitch";
export type OrdinalRelation = "from" | "to";

export type OrdinalReference = {
  /** From the number to the end of the head noun, e.g. `7. sık iğneye`. */
  readonly source: string;
  readonly start: number;
  readonly end: number;
  readonly number: string;
  readonly target: OrdinalTarget;
  readonly relation: OrdinalRelation;
};

const HEADS: ReadonlyMap<string, { target: OrdinalTarget; relation: OrdinalRelation }> = new Map([
  ["zincirden", { target: "chain", relation: "from" }],
  ["zincire", { target: "chain", relation: "to" }],
  ["sık iğneden", { target: "single_crochet", relation: "from" }],
  ["sık iğneye", { target: "single_crochet", relation: "to" }],
  ["ilmeğe", { target: "stitch", relation: "to" }],
]);

// Not glued on the left (like round references); one same-line space/tab run
// at most; an exact head; the head ends the word.
const ordinalPattern =
  /(?<![\p{L}\p{N}_.,])(\d+)\.[ \t]*(zincirden|zincire|sık[ \t]+iğneden|sık[ \t]+iğneye|ilmeğe)(?![\p{L}\p{N}_])/gu;

export const extractOrdinalReferences = (source: string): OrdinalReference[] =>
  [...source.matchAll(ordinalPattern)].flatMap((match) => {
    const head = HEADS.get((match[2] ?? "").replace(/[ \t]+/gu, " "));
    if (!head) return [];
    return [{
      source: match[0],
      start: match.index,
      end: match.index + match[0].length,
      number: match[1] ?? "",
      ...head,
    }];
  });
