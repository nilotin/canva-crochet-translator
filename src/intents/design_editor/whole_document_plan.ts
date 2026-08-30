import type { WholeDocumentPage } from "./whole_document_inventory";
import {
  classifyWholeDocumentPage,
  type ClassifiedWholeDocumentPage,
} from "./whole_document_classification";

export type WholeDocumentPlanStatus =
  | "eligible"
  | "applied"
  | "excluded"
  | "locked"
  | "empty"
  | "template_candidate";

export type WholeDocumentPlanEntry = {
  pageId: string;
  discoveryIndex: number;
  fingerprint: string;
  classification: ClassifiedWholeDocumentPage["classification"];
  status: WholeDocumentPlanStatus;
  textBlockCount: number;
};

export type WholeDocumentPlan = {
  entries: WholeDocumentPlanEntry[];
  counts: Record<WholeDocumentPlanStatus, number>;
};

export type WholeDocumentPlanOptions = {
  appliedPageIds?: ReadonlySet<string>;
  excludedPageIds?: ReadonlySet<string>;
};

const emptyCounts = (): Record<WholeDocumentPlanStatus, number> => ({
  eligible: 0,
  applied: 0,
  excluded: 0,
  locked: 0,
  empty: 0,
  template_candidate: 0,
});

const statusForPage = (
  page: WholeDocumentPage,
  classified: ClassifiedWholeDocumentPage,
  options: WholeDocumentPlanOptions,
): WholeDocumentPlanStatus => {
  if (options.appliedPageIds?.has(page.pageId)) return "applied";
  if (options.excludedPageIds?.has(page.pageId)) return "excluded";
  if (page.locked) return "locked";
  if (classified.classification === "empty") return "empty";

  if (classified.classification === "template_candidate") {
    return "template_candidate";
  }

  return "eligible";
};

export const buildWholeDocumentPlan = (
  pages: readonly WholeDocumentPage[],
  options: WholeDocumentPlanOptions = {},
): WholeDocumentPlan => {
  const counts = emptyCounts();

  const entries = pages.map((page) => {
    const classified = classifyWholeDocumentPage(page);
    const status = statusForPage(page, classified, options);

    counts[status] += 1;

    return {
      pageId: page.pageId,
      discoveryIndex: page.discoveryIndex,
      fingerprint: classified.fingerprint,
      classification: classified.classification,
      status,
      textBlockCount: classified.textBlockCount,
    };
  });

  return { entries, counts };
};
