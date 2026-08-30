import { getDesignToken } from "@canva/design";
import { auth } from "@canva/user";
import type { TargetLanguage } from "./copy_designs";
import {
  buildPageReview,
  type CanvaTranslationBlock,
  type FormattingRegionSnapshot,
  type TranslationResponse,
} from "./translation_review";
import type { WholeDocumentInventory } from "./whole_document_inventory";
import {
  updateBulkQueueEntry,
  type BulkReviewQueue,
} from "./whole_document_queue";
import { saveBulkReview } from "./bulk_review_persistence";

type Dependencies = {
  getDesignToken: typeof getDesignToken;
  getUserToken: typeof auth.getCanvaUserToken;
  fetch: typeof fetch;
  backendHost: string;
  saveReview: typeof saveBulkReview;
};

export type BulkTranslationProgress = {
  queue: BulkReviewQueue;
  translatedPages: number;
  failedPages: number;
};

const dependencies = (overrides: Partial<Dependencies> = {}): Dependencies => ({
  getDesignToken,
  getUserToken: auth.getCanvaUserToken,
  fetch: (...input) => globalThis.fetch(...input),
  backendHost: typeof BACKEND_HOST === "string" ? BACKEND_HOST : "",
  saveReview: saveBulkReview,
  ...overrides,
});

const pageById = (inventory: WholeDocumentInventory) =>
  new Map(inventory.pages.map((page) => [page.pageId, page]));

const translationBlocksForPage = (
  page: WholeDocumentInventory["pages"][number],
): CanvaTranslationBlock[] =>
  page.blocks.map((block) => ({
    localId: block.id,
    sourceText: block.sourceText,
    order: block.order,
  }));

const formattingSnapshotsForPage = (
  page: WholeDocumentInventory["pages"][number],
): ReadonlyMap<string, FormattingRegionSnapshot[]> =>
  new Map(
    page.blocks.map((block) => [
      block.id,
      block.formattingRegions.map((region) => ({
        index: region.index,
        length: region.length,
        text: region.text,
        formatting: region.formatting,
      })),
    ]),
  );

export const translatePendingBulkPages = async (
  language: TargetLanguage,
  inventory: WholeDocumentInventory,
  initialQueue: BulkReviewQueue,
  overrides: Partial<Dependencies> = {},
): Promise<BulkTranslationProgress> => {
  const deps = dependencies(overrides);
  const pages = pageById(inventory);

  let queue = initialQueue;
  let translatedPages = 0;
  let failedPages = 0;

  for (const initialEntry of initialQueue.entries) {
    if (initialEntry.status !== "pending") continue;

    const page = pages.get(initialEntry.pageId);

    if (!page) {
      queue = updateBulkQueueEntry(queue, initialEntry.pageId, "failed");
      failedPages += 1;
      continue;
    }

    queue = updateBulkQueueEntry(queue, initialEntry.pageId, "translating");

    try {
      const blocks = translationBlocksForPage(page);
      const formattingSnapshots = formattingSnapshotsForPage(page);

      const [{ token: designToken }, userToken] = await Promise.all([
        deps.getDesignToken(),
        deps.getUserToken(),
      ]);

      const response = await deps.fetch(
        `${deps.backendHost.replace(/\/$/u, "")}/api/translate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${userToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            designToken,
            sourceLanguage: "tr",
            targetLanguage: language,
            blocks: blocks.map(({ localId, sourceText }) => ({
              id: localId,
              text: sourceText,
              formattingRegions: formattingSnapshots
                .get(localId)
                ?.map(({ index, length }, regionIndex) => ({
                  id: `fmt-${regionIndex}`,
                  start: index,
                  end: index + length,
                })),
            })),
            ...(initialEntry.templateCandidate
              ? {
                  templateCandidate: true,
                  pageFingerprint: initialEntry.fingerprint,
                }
              : {}),
          }),
        },
      );

      if (!response.ok) {
        throw new Error("Translation request failed.");
      }

      const result = (await response.json()) as TranslationResponse;

      const review = buildPageReview(blocks, formattingSnapshots, result);

      await deps.saveReview({
        pageId: initialEntry.pageId,
        fingerprint: initialEntry.fingerprint,
        status: review.reviewStatus,
        blocks: review.blocks,
      });

      queue = updateBulkQueueEntry(
        queue,
        initialEntry.pageId,
        review.reviewStatus,
      );

      translatedPages += 1;
    } catch {
      queue = updateBulkQueueEntry(queue, initialEntry.pageId, "failed");

      failedPages += 1;
    }
  }

  return {
    queue,
    translatedPages,
    failedPages,
  };
};
