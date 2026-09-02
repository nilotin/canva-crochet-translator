import { openDesign, type DesignEditing } from "@canva/design";
import type { PersistedBulkPageReview } from "./bulk_review_state";
import { loadBulkReviews } from "./bulk_review_persistence";
import { isBulkReviewFresh } from "./bulk_review_state";
import {
  collectTextRanges,
  readWholeDocumentInventory,
  snapshotFormatting,
  type WholeDocumentInventory,
  type WholeDocumentPage,
  type WholeDocumentTextBlock,
} from "./whole_document_inventory";
import { pageContentFingerprint } from "./whole_document_classification";
import { digestWholeDocumentBlocks } from "./whole_document_snapshot";
import { savePersistedWholeDocumentApplied } from "./persisted_page_state";
import {
  ApplyReviewError,
  applyProjectedFormatting,
  requiresFormattingProjection,
} from "./translation_review";
import type { TargetLanguage } from "./copy_designs";
import {
  loadTargetContext,
  type DesignRole,
} from "./target_context";

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

    if (review.status === "needs_review" && !review.acknowledged) {
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

export const digestBulkReviewSourceSnapshot = (
  blocks: readonly WholeDocumentTextBlock[],
): string => digestWholeDocumentBlocks(blocks);

export const digestBulkReviewExpectedSnapshot = (
  pageBlocks: readonly WholeDocumentTextBlock[],
  review: PersistedBulkPageReview,
): string => {
  const orderedPageBlocks = [...pageBlocks].sort(
    (left, right) => left.order - right.order,
  );

  if (orderedPageBlocks.length !== review.blocks.length) {
    throw new ApplyReviewError("MISSING_MAPPING");
  }

  return digestWholeDocumentBlocks(
    orderedPageBlocks.map((pageBlock, index) => {
      const reviewBlock = review.blocks[index];

      if (!reviewBlock || reviewBlock.source !== pageBlock.sourceText) {
        throw new ApplyReviewError("MISSING_MAPPING");
      }

      return {
        ...pageBlock,
        sourceText: reviewBlock.editedTranslation,
      };
    }),
  );
};

type SessionPageMapping = {
  pageId: string;
  review: PersistedBulkPageReview;
  references: Map<string, DesignEditing.TextElement["text"]>;
  blocks: WholeDocumentTextBlock[];
};

export type BulkApplySessionPreflightResult = {
  preflight: BulkApplyPreflightResult;
  mappings: SessionPageMapping[];
};

const snapshotSessionPage = (
  page: DesignEditing.AbsolutePage,
  discoveryIndex: number,
): {
  page: WholeDocumentPage;
  references: Map<string, DesignEditing.TextElement["text"]>;
} => {
  const ranges = collectTextRanges(page.elements.toArray());
  const references = new Map<
    string,
    DesignEditing.TextElement["text"]
  >();

  const blocks = ranges.flatMap((range, order) => {
    const sourceText = range.readPlaintext();

    if (!sourceText.trim()) return [];

    const id = `page-${page.id}-block-${order + 1}`;
    references.set(id, range);

    return [
      {
        id,
        sourceText,
        order,
        formattingRegions: snapshotFormatting(range),
      },
    ];
  });

  return {
    page: {
      pageId: page.id,
      discoveryIndex,
      locked: page.locked,
      blocks,
    },
    references,
  };
};

export const preflightBulkApplySession = async (
  reviews: readonly PersistedBulkPageReview[],
  overrides: {
    openDesign?: typeof openDesign;
  } = {},
): Promise<BulkApplySessionPreflightResult> => {
  const open = overrides.openDesign ?? openDesign;
  const requestedPageIds = new Set(reviews.map((review) => review.pageId));
  const pages: WholeDocumentPage[] = [];
  const mappings: SessionPageMapping[] = [];

  await open({ type: "all_pages" }, async (session) => {
    for (const [discoveryIndex, pageRef] of session.pageRefs
      .toArray()
      .entries()) {
      const response = await session.helpers.openPage(
        pageRef,
        async ({ page }) => {
          if (page.type !== "absolute") return;
          if (!requestedPageIds.has(page.id)) return;

          const snapshot = snapshotSessionPage(page, discoveryIndex);
          const { references } = snapshot;
          const { blocks } = snapshot.page;

          pages.push(snapshot.page);

          const review = reviews.find(
            (candidate) => candidate.pageId === page.id,
          );

          if (review) {
            mappings.push({
              pageId: page.id,
              review,
              references,
              blocks,
            });
          }
        },
      );

      if (response.status === "skipped") {
        continue;
      }
    }

    // Read-only session preflight. Never sync here.
  });

  const inventory: WholeDocumentInventory = {
    pages,
    skippedPages: [],
  };

  return {
    preflight: preflightBulkApply(inventory, reviews),
    mappings,
  };
};


type VerifiedBulkApplyDependencies = {
  verifyTarget: () => Promise<DesignRole>;
  loadReviews: (
    pageIds: readonly string[],
  ) => Promise<PersistedBulkPageReview[]>;
  openDesign: typeof openDesign;
};

type BulkApplyMutationDependencies = VerifiedBulkApplyDependencies & {
  readInventory: () => Promise<WholeDocumentInventory>;
  saveAppliedPageState: typeof savePersistedWholeDocumentApplied;
};

export const prepareVerifiedBulkApply = async (
  pageIds: readonly string[],
  expectedTarget: {
    contextId: string;
    language: TargetLanguage;
  },
  overrides: Partial<VerifiedBulkApplyDependencies> = {},
): Promise<BulkApplySessionPreflightResult> => {
  const dependencies: VerifiedBulkApplyDependencies = {
    verifyTarget: loadTargetContext,
    loadReviews: loadBulkReviews,
    openDesign,
    ...overrides,
  };

  const verified = await dependencies.verifyTarget().catch(() => undefined);

  if (
    !verified?.isTranslationTarget ||
    verified.contextId !== expectedTarget.contextId ||
    verified.language !== expectedTarget.language
  ) {
    throw new ApplyReviewError("TARGET_VERIFICATION_FAILED");
  }

  const reviews = await dependencies.loadReviews(pageIds);
  const requestedPageIds = new Set(pageIds);
  const receivedPageIds = new Set(reviews.map((review) => review.pageId));

  const missingRequestedReviews = [...requestedPageIds].filter(
    (pageId) => !receivedPageIds.has(pageId),
  );

  if (missingRequestedReviews.length > 0) {
    return {
      preflight: {
        ok: false,
        issues: missingRequestedReviews.map((pageId) => ({
          pageId,
          code: "MISSING_REVIEW" as const,
        })),
        readyPageIds: [],
      },
      mappings: [],
    };
  }

  return preflightBulkApplySession(reviews, {
    openDesign: dependencies.openDesign,
  });
};


export type BulkApplyResult = {
  preflight: BulkApplyPreflightResult;
  appliedPageIds: string[];
  verifiedAppliedPageIds: string[];
  verificationFailedPageIds: string[];
  persistedAppliedPageIds: string[];
  persistenceFailedPageIds: string[];
};

export const applyBulkReviews = async (
  pageIds: readonly string[],
  expectedTarget: {
    contextId: string;
    language: TargetLanguage;
  },
  overrides: Partial<BulkApplyMutationDependencies> = {},
): Promise<BulkApplyResult> => {
  const dependencies: BulkApplyMutationDependencies = {
    verifyTarget: loadTargetContext,
    loadReviews: loadBulkReviews,
    openDesign,
    readInventory: readWholeDocumentInventory,
    saveAppliedPageState: savePersistedWholeDocumentApplied,
    ...overrides,
  };

  const prepared = await prepareVerifiedBulkApply(
    pageIds,
    expectedTarget,
    dependencies,
  );

  if (!prepared.preflight.ok) {
    return {
      preflight: prepared.preflight,
      appliedPageIds: [],
      verifiedAppliedPageIds: [],
      verificationFailedPageIds: [],
      persistedAppliedPageIds: [],
      persistenceFailedPageIds: [],
    };
  }

  const reviewByPageId = new Map(
    prepared.mappings.map(({ review }) => [review.pageId, review]),
  );

  const requestedPageIds = new Set(pageIds);
  const appliedPageIds: string[] = [];
  const appliedSnapshots = new Map<
    string,
    {
      review: PersistedBulkPageReview;
      sourceSnapshotDigest: string;
      expectedAppliedSnapshotDigest: string;
    }
  >();

  let synced = false;
  const phase: { value: "mutation" | "sync" } = {
    value: "mutation",
  };

  const mutationTarget = await dependencies.verifyTarget().catch(
    () => undefined,
  );

  if (
    !mutationTarget?.isTranslationTarget ||
    mutationTarget.contextId !== expectedTarget.contextId ||
    mutationTarget.language !== expectedTarget.language
  ) {
    throw new ApplyReviewError("TARGET_VERIFICATION_FAILED");
  }

  try {
    await dependencies.openDesign(
      { type: "all_pages" },
      async (session) => {
        const foundPageIds = new Set<string>();

        for (const [discoveryIndex, pageRef] of session.pageRefs
          .toArray()
          .entries()) {
          const response = await session.helpers.openPage(
            pageRef,
            async ({ page }) => {
              if (page.type !== "absolute") return;
              if (!requestedPageIds.has(page.id)) return;

              foundPageIds.add(page.id);

              const review = reviewByPageId.get(page.id);
              if (!review) {
                throw new ApplyReviewError("MISSING_MAPPING");
              }

              const snapshot = snapshotSessionPage(page, discoveryIndex);
              const pagePreflight = preflightBulkApply(
                {
                  pages: [snapshot.page],
                  skippedPages: [],
                },
                [review],
              );

              if (!pagePreflight.ok) {
                throw new ApplyReviewError("STALE_REVIEW");
              }

              appliedSnapshots.set(page.id, {
                review,
                sourceSnapshotDigest: digestBulkReviewSourceSnapshot(
                  snapshot.page.blocks,
                ),
                expectedAppliedSnapshotDigest:
                  digestBulkReviewExpectedSnapshot(snapshot.page.blocks, review),
              });

              const orderedBlocks = [...snapshot.page.blocks].sort(
                (left, right) => left.order - right.order,
              );

              const mapped = review.blocks.map((block, index) => {
                const currentBlock = orderedBlocks[index];

                if (
                  !currentBlock ||
                  currentBlock.sourceText !== block.source
                ) {
                  throw new ApplyReviewError("MISSING_MAPPING");
                }

                const reference = snapshot.references.get(currentBlock.id);

                if (!reference) {
                  throw new ApplyReviewError("MISSING_MAPPING");
                }

                return {
                  block,
                  currentBlock,
                  reference,
                };
              });

              for (const { block, currentBlock, reference } of mapped) {
                reference.replaceText(
                  {
                    index: 0,
                    length: currentBlock.sourceText.length,
                  },
                  block.editedTranslation,
                );

                applyProjectedFormatting(
                  block,
                  reference,
                  currentBlock.formattingRegions,
                );
              }

              appliedPageIds.push(page.id);
            },
          );

          if (response.status === "skipped") {
            continue;
          }
        }

        const missingPage = [...requestedPageIds].some(
          (pageId) => !foundPageIds.has(pageId),
        );

        if (missingPage) {
          throw new ApplyReviewError("STALE_REVIEW");
        }

        phase.value = "sync";
        await session.sync();
        synced = true;
      },
    );
  } catch (cause) {
    if (cause instanceof ApplyReviewError) throw cause;

    if (
      cause instanceof Error &&
      /permission|scope|forbidden/iu.test(cause.message)
    ) {
      throw new ApplyReviewError("PERMISSION_REQUIRED");
    }

    throw new ApplyReviewError(
      phase.value === "sync" ? "SYNC_FAILED" : "MUTATION_FAILED",
    );
  }

  if (!synced) {
    throw new ApplyReviewError("SYNC_FAILED");
  }

  const postSyncInventory = await dependencies.readInventory().catch(
    () => undefined,
  );
  const postSyncPages = postSyncInventory
    ? pageById(postSyncInventory)
    : new Map<string, WholeDocumentPage>();
  const verifiedAppliedPageIds: string[] = [];
  const verificationFailedPageIds: string[] = [];
  const actualAppliedSnapshotDigests = new Map<string, string>();

  for (const pageId of appliedPageIds) {
    const appliedSnapshot = appliedSnapshots.get(pageId);
    const currentPage = postSyncPages.get(pageId);

    if (!appliedSnapshot || !currentPage) {
      verificationFailedPageIds.push(pageId);
      continue;
    }

    const actualDigest = digestBulkReviewSourceSnapshot(currentPage.blocks);

    if (
      actualDigest === appliedSnapshot.expectedAppliedSnapshotDigest
    ) {
      verifiedAppliedPageIds.push(pageId);
      actualAppliedSnapshotDigests.set(pageId, actualDigest);
    } else {
      verificationFailedPageIds.push(pageId);
    }
  }

  const persistedAppliedPageIds: string[] = [];
  const persistenceFailedPageIds: string[] = [];

  const persistenceResults = await Promise.allSettled(
    verifiedAppliedPageIds.map(async (pageId) => {
      const appliedSnapshot = appliedSnapshots.get(pageId);
      const actualAppliedSnapshotDigest =
        actualAppliedSnapshotDigests.get(pageId);

      if (!appliedSnapshot || !actualAppliedSnapshotDigest) {
        throw new Error("Verified applied snapshot mapping is missing.");
      }

      await dependencies.saveAppliedPageState(
        pageId,
        appliedSnapshot.review.blocks,
        appliedSnapshot.sourceSnapshotDigest,
        appliedSnapshot.expectedAppliedSnapshotDigest,
        actualAppliedSnapshotDigest,
      );

      return pageId;
    }),
  );

  persistenceResults.forEach((result, index) => {
    const pageId = verifiedAppliedPageIds[index];
    if (!pageId) return;

    if (result.status === "fulfilled") {
      persistedAppliedPageIds.push(pageId);
    } else {
      persistenceFailedPageIds.push(pageId);
    }
  });

  return {
    preflight: prepared.preflight,
    appliedPageIds,
    verifiedAppliedPageIds,
    verificationFailedPageIds,
    persistedAppliedPageIds,
    persistenceFailedPageIds,
  };
};
