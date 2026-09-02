import type { ReviewBlock } from "./translation_review";

export type PersistedBulkPageStatus = "ready" | "needs_review" | "blocked";

export const TRANSLATION_PIPELINE_REVISION = "translation-pipeline-v4";

export type PersistedBulkPageReview = {
  pageId: string;
  fingerprint: string;

  pipelineRevision?: string;
  status: PersistedBulkPageStatus;
  // Explicit human sign-off on a "needs_review" page's warnings. Never
  // implied by status alone, and must be re-earned after any edit to the
  // review's blocks (see bulk_review_persistence.saveBulkReview callers).
  acknowledged?: boolean;
  blocks: ReviewBlock[];
};

export const bulkPageIdentity = (pageId: string): string => `page:${pageId}`;

export const isBulkReviewFresh = (
  review: PersistedBulkPageReview,
  currentFingerprint: string,
): boolean =>
  review.fingerprint === currentFingerprint &&
  review.pipelineRevision === TRANSLATION_PIPELINE_REVISION;
