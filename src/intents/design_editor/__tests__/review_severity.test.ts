import {
  hasBlockingReviewIntegrity,
  normalizePageReviewSeverity,
} from "../review_severity";
import type { PageReview } from "../translation_review";

const review = (
  errors: { code: string; message: string }[],
  warnings: { code: string; message: string }[],
): PageReview => ({
  reviewStatus: "needs_review",
  blocks: [
    {
      id: "block-1",
      source: "source",
      translated: "target",
      editedTranslation: "target",
      validation: "WARNING",
      errors,
      warnings,
    },
  ],
});

describe("review diagnostic severity", () => {
  it.each([
    "NUMBER_MISMATCH",
    "LOST_PATTERN_NOTATION",
    "PARENTHESES_MISMATCH",
    "MISSING_PROTECTED_NOTATION",
    "REPETITION_COUNT_MISMATCH",
    "INTERNAL_MIXED_LEXER_ERROR",
  ])("keeps %s at BLOCK severity even if mislabeled as a warning", (code) => {
    const normalized = normalizePageReviewSeverity(
      review(
        [],
        [
          { code, message: "Integrity failure" },
          { code: "MANUAL_REVIEW_RECOMMENDED", message: "Review meaning" },
        ],
      ),
    );
    expect(normalized.reviewStatus).toBe("blocked");
    expect(normalized.blocks[0]?.validation).toBe("BLOCK");
    expect(normalized.blocks[0]?.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code })]),
    );
    expect(hasBlockingReviewIntegrity(normalized)).toBe(true);
  });

  it("aggregates BLOCK above multiple semantic warnings", () => {
    const normalized = normalizePageReviewSeverity(
      review(
        [{ code: "NUMBER_MISMATCH", message: "Segment 1 mismatch" }],
        [
          { code: "MANUAL_REVIEW_RECOMMENDED", message: "Segment 18 review" },
          { code: "POSSIBLE_GLOSSARY_MISMATCH", message: "Check term" },
          { code: "TARGET_LANGUAGE_FLUENCY_REVIEW", message: "Check style" },
        ],
      ),
    );
    expect(normalized.reviewStatus).toBe("blocked");
  });

  it("keeps semantic-only diagnostics acknowledgeable", () => {
    const normalized = normalizePageReviewSeverity(
      review(
        [],
        [{ code: "MANUAL_REVIEW_RECOMMENDED", message: "Review meaning" }],
      ),
    );
    expect(normalized.reviewStatus).toBe("needs_review");
    expect(normalized.blocks[0]?.validation).toBe("WARNING");
    expect(hasBlockingReviewIntegrity(normalized)).toBe(false);
  });

  it("returns ready when no errors or warnings exist", () => {
    const cleanBlock = review([], []).blocks[0];
    expect(cleanBlock).toBeDefined();
    if (!cleanBlock) {
      throw new Error("Expected the review fixture to contain one block");
    }
    const normalized = normalizePageReviewSeverity({
      ...review([], []),
      blocks: [{ ...cleanBlock, validation: "PASS" }],
    });
    expect(normalized.reviewStatus).toBe("ready");
  });
});
