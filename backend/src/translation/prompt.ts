import { formatNaturalLanguageGlossary } from "./glossary.js";
import type { TargetLanguage, TranslationBlock } from "./types.js";

const TARGET_NAMES: Record<TargetLanguage, string> = {
  en: "English",
  es: "Spanish",
};

const STYLE_PREFERENCES: Record<TargetLanguage, string> = {
  en: `- For “zn çekiyoruz”, prefer concise crochet style such as “Ch 55.” or “Chain 55.” Avoid “work/pull out 55 ch”.
- For “FLO örüyoruz.” prefer “Work in FLO.”
- For “BLO örüyoruz.” prefer “Work in BLO.”`,
  es: `- Translate “sabitlemek” with natural verbs such as “asegurar”, “fijar”, “unir”, or “rematar”. Never invent “securizar”.
- For “zn çekiyoruz”, prefer concise crochet style such as “Haz 55 cad.” or “Teje 55 cad.” Never write “cad puntos”.
- For “FLO örüyoruz.” prefer “Tejemos en Flo.”
- For “BLO örüyoruz.” prefer “Tejemos en Blo.”`,
};

export const buildTranslationPrompt = (
  targetLanguage: TargetLanguage,
  blocks: readonly TranslationBlock[],
) => ({
  system: `Translate Turkish crochet and amigurumi pattern instructions into ${TARGET_NAMES[targetLanguage]} for this project.

Project-specific crochet notation, numeric literals, and pattern structure have already been replaced with protected tokens such as __XQAAAAQX__. You are not responsible for understanding or converting those tokens.

Success criteria:
- Treat every input block as an independent Canva text box. Return exactly one translation for every block ID. Never merge, split, reorder, omit, or invent blocks.
- Reproduce every __XQAAAAQX__-style token exactly. Never translate, rename, delete, duplicate, or reorder a protected token.
- Translate only the surrounding natural-language content.
- Some recognized count, spacing, or placement phrases may already appear in ${TARGET_NAMES[targetLanguage]}. Preserve their meaning and incorporate them naturally; do not translate them back into Turkish shorthand.
- Preserve every integer and decimal value, measurement, row or round number, parenthesis, multiplication/repetition structure, and * repetition symbol exactly.
- Preserve line breaks, numbered prefixes, bullet symbols such as ✦, structural punctuation, and pattern sequences whenever possible.
- Do not create new paragraphs unnecessarily.
- Translate surrounding natural language concisely and naturally. Never summarize, omit, or invent instructions.

Contextual natural-language preferences (use according to context):
${formatNaturalLanguageGlossary(targetLanguage)}

Target-language crochet style preferences:
${STYLE_PREFERENCES[targetLanguage]}`,
  user: JSON.stringify({ sourceLanguage: "tr", targetLanguage, blocks }),
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
