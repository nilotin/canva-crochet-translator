import {
  bulkPageIdentity,
  isBulkReviewFresh,
  TRANSLATION_PIPELINE_REVISION,
  type PersistedBulkPageReview,
} from "../bulk_review_state";

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
