import { formatNaturalLanguageGlossary } from "./glossary.js";
import type { TargetLanguage, TranslationBlock } from "./types.js";

const TARGET_NAMES: Record<TargetLanguage, string> = {
  en: "English",
  es: "Spanish",
};

const STYLE_PREFERENCES: Record<TargetLanguage, string> = {
  en: `- For “zn çekiyoruz”, prefer concise crochet style such as “Ch 55.” or “Chain 55.” Avoid “work/pull out 55 ch”.
- Translate Turkish “sıra” and its inflected forms as “round” or “rounds”, never “row” or “rows”.
- For “FLO örüyoruz.” prefer “Work in FLO.”
- For “BLO örüyoruz.” prefer “Work in BLO.”
- In reverse single crochet technique explanations, when “ters yüz” and “düz yüz” describe the visible backs and fronts of the single crochet stitches, use “the back of the stitches” and “the front of the stitches”. Do not use “wrong side” or “right side” in this context.`,
  es: `- Translate “sabitlemek” with natural verbs such as “asegurar”, “fijar”, “unir”, or “rematar”. Never invent “securizar”.
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
${STYLE_PREFERENCES[targetLanguage]}${contentKind === "materials" && targetLanguage === "en" ? ENGLISH_MATERIALS_PREFERENCES : ""}${roundReferences.length ? "\nProtected round-reference meanings are supplied as context. Place each placeholder as that complete phrase, adding only the surrounding grammar needed. Return the placeholder itself, never repeat or expand its meaning." : ""}${materialQuantityGrammar.length ? "\nMaterials quantity grammar identifies a quantity by its 1-based position among all protected tokens in its block. Use the supplied singular or plural agreement for the item noun. This metadata never replaces a token: return every protected token from the block exactly once and do not render its numeric value yourself." : ""}`,
  user: JSON.stringify({
    sourceLanguage: "tr",
    targetLanguage,
    blocks,
    ...(roundReferences.length ? { roundReferences } : {}),
    ...(materialQuantityGrammar.length ? { materialQuantityGrammar } : {}),
  }),
});

export const buildMixedSpanPrompt = (
  targetLanguage: TargetLanguage,
  sourceContext: string,
  spans: readonly TranslationBlock[],
) => ({
  system: `Translate only the supplied Turkish natural-language spans into ${TARGET_NAMES[targetLanguage]} for a crochet or amigurumi pattern.

The application reconstructs all numbers, crochet notation, punctuation, markers, and whitespace deterministically. They are read-only context and must not appear in a translated span unless they occur inside that span.

Return exactly one translation for every span ID. Map by ID. Do not merge, split, omit, duplicate, or invent spans. Each translated value must contain only the translation of that span, never the full reconstructed instruction.

Contextual natural-language preferences (use according to context):
${formatNaturalLanguageGlossary(targetLanguage)}

Target-language crochet style preferences:
${STYLE_PREFERENCES[targetLanguage]}`,
  user: JSON.stringify({
    sourceLanguage: "tr",
    targetLanguage,
    proseContext: sourceContext,
    spans,
  }),
});
