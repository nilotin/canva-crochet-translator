import type { PageReview, ReviewBlock } from "./translation_review";

export const INTEGRITY_BLOCK_CODES = new Set([
  "EMPTY_TRANSLATION",
  "MISSING_TRANSLATION",
  "NUMBER_MISMATCH",
  "REPETITION_COUNT_MISMATCH",
  "LOST_PATTERN_NOTATION",
  "MISSING_TARGET_NOTATION_MAPPING",
  "PARENTHESES_MISMATCH",
  "DUPLICATE_RETURNED_BLOCK_ID",
  "MISSING_RETURNED_BLOCK_ID",
  "UNEXPECTED_RETURNED_BLOCK_ID",
  "MISSING_PROTECTED_NOTATION",
  "DUPLICATE_PROTECTED_NOTATION",
  "UNEXPECTED_PROTECTED_NOTATION",
  "MUTATED_PROTECTED_NOTATION",
  "REORDERED_PROTECTED_NOTATION",
  "UNSAFE_SEGMENTATION_BOUNDARY",
  "INTERNAL_MIXED_LEXER_ERROR",
  "FORMATTING_MAPPING_REQUIRED",
]);

export const hasIntegrityDiagnostic = (block: ReviewBlock): boolean =>
  [...block.errors, ...block.warnings].some(({ code }) =>
    INTEGRITY_BLOCK_CODES.has(code),
  );

export const normalizeReviewBlockSeverity = (
  block: ReviewBlock,
): ReviewBlock => {
  const misplacedIntegrityWarnings = block.warnings.filter(({ code }) =>
    INTEGRITY_BLOCK_CODES.has(code),
  );
  const warnings = block.warnings.filter(
    ({ code }) => !INTEGRITY_BLOCK_CODES.has(code),
  );
  const errors = [...block.errors, ...misplacedIntegrityWarnings];
  return {
    ...block,
    errors,
    warnings,
    validation:
      block.validation === "BLOCK" || errors.length > 0
        ? "BLOCK"
        : warnings.length > 0 || block.validation === "WARNING"
          ? "WARNING"
          : "PASS",
  };
};

export const normalizePageReviewSeverity = (review: PageReview): PageReview => {
  const blocks = review.blocks.map(normalizeReviewBlockSeverity);
  return {
    blocks,
    reviewStatus: blocks.some(({ validation }) => validation === "BLOCK")
      ? "blocked"
      : blocks.some(({ validation }) => validation === "WARNING")
        ? "needs_review"
        : "ready",
  };
};

export const hasBlockingReviewIntegrity = (review: PageReview): boolean =>
  review.blocks.some(
    (block) => block.validation === "BLOCK" || hasIntegrityDiagnostic(block),
  );
