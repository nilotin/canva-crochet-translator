import { z } from "zod";

export const targetLanguageSchema = z.enum(["en", "es"]);

export const formattingRegionSchema = z.object({
  id: z.string().trim().min(1).max(200),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

export const translationBlockSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    text: z.string().max(20_000),
    formattingRegions: z.array(formattingRegionSchema).optional(),
  })
  .superRefine(({ text, formattingRegions }, context) => {
    for (const [index, region] of (formattingRegions ?? []).entries()) {
      if (region.end < region.start) {
        context.addIssue({
          code: "custom",
          message: "Formatting region end must not be before start.",
          path: ["formattingRegions", index],
        });
      }

      if (region.end > text.length) {
        context.addIssue({
          code: "custom",
          message: "Formatting region exceeds source text length.",
          path: ["formattingRegions", index],
        });
      }
    }
  });

export const translateRequestSchema = z
  .object({
    designToken: z.string().min(1),
    sourceLanguage: z.literal("tr"),
    targetLanguage: targetLanguageSchema,
    blocks: z.array(translationBlockSchema).min(1).max(100),
    templateCandidate: z.literal(true).optional(),
    pageFingerprint: z.string().min(1).max(500).optional(),
  })
  .superRefine(({ blocks, templateCandidate, pageFingerprint }, context) => {
    const hasTemplateCandidate = templateCandidate === true;
    const hasFingerprint = pageFingerprint !== undefined;

    if (hasTemplateCandidate !== hasFingerprint) {
      context.addIssue({
        code: "custom",
        message:
          "templateCandidate and pageFingerprint must be provided together.",
        path: ["pageFingerprint"],
      });
    }

    const ids = new Set<string>();
    for (const block of blocks) {
      if (ids.has(block.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate block ID: ${block.id}`,
          path: ["blocks"],
        });
      }
      ids.add(block.id);
    }
  });

export const modelTranslationSchema = z.object({
  translations: z.array(
    z.object({
      id: z.string(),
      translated: z.string(),
    }),
  ),
});

export type TargetLanguage = z.infer<typeof targetLanguageSchema>;
export type TranslationBlock = z.infer<typeof translationBlockSchema>;
export type TranslateRequest = z.infer<typeof translateRequestSchema>;

export type ValidationCode =
  | "EMPTY_TRANSLATION"
  | "MISSING_TRANSLATION"
  | "NUMBER_MISMATCH"
  | "REPETITION_COUNT_MISMATCH"
  | "LOST_PATTERN_NOTATION"
  | "MISSING_TARGET_NOTATION_MAPPING"
  | "PARENTHESES_MISMATCH"
  | "DUPLICATE_RETURNED_BLOCK_ID"
  | "MISSING_RETURNED_BLOCK_ID"
  | "UNEXPECTED_RETURNED_BLOCK_ID"
  | "MISSING_PROTECTED_NOTATION"
  | "DUPLICATE_PROTECTED_NOTATION"
  | "UNEXPECTED_PROTECTED_NOTATION"
  | "MUTATED_PROTECTED_NOTATION"
  | "REORDERED_PROTECTED_NOTATION"
  | "SEMANTIC_ANCHOR_MISSING"
  | "INTERNAL_MIXED_LEXER_ERROR"
  | "UNSAFE_SEGMENTATION_BOUNDARY";

export type WarningCode =
  | "SUSPICIOUSLY_SHORT_TRANSLATION"
  | "UNUSUALLY_LARGE_EXPANSION"
  | "POSSIBLE_GLOSSARY_MISMATCH"
  | "MANUAL_REVIEW_RECOMMENDED"
  | "SEMANTIC_ANCHOR_MISSING"
  | "TARGET_LANGUAGE_FLUENCY_REVIEW";

export type ValidationDiagnostic<TCode extends string> = {
  code: TCode;
  message: string;
};

export type BlockValidation = {
  valid: boolean;
  errors: ValidationDiagnostic<ValidationCode>[];
  warnings: ValidationDiagnostic<WarningCode>[];
};

export type TargetFormattingRegion = {
  id: string;
  start: number;
  end: number;
};

export type TranslationResult = {
  id: string;
  source: string;
  translated: string;
  valid: boolean;
  errors: ValidationDiagnostic<ValidationCode>[];
  warnings: ValidationDiagnostic<WarningCode>[];
  targetFormattingRegions?: TargetFormattingRegion[];
};
