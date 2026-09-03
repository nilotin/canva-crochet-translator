import {
  AUTO_ACKNOWLEDGEABLE_WARNING_CODES,
  bulkPageIdentity,
  isBulkReviewFresh,
  isEffectivelyAcknowledged,
  isWarningCodeEligibleForAutoAcknowledge,
  reviewWarningCodes,
  TRANSLATION_PIPELINE_REVISION,
  type PersistedBulkPageReview,
} from "../bulk_review_state";
import type { ReviewBlock } from "../translation_review";

const review: PersistedBulkPageReview = {
  pageId: "abc",
  fingerprint: "page-content-v1-1234",

  pipelineRevision: TRANSLATION_PIPELINE_REVISION,
  status: "ready",
  blocks: [],
};

describe("bulk review state", () => {
  it("uses the stable Canva page id as its page identity", () => {
    expect(bulkPageIdentity("abc")).toBe("page:abc");
  });

  it("accepts an unchanged page fingerprint", () => {
    expect(isBulkReviewFresh(review, "page-content-v1-1234")).toBe(true);
  });

  it("rejects a stale page fingerprint", () => {
    expect(isBulkReviewFresh(review, "page-content-v1-changed")).toBe(false);
  });

  it("rejects a review from an older translation pipeline", () => {
    expect(
      isBulkReviewFresh(
        { ...review, pipelineRevision: "translation-pipeline-v1" },
        "page-content-v1-1234",
      ),
    ).toBe(false);
  });

  it("rejects a legacy review with no pipeline revision", () => {
    expect(
      isBulkReviewFresh(
        { ...review, pipelineRevision: undefined },
        "page-content-v1-1234",
      ),
    ).toBe(false);
  });

});

const blockWith = (
  overrides: Partial<ReviewBlock> = {},
): ReviewBlock => ({
  id: "block-1",
  source: "Bir üst sıraya geçiyoruz",
  translated: "We move up a row",
  editedTranslation: "We move up a row",
  validation: "WARNING",
  errors: [],
  warnings: [],
  ...overrides,
});

describe("warning-family auto-acknowledge eligibility", () => {
  it("makes the reused MANUAL_REVIEW_RECOMMENDED code eligible", () => {
    expect(
      isWarningCodeEligibleForAutoAcknowledge("MANUAL_REVIEW_RECOMMENDED"),
    ).toBe(true);
    expect(AUTO_ACKNOWLEDGEABLE_WARNING_CODES.has("MANUAL_REVIEW_RECOMMENDED")).toBe(
      true,
    );
  });

  it.each([
    "SUSPICIOUSLY_SHORT_TRANSLATION",
    "UNUSUALLY_LARGE_EXPANSION",
    "POSSIBLE_GLOSSARY_MISMATCH",
    "TARGET_LANGUAGE_FLUENCY_REVIEW",
    "SEMANTIC_ANCHOR_MISSING",
  ])("keeps %s ineligible for auto-acknowledge", (code) => {
    expect(isWarningCodeEligibleForAutoAcknowledge(code)).toBe(false);
  });

  it("collects warning codes across every block on the page", () => {
    const review = {
      blocks: [
        blockWith({ warnings: [{ code: "MANUAL_REVIEW_RECOMMENDED", message: "m" }] }),
        blockWith({ warnings: [{ code: "SUSPICIOUSLY_SHORT_TRANSLATION", message: "m2" }] }),
      ],
    };
    expect([...reviewWarningCodes(review)].sort()).toEqual([
      "MANUAL_REVIEW_RECOMMENDED",
      "SUSPICIOUSLY_SHORT_TRANSLATION",
    ]);
  });

  it("treats explicit page-level acknowledgement as sufficient on its own", () => {
    const review = {
      acknowledged: true,
      blocks: [blockWith({ warnings: [{ code: "SUSPICIOUSLY_SHORT_TRANSLATION", message: "m" }] })],
    };
    expect(isEffectivelyAcknowledged(review, new Set())).toBe(true);
  });

  it("treats a page as effectively acknowledged when every warning belongs to an approved family", () => {
    const review = {
      acknowledged: false,
      blocks: [blockWith({ warnings: [{ code: "MANUAL_REVIEW_RECOMMENDED", message: "m" }] })],
    };
    expect(
      isEffectivelyAcknowledged(review, new Set(["MANUAL_REVIEW_RECOMMENDED"])),
    ).toBe(true);
  });

  it("never treats the whole page as acknowledged when only one warning family is approved", () => {
    const review = {
      acknowledged: false,
      blocks: [
        blockWith({
          warnings: [
            { code: "MANUAL_REVIEW_RECOMMENDED", message: "m" },
            { code: "SUSPICIOUSLY_SHORT_TRANSLATION", message: "m2" },
          ],
        }),
      ],
    };
    expect(
      isEffectivelyAcknowledged(review, new Set(["MANUAL_REVIEW_RECOMMENDED"])),
    ).toBe(false);
  });

  it("never lets a preference whitelist a block that also has errors", () => {
    const review = {
      acknowledged: false,
      blocks: [
        blockWith({
          errors: [{ code: "NUMBER_MISMATCH", message: "count mismatch" }],
          warnings: [{ code: "MANUAL_REVIEW_RECOMMENDED", message: "m" }],
        }),
      ],
    };
    expect(
      isEffectivelyAcknowledged(review, new Set(["MANUAL_REVIEW_RECOMMENDED"])),
    ).toBe(false);
  });

  it("never lets a preference whitelist an ineligible code even if a caller passes it explicitly", () => {
    const review = {
      acknowledged: false,
      blocks: [blockWith({ warnings: [{ code: "SEMANTIC_ANCHOR_MISSING", message: "m" }] })],
    };
    expect(
      isEffectivelyAcknowledged(review, new Set(["SEMANTIC_ANCHOR_MISSING"])),
    ).toBe(false);
  });

  it("re-evaluates fresh after an edit resets page-level acknowledgement, rather than reusing a stale answer", () => {
    const acknowledgedBeforeEdit = {
      acknowledged: true,
      blocks: [blockWith({ warnings: [{ code: "SUSPICIOUSLY_SHORT_TRANSLATION", message: "m" }] })],
    };
    expect(isEffectivelyAcknowledged(acknowledgedBeforeEdit, new Set())).toBe(true);

    // editBulkReviewBlock resets acknowledged to false on any edit.
    const afterEdit = { ...acknowledgedBeforeEdit, acknowledged: false };
    expect(isEffectivelyAcknowledged(afterEdit, new Set())).toBe(false);
  });
});
