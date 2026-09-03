export const HIGH_RISK_INSTRUCTION_CONCEPTS = [
  "üst",
  "alt",
  "iç",
  "dış",
  "ön",
  "arka",
  "giriş",
  "çıkış",
  "girmek",
  "çıkmak",
  "göz",
  "sıra",
  "karşı",
] as const;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "bir üst sıraya geçiyoruz" / "bir alt sıraya geçiyoruz" is the ordinary
// Turkish crochet idiom for moving to the next row up or down. It reads as
// a single row-transition instruction, not a claim that one piece sits
// spatially above/below another -- "move to the next row" is a complete,
// faithful translation of it even though that phrase says neither "üst"/
// "alt" nor "above"/"below". This is shared by findHighRiskInstructionConcepts
// below (so the idiom doesn't inflate the spatial-concept count) and by
// semantic_anchors.ts (so the idiom doesn't require a literal "above"/
// "upper"/"below" match in the translation) -- keeping one definition
// avoids the two checks drifting apart on what counts as the idiom.
const ROW_TRANSITION_IDIOM = /(?:üst|alt)\p{L}*\s+sıra\p{L}*/giu;

export const stripRowTransitionIdiom = (text: string): string =>
  text.replace(ROW_TRANSITION_IDIOM, "");

export const findHighRiskInstructionConcepts = (source: string): string[] => {
  const normalized = source.toLocaleLowerCase("tr-TR");
  return HIGH_RISK_INSTRUCTION_CONCEPTS.filter((concept) => {
    if (
      concept === "ön" &&
      /(?<!\p{L})önlü[kğ]\p{L}*(?!\p{L})/iu.test(normalized)
    ) {
      const withoutApron = normalized.replace(
        /(?<!\p{L})önlü[kğ]\p{L}*(?!\p{L})/giu,
        "",
      );

      return new RegExp(
        `(?<!\\p{L})${escapeRegExp(concept)}\\p{L}*(?!\\p{L})`,
        "iu",
      ).test(withoutApron);
    }

    if (
      concept === "üst" &&
      /zincir\s+üst\p{L}*/iu.test(normalized)
    ) {
      const withoutChainSurface = normalized.replace(
        /zincir\s+üst\p{L}*/giu,
        "",
      );

      return new RegExp(
        `(?<!\\p{L})${escapeRegExp(concept)}\\p{L}*(?!\\p{L})`,
        "iu",
      ).test(withoutChainSurface);
    }

    // Counting "sıra" here on top of "üst"/"alt" pushed nearly every
    // ordinary row-transition idiom ("bir üst sıraya geçiyoruz") over the
    // combine-two-concepts threshold and blocked otherwise-safe
    // translations such as "move to the next row". This exclusion only
    // removes a directly adjacent "üst sıra"/"alt sıra" occurrence, so a
    // genuinely distinct spatial pattern elsewhere in the same sentence
    // (e.g. the eye-relative "gözden 4 sıra üzerinden", where "sıra" is
    // not adjacent to üst/alt) still counts normally.
    if (concept === "sıra") {
      // stripRowTransitionIdiom uses .replace(), which resets lastIndex
      // internally and is safe to call repeatedly on a shared, global-
      // flagged regex; calling .test() directly on the same shared
      // ROW_TRANSITION_IDIOM constant would not be, since .test()
      // advances and retains lastIndex across calls. Comparing the
      // stripped text against the original avoids that trap entirely.
      const withoutRowTransitionIdiom = stripRowTransitionIdiom(normalized);
      if (withoutRowTransitionIdiom !== normalized) {
        return new RegExp(
          `(?<!\\p{L})${escapeRegExp(concept)}\\p{L}*(?!\\p{L})`,
          "iu",
        ).test(withoutRowTransitionIdiom);
      }
    }

    return new RegExp(
      `(?<!\\p{L})${escapeRegExp(concept)}\\p{L}*(?!\\p{L})`,
      "iu",
    ).test(normalized);
  });
};
