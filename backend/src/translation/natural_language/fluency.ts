import type { TargetLanguage, WarningCode } from "../types.js";
import type { ValidationDiagnostic } from "../types.js";

type FluencyPattern = {
  pattern: RegExp;
  description: string;
};

const SPANISH_FLUENCY_PATTERNS: readonly FluencyPattern[] = [
  { pattern: /\bsecuriz(?:amos|ar)\b/iu, description: "securizar" },
  { pattern: /\bel\s+primer\s+flor\b/iu, description: "el primer flor" },
  { pattern: /\bdesde\s+debajo\b/iu, description: "desde debajo" },
  {
    pattern: /\b(?:chain|crochet|work|secure|attach|fasten)\b/iu,
    description: "an untranslated English crochet verb",
  },
] as const;

export const validateTargetLanguageFluency = (
  translated: string,
  targetLanguage: TargetLanguage,
): ValidationDiagnostic<WarningCode>[] => {
  if (targetLanguage !== "es") return [];

  return SPANISH_FLUENCY_PATTERNS.filter(({ pattern }) =>
    pattern.test(translated),
  ).map(({ description }) => ({
    code: "TARGET_LANGUAGE_FLUENCY_REVIEW",
    message: `Spanish fluency review recommended: detected ${description}.`,
  }));
};
