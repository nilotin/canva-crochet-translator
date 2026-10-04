import { formatNaturalLanguageGlossary } from "./glossary.js";
import type { TargetLanguage, TranslationBlock } from "./types.js";

const TARGET_NAMES: Record<TargetLanguage, string> = {
  en: "English",
  es: "Spanish",
};

/**
 * The course unit the resolver already decided for the text of one provider
 * call (Beta Blocker #2). Omitted: no line of the call resolved to row, and
 * the existing round guidance applies unchanged. "row": every line of the
 * call is worked in rows. Otherwise the rows are listed by span ID (mixed
 * prose spans) or by 1-based line number (one whole block), so a call that
 * mixes units never gets one rule that contradicts part of it.
 */
export type CourseUnitGuidance =
  | { readonly kind: "row" }
  // Some line is a row but the call's lines cannot be matched to it: neutral.
  | { readonly kind: "context" }
  | { readonly kind: "spans"; readonly rowSpanIds: readonly string[] }
  | { readonly kind: "lines"; readonly rowLines: readonly number[] };

const ROUND_GUIDANCE = "- Translate Turkish “sıra” and its inflected forms as “round” or “rounds”, never “row” or “rows”.";

const courseUnitGuidance = (guidance: CourseUnitGuidance | undefined): string => {
  if (guidance === undefined) return ROUND_GUIDANCE;
  if (guidance.kind === "row") {
    return "- This part of the pattern is worked in turned rows: translate Turkish “sıra” and its inflected forms as “row” or “rows”, never “round” or “rounds”.";
  }
  if (guidance.kind === "context") {
    return "- Part of this text is worked in turned rows: translate Turkish “sıra” and its inflected forms as “row” or “rows” where the work is turned in rows and as “round” or “rounds” where it is worked in rounds. Keep any “row” or “round” wording already present.";
  }
  return guidance.kind === "spans"
    ? "- The spans listed in courseUnits.rowSpanIds are worked in turned rows: translate Turkish “sıra” and its inflected forms there as “row” or “rows”. In every other span translate it as “round” or “rounds”."
    : "- The lines listed in courseUnits.rowLines (1-based) are worked in turned rows: translate Turkish “sıra” and its inflected forms there as “row” or “rows”. On every other line translate it as “round” or “rounds”.";
};

const STYLE_PREFERENCES: Record<TargetLanguage, (guidance?: CourseUnitGuidance) => string> = {
  en: (guidance) => `- For “zn çekiyoruz”, prefer concise crochet style such as “Ch 55.” or “Chain 55.” Avoid “work/pull out 55 ch”.
${courseUnitGuidance(guidance)}
- For “FLO örüyoruz.” prefer “Work in FLO.”
- For “BLO örüyoruz.” prefer “Work in BLO.”
- In reverse single crochet technique explanations, when “ters yüz” and “düz yüz” describe the visible backs and fronts of the single crochet stitches, use “the back of the stitches” and “the front of the stitches”. Do not use “wrong side” or “right side” in this context.`,
  es: () => `- Translate “sabitlemek” with natural verbs such as “asegurar”, “fijar”, “unir”, or “rematar”. Never invent “securizar”.
- For “zn çekiyoruz”, prefer concise crochet style such as “Haz 55 cad.” or “Teje 55 cad.” Never write “cad puntos”.
- For “FLO örüyoruz.” prefer “Tejemos en Flo.”
- For “BLO örüyoruz.” prefer “Tejemos en Blo.”`,
};

const ENGLISH_MATERIALS_PREFERENCES = `

Materials-list preferences:
- Render each line as a concise, natural materials-list entry rather than following Turkish word order literally.
- Put the quantity before the item and use singular nouns only for a quantity of exactly 1; use plural nouns for other quantities. For example: “1 button”, “2 buttons”, “1 skein”, “2 skeins”, and “1 eye”.
- Put purpose or placement after the item. Prefer “2 metal buttons for the pants” to “For the pants 2 metal buttons”.
- For yarn entries, prefer a consistent form such as “2 skeins of Catania TR263 - skin color” or “1 skein of Catania 226 - lilac”.
- Preserve product and brand names, model or color codes, quantities, measurements, bullet markers, and line structure exactly; do not merge or reorder list entries.`;

export const buildTranslationPrompt = (
  targetLanguage: TargetLanguage,
  blocks: readonly TranslationBlock[],
  roundReferences: readonly { placeholder: string; meaning: string }[] = [],
  contentKind: "pattern" | "materials" = "pattern",
  materialQuantityGrammar: readonly {
    blockId: string;
    protectedTokenIndex: number;
    agreement: "singular" | "plural";
  }[] = [],
  courseUnits?: CourseUnitGuidance,
) => ({
  system: `Translate Turkish crochet and amigurumi pattern instructions into ${TARGET_NAMES[targetLanguage]} for this project.

Project-specific crochet notation, numeric literals, and pattern structure have already been replaced with protected tokens such as __XQ…QX__. You are not responsible for understanding or converting those tokens.

Success criteria:
- Treat every input block as an independent Canva text box. Return exactly one translation for every block ID. Never merge, split, reorder, omit, or invent blocks.
- Reproduce every __XQ…QX__-style token exactly. Never translate, rename, delete, duplicate, or reorder a protected token.
- Translate only the surrounding natural-language content.
- Some recognized count, spacing, or placement phrases may already appear in ${TARGET_NAMES[targetLanguage]}. Preserve their meaning and incorporate them naturally; do not translate them back into Turkish shorthand.
- Preserve every integer and decimal value, measurement, row or round number, parenthesis, multiplication/repetition structure, and * repetition symbol exactly.
- Preserve line breaks, numbered prefixes, bullet symbols such as ✦, structural punctuation, and pattern sequences whenever possible.
- Do not create new paragraphs unnecessarily.
- Translate surrounding natural language concisely and naturally. Never summarize, omit, or invent instructions.

Contextual natural-language preferences (use according to context):
${formatNaturalLanguageGlossary(targetLanguage)}

Target-language crochet style preferences:
${STYLE_PREFERENCES[targetLanguage](courseUnits)}${contentKind === "materials" && targetLanguage === "en" ? ENGLISH_MATERIALS_PREFERENCES : ""}${roundReferences.length ? "\nProtected round-reference meanings are supplied as context. Place each placeholder as that complete phrase, adding only the surrounding grammar needed. Return the placeholder itself, never repeat or expand its meaning." : ""}${materialQuantityGrammar.length ? "\nMaterials quantity grammar identifies a quantity by its 1-based position among all protected tokens in its block. Use the supplied singular or plural agreement for the item noun. This metadata never replaces a token: return every protected token from the block exactly once and do not render its numeric value yourself." : ""}`,
  user: JSON.stringify({
    sourceLanguage: "tr",
    targetLanguage,
    blocks,
    ...(roundReferences.length ? { roundReferences } : {}),
    ...(materialQuantityGrammar.length ? { materialQuantityGrammar } : {}),
    ...(courseUnits?.kind === "lines" ? { courseUnits: { rowLines: courseUnits.rowLines } } : {}),
  }),
});

export const buildMixedSpanPrompt = (
  targetLanguage: TargetLanguage,
  sourceContext: string,
  spans: readonly TranslationBlock[],
  courseUnits?: CourseUnitGuidance,
) => ({
  system: `Translate only the supplied Turkish natural-language spans into ${TARGET_NAMES[targetLanguage]} for a crochet or amigurumi pattern.

The application reconstructs all numbers, crochet notation, punctuation, markers, and whitespace deterministically. They are read-only context and must not appear in a translated span unless they occur inside that span.

Return exactly one translation for every span ID. Map by ID. Do not merge, split, omit, duplicate, or invent spans. Each translated value must contain only the translation of that span, never the full reconstructed instruction.

Contextual natural-language preferences (use according to context):
${formatNaturalLanguageGlossary(targetLanguage)}

Target-language crochet style preferences:
${STYLE_PREFERENCES[targetLanguage](courseUnits)}`,
  user: JSON.stringify({
    sourceLanguage: "tr",
    targetLanguage,
    proseContext: sourceContext,
    spans,
    ...(courseUnits?.kind === "spans" ? { courseUnits: { rowSpanIds: courseUnits.rowSpanIds } } : {}),
  }),
});
