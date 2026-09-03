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
import {
  buildStaticTemplateTranslationResponse,
  recognizePage2Hybrid,
} from "./static_template_translation";

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

// Posts a translation request for exactly the given blocks (never more)
// to the existing /api/translate pipeline. Used both for the full-page
// fallback (all of a page's blocks) and for Page 2's hybrid materials-only
// request (a single block) -- see translatePendingBulkPages below.
// templateCandidateHint is only ever attached for a full-page request;
// it describes the WHOLE page's heuristic classification/fingerprint,
// which is not meaningful for a single-block materials-only request.
const requestTranslation = async (
  deps: Dependencies,
  designToken: string,
  userToken: string,
  language: TargetLanguage,
  blocksToTranslate: readonly CanvaTranslationBlock[],
  formattingSnapshots: ReadonlyMap<string, FormattingRegionSnapshot[]>,
  templateCandidateHint:
    | { templateCandidate: true; pageFingerprint: string }
    | Record<string, never>,
  contentKind: "pattern" | "materials" = "pattern",
): Promise<TranslationResponse> => {
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
        contentKind,
        blocks: blocksToTranslate.map(({ localId, sourceText }) => ({
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
        ...templateCandidateHint,
      }),
    },
  );

  if (!response.ok) {
    throw new Error("Translation request failed.");
  }

  return (await response.json()) as TranslationResponse;
};

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
      // Both buildStaticTemplateTranslationResponse and
      // recognizePage2Hybrid are exact/structural (block count/content
      // match, see static_template_translation.ts) and safely return
      // undefined for anything that is not one of the known fixed pages,
      // so trying them first for every page costs nothing and means a
      // classification miss can never by itself cause a known static
      // page (front cover / Page 2 / closing) to reach the full-page
      // LLM path. These calls happen before any authentication or
      // network work below, so a front-cover/closing match costs zero
      // provider/API calls AND zero network round-trips.
      //
      // Page 2 is intentionally checked FIRST and separately: since
      // Feature 3, Page 2 is hybrid (its materials body is ordinary
      // pattern-specific content that must go through the LLM), so it is
      // no longer part of buildStaticTemplateTranslationResponse at all
      // -- recognizePage2Hybrid identifies the page and everything on it
      // EXCEPT the materials body, which is translated below via a
      // single-block /api/translate request.
      const page2Hybrid = recognizePage2Hybrid(page, blocks, language);

      const staticTemplateResult = page2Hybrid
        ? undefined
        : buildStaticTemplateTranslationResponse(page, blocks, language, {
            // totalPages counts every page discoveryIndex found in the
            // whole document -- both translatable pages AND
            // skipped/locked ones -- so front-cover/closing recognition
            // is judged against the document's real page count, not
            // just the pages this bulk run happens to be translating.
            // See static_template_translation.ts's
            // StaticTemplateDocumentContext.
            totalPages: inventory.pages.length + inventory.skippedPages.length,
            // The document's actual first page, from this SAME
            // inventory -- used only to derive pattern identity for
            // closing-page recognition (a locked/unreadable first page
            // lives in skippedPages, not pages, so it is simply absent
            // here, which safely disables closing-page pattern-identity
            // matching for this run rather than guessing).
            firstPage: inventory.pages.find((p) => p.discoveryIndex === 0),
          });

      let result: TranslationResponse;

      if (page2Hybrid) {
        const materialsBlock = blocks.find(
          ({ localId }) => localId === page2Hybrid.materialsBlockId,
        );

        if (!materialsBlock) {
          // Cannot happen given recognizePage2Hybrid derives
          // materialsBlockId from these SAME blocks, but never silently
          // proceed without it -- surface as a normal page failure
          // rather than risk sending an unintended request.
          throw new Error(
            "Recognized Page 2 skeleton is missing its materials block.",
          );
        }

        const [{ token: designToken }, userToken] = await Promise.all([
          deps.getDesignToken(),
          deps.getUserToken(),
        ]);

        // ONLY the materials body -- never the rest of Page 2 (headings,
        // explanations/instructions, abbreviations/glossary, the
        // decorative "." are all already resolved deterministically
        // above and must never reach the LLM).
        const materialsResponse = await requestTranslation(
          deps,
          designToken,
          userToken,
          language,
          [materialsBlock],
          formattingSnapshots,
          {},
          "materials",
        );

        const materialsTranslation = materialsResponse.translations.find(
          ({ id }) => id === materialsBlock.localId,
        );

        if (
          !materialsTranslation ||
          materialsResponse.translations.length !== 1
        ) {
          // A malformed/missing materials translation must never
          // silently produce an incomplete or incorrectly-Ready page --
          // throwing here routes to the same "failed" handling as any
          // other translation failure below.
          throw new Error(
            "Materials translation response was malformed.",
          );
        }

        result = {
          translations: [
            ...page2Hybrid.deterministicTranslations,
            materialsTranslation,
          ],
        };
      } else if (staticTemplateResult) {
        result = staticTemplateResult;
      } else {
        const [{ token: designToken }, userToken] = await Promise.all([
          deps.getDesignToken(),
          deps.getUserToken(),
        ]);

        result = await requestTranslation(
          deps,
          designToken,
          userToken,
          language,
          blocks,
          formattingSnapshots,
          initialEntry.templateCandidate
            ? {
                templateCandidate: true,
                pageFingerprint: initialEntry.fingerprint,
              }
            : {},
        );
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
