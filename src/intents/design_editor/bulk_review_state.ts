import type { ReviewBlock } from "./translation_review";

export type PersistedBulkPageStatus = "ready" | "needs_review" | "blocked";

export const TRANSLATION_PIPELINE_REVISION = "translation-pipeline-v4";

export type PersistedBulkPageReview = {
  pageId: string;
  fingerprint: string;

  pipelineRevision?: string;
  status: PersistedBulkPageStatus;
  blocks: ReviewBlock[];
};

export const bulkPageIdentity = (pageId: string): string => `page:${pageId}`;

export const isBulkReviewFresh = (
  review: PersistedBulkPageReview,
  currentFingerprint: string,
): boolean =>
  review.fingerprint === currentFingerprint &&
  review.pipelineRevision === TRANSLATION_PIPELINE_REVISION;
