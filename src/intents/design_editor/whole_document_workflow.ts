import { loadPersistedPageStateSummaries } from "./persisted_page_state";
import { readWholeDocumentInventory } from "./whole_document_inventory";
import {
  buildWholeDocumentPlan,
  type WholeDocumentPlan,
} from "./whole_document_plan";

type Dependencies = {
  readInventory: typeof readWholeDocumentInventory;
  loadSummaries: typeof loadPersistedPageStateSummaries;
};

export type WholeDocumentWorkflowResult = {
  plan: WholeDocumentPlan;
  skippedCanvaPages: number;
};

const absolutePageIdFromIdentity = (
  pageIdentity: string,
): string | undefined => {
  if (!pageIdentity.startsWith("page:")) return undefined;

  const pageId = pageIdentity.slice("page:".length);
  return pageId || undefined;
};

export const buildRemainingPagesWorkflow = async (
  excludedPageIds: ReadonlySet<string> = new Set(),
  overrides: Partial<Dependencies> = {},
): Promise<WholeDocumentWorkflowResult> => {
  const readInventory = overrides.readInventory ?? readWholeDocumentInventory;

  const loadSummaries =
    overrides.loadSummaries ?? loadPersistedPageStateSummaries;

  const [inventory, summaries] = await Promise.all([
    readInventory(),
    loadSummaries(),
  ]);

  const appliedPageIds = new Set(
    summaries.flatMap((summary) => {
      if (summary.status !== "applied") return [];

      const pageId = absolutePageIdFromIdentity(summary.pageIdentity);
      return pageId ? [pageId] : [];
    }),
  );

  return {
    plan: buildWholeDocumentPlan(inventory.pages, {
      appliedPageIds,
      excludedPageIds,
    }),
    skippedCanvaPages: inventory.skippedPages.length,
  };
};
