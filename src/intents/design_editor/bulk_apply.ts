import type { PersistedBulkPageReview } from "./bulk_review_state";
import { loadBulkReviews } from "./bulk_review_persistence";
import { isBulkReviewFresh } from "./bulk_review_state";
import {
  readWholeDocumentInventory,
  type WholeDocumentInventory,
  type WholeDocumentPage,
} from "./whole_document_inventory";
import { pageContentFingerprint } from "./whole_document_classification";
import { requiresFormattingProjection } from "./translation_review";

export type BulkApplyPreflightIssueCode =
  | "MISSING_PAGE"
  | "LOCKED_PAGE"
  | "STALE_REVIEW"
  | "BLOCKED_REVIEW"
  | "REVIEW_REQUIRED"
  | "BLOCK_MISMATCH"
  | "FORMATTING_EDIT_CONFLICT"
  | "DUPLICATE_PAGE_REVIEW"
  | "EMPTY_REVIEW_SET"
  | "MISSING_REVIEW";

export type BulkApplyPreflightIssue = {
  pageId: string | null;
  code: BulkApplyPreflightIssueCode;
};

export type BulkApplyPreflightResult = {
  ok: boolean;
  issues: BulkApplyPreflightIssue[];
  readyPageIds: string[];
};

const pageById = (
  inventory: WholeDocumentInventory,
): Map<string, WholeDocumentPage> =>
  new Map(inventory.pages.map((page) => [page.pageId, page]));

export const preflightBulkApply = (
  inventory: WholeDocumentInventory,
  reviews: readonly PersistedBulkPageReview[],
): BulkApplyPreflightResult => {
  const pages = pageById(inventory);
  const issues: BulkApplyPreflightIssue[] = [];
  const readyPageIds: string[] = [];

  if (reviews.length === 0) {
    return {
      ok: false,
      issues: [{ pageId: null, code: "EMPTY_REVIEW_SET" }],
      readyPageIds,
    };
  }

  const seenPageIds = new Set<string>();

  for (const review of reviews) {
    if (seenPageIds.has(review.pageId)) {
      issues.push({
        pageId: review.pageId,
        code: "DUPLICATE_PAGE_REVIEW",
      });
      continue;
    }

    seenPageIds.add(review.pageId);
    const page = pages.get(review.pageId);

    if (!page) {
      issues.push({ pageId: review.pageId, code: "MISSING_PAGE" });
      continue;
    }

    if (page.locked) {
      issues.push({ pageId: review.pageId, code: "LOCKED_PAGE" });
      continue;
    }

    const currentFingerprint = pageContentFingerprint(page.blocks);

    if (!isBulkReviewFresh(review, currentFingerprint)) {
      issues.push({ pageId: review.pageId, code: "STALE_REVIEW" });
      continue;
    }

    if (review.status === "blocked") {
      issues.push({ pageId: review.pageId, code: "BLOCKED_REVIEW" });
      continue;
    }

    if (review.status === "needs_review") {
      issues.push({ pageId: review.pageId, code: "REVIEW_REQUIRED" });
      continue;
    }

    const orderedPageBlocks = [...page.blocks].sort(
      (left, right) => left.order - right.order,
    );

    if (orderedPageBlocks.length !== review.blocks.length) {
      issues.push({ pageId: review.pageId, code: "BLOCK_MISMATCH" });
      continue;
    }

    let pageHasIssue = false;

    for (let index = 0; index < review.blocks.length; index += 1) {
      const reviewBlock = review.blocks[index];
      const pageBlock = orderedPageBlocks[index];

      if (
        !reviewBlock ||
        !pageBlock ||
        reviewBlock.source !== pageBlock.sourceText
      ) {
        issues.push({ pageId: review.pageId, code: "BLOCK_MISMATCH" });
        pageHasIssue = true;
        break;
      }

      if (
        reviewBlock.editedTranslation !== reviewBlock.translated &&
        requiresFormattingProjection(pageBlock.formattingRegions)
      ) {
        issues.push({
          pageId: review.pageId,
          code: "FORMATTING_EDIT_CONFLICT",
        });
        pageHasIssue = true;
        break;
      }
    }

    if (!pageHasIssue) {
      readyPageIds.push(review.pageId);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    readyPageIds,
  };
};

type BulkApplyDependencies = {
  readInventory: () => Promise<WholeDocumentInventory>;
  loadReviews: (
    pageIds: readonly string[],
  ) => Promise<PersistedBulkPageReview[]>;
};

const bulkApplyDependencies = (
  overrides: Partial<BulkApplyDependencies> = {},
): BulkApplyDependencies => ({
  readInventory: readWholeDocumentInventory,
  loadReviews: loadBulkReviews,
  ...overrides,
});

export const prepareBulkApply = async (
  pageIds: readonly string[],
  overrides: Partial<BulkApplyDependencies> = {},
): Promise<BulkApplyPreflightResult> => {
  const dependencies = bulkApplyDependencies(overrides);

  const [inventory, reviews] = await Promise.all([
    dependencies.readInventory(),
    dependencies.loadReviews(pageIds),
  ]);

  const requestedPageIds = new Set(pageIds);
  const receivedPageIds = new Set(reviews.map((review) => review.pageId));

  const missingRequestedReviews = [...requestedPageIds].filter(
    (pageId) => !receivedPageIds.has(pageId),
  );

  if (missingRequestedReviews.length > 0) {
    return {
      ok: false,
      issues: missingRequestedReviews.map((pageId) => ({
        pageId,
        code: "MISSING_REVIEW" as const,
      })),
      readyPageIds: [],
    };
  }

  return preflightBulkApply(inventory, reviews);
};
