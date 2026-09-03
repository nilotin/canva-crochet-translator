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
import { buildStaticTemplateTranslationResponse } from "./static_template_translation";

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

      // Attempted for EVERY page, unconditionally -- deliberately not
      // gated behind initialEntry.templateCandidate (a heuristic
      // classification used only for diagnostics and as a hint to the
      // backend's separate exact-fingerprint registry bypass below).
      // buildStaticTemplateTranslationResponse is itself exact/structural
      // (block count + per-block content match, see
      // static_template_translation.ts) and safely returns undefined for
      // anything that is not one of the known fixed pages, so trying it
      // first for every page costs nothing and means a classification
      // miss can never by itself cause a known static page (front cover /
      // materials-instructions-glossary / closing) to reach the provider.
      // This call happens before any authentication or network work
      // below, so a match costs zero provider/API calls AND zero network
      // round-trips.
      const staticTemplateResult = buildStaticTemplateTranslationResponse(
        page,
        blocks,
        language,
        {
          // totalPages counts every page discoveryIndex found in the
          // whole document -- both translatable pages AND skipped/locked
          // ones -- so front-cover/closing recognition is judged against
          // the document's real page count, not just the pages this bulk
          // run happens to be translating. See
          // static_template_translation.ts's StaticTemplateDocumentContext.
          totalPages: inventory.pages.length + inventory.skippedPages.length,
          // The document's actual first page, from this SAME inventory --
          // used only to derive pattern identity for closing-page
          // recognition (a locked/unreadable first page lives in
          // skippedPages, not pages, so it is simply absent here, which
          // safely disables closing-page pattern-identity matching for
          // this run rather than guessing).
          firstPage: inventory.pages.find((p) => p.discoveryIndex === 0),
        },
      );

      let result: TranslationResponse;

      if (staticTemplateResult) {
        result = staticTemplateResult;
      } else {
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

        result = (await response.json()) as TranslationResponse;
      }

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
