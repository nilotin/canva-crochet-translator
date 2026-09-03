import type {
  TargetLanguage,
  ValidationCode,
  ValidationDiagnostic,
  WarningCode,
} from "../types.js";
import {
  findHighRiskInstructionConcepts,
  stripRowTransitionIdiom,
} from "../review_risk.js";

type SemanticAnchor = {
  id: string;
  source: RegExp;
  en: readonly string[];
  es: readonly string[];
  meaning: string;
};

// Missing anchors become blocking only when the source combines multiple
// spatial concepts. A single anchor produces a conservative review warning.
const SEMANTIC_ANCHORS: readonly SemanticAnchor[] = [
  {
    id: "eyebrow",
    source: /(?<!\p{L})kaş\p{L}*/iu,
    en: ["eyebrow"],
    es: ["ceja"],
    meaning: "eyebrow reference",
  },
  {
    id: "above-eye-placement",
    source: /gözden\s+\d+\s+sıra\s+üzerinden/iu,
    en: ["above"],
    es: ["encima", "superior", "arriba"],
    meaning: "above-eye relationship",
  },
  {
    id: "row-placement",
    source: /gözden\s+\d+\s+sıra\s+üzerinden/iu,
    en: ["row"],
    es: ["fila"],
    meaning: "row placement",
  },
  {
    id: "upper",
    source: /(?<!zincir )(?<!\p{L})üst\p{L}*/iu,
    en: ["above", "upper", "top"],
    es: ["encima", "superior", "arriba"],
    meaning: "upper/above placement",
  },
  {
    id: "lower",
    source: /(?<!\p{L})alt\p{L}*/iu,
    en: ["below", "lower", "bottom", "under", "beneath"],
    es: ["debajo", "inferior", "abajo"],
    meaning: "lower/below placement",
  },
  {
    id: "front",
    source: /(?<!\p{L})ön(?!lü[kğ])\p{L}*/iu,
    en: ["front"],
    es: ["frontal", "delante"],
    meaning: "front placement",
  },
  {
    id: "back",
    source: /(?<!\p{L})arka\p{L}*/iu,
    en: ["back"],
    es: ["trasera", "detrás", "atras", "atrás"],
    meaning: "back placement",
  },
  {
    id: "eye",
    source: /(?<!\p{L})göz\p{L}*/iu,
    en: ["eye"],
    es: ["ojo"],
    meaning: "eye reference",
  },
] as const;

export type SemanticAnchorValidation = {
  errors: ValidationDiagnostic<ValidationCode>[];
  warnings: ValidationDiagnostic<WarningCode>[];
};

export const validateSemanticAnchors = (
  source: string,
  translated: string,
  targetLanguage: TargetLanguage,
): SemanticAnchorValidation => {
  const errors: ValidationDiagnostic<ValidationCode>[] = [];
  const warnings: ValidationDiagnostic<WarningCode>[] = [];
  const translatedLower = translated.toLocaleLowerCase(
    targetLanguage === "es" ? "es" : "en",
  );
  const criticalPlacement = findHighRiskInstructionConcepts(source).length >= 2;

  for (const anchor of SEMANTIC_ANCHORS) {
    // "bir üst sıraya geçiyoruz" / "bir alt sıraya geçiyoruz" is the
    // ordinary row-transition idiom (see stripRowTransitionIdiom):
    // "move to the next row" is a complete, faithful translation of it
    // even though it says neither "üst"/"alt" nor "above"/"below". The
    // "upper"/"lower" anchors must not demand a literal above/below/upper
    // term for that occurrence specifically -- but a genuinely separate
    // "üst"/"alt" occurrence elsewhere in the same text (not part of the
    // idiom) must still be checked normally, so only the idiom text is
    // stripped before testing, not the whole anchor skipped outright.
    const anchorSource =
      anchor.id === "upper" || anchor.id === "lower"
        ? stripRowTransitionIdiom(source)
        : source;
    if (!anchor.source.test(anchorSource)) continue;
    const targetTerms = anchor[targetLanguage];
    if (targetTerms.some((term) => translatedLower.includes(term))) continue;

    const item = {
      code: "SEMANTIC_ANCHOR_MISSING" as const,
      message: `Translation may have lost the critical ${anchor.meaning}.`,
    };
    if (criticalPlacement) errors.push(item);
    else warnings.push(item);
  }

  return { errors, warnings };
};
