import type { TargetLanguage } from "./copy_designs";
import { loadBulkReviewSummaries } from "./bulk_review_persistence";
import {
  buildRemainingPagesWorkflow,
  type WholeDocumentWorkflowResult,
} from "./whole_document_workflow";
import {
  buildBulkReviewQueue,
  restoreBulkReviewQueue,
  type BulkReviewQueue,
} from "./whole_document_queue";
import {
  translatePendingBulkPages,
  type BulkTranslationProgress,
} from "./bulk_translation";
import { readWholeDocumentInventory } from "./whole_document_inventory";
import { loadPersistedPageStateSummaries } from "./persisted_page_state";

type Dependencies = {
  readInventory: typeof readWholeDocumentInventory;
  loadPageStateSummaries: typeof loadPersistedPageStateSummaries;
  loadBulkSummaries: typeof loadBulkReviewSummaries;
  translatePending: typeof translatePendingBulkPages;
};

export type PreparedRemainingPages = {
  workflow: WholeDocumentWorkflowResult;
  queue: BulkReviewQueue;
};

export type TranslateRemainingPagesResult = PreparedRemainingPages & {
  translation: BulkTranslationProgress;
};

const dependencies = (overrides: Partial<Dependencies> = {}): Dependencies => ({
  readInventory: readWholeDocumentInventory,
  loadPageStateSummaries: loadPersistedPageStateSummaries,
  loadBulkSummaries: loadBulkReviewSummaries,
  translatePending: translatePendingBulkPages,
  ...overrides,
});

export const prepareRemainingPages = async (
  excludedPageIds: ReadonlySet<string> = new Set(),
  overrides: Partial<Dependencies> = {},
): Promise<PreparedRemainingPages> => {
  const deps = dependencies(overrides);

  const inventory = await deps.readInventory();

  const pageStateSummaries = await deps.loadPageStateSummaries();

  const workflow = await buildRemainingPagesWorkflow(excludedPageIds, {
    readInventory: async () => inventory,
    loadSummaries: async () => pageStateSummaries,
  });

  const bulkSummaries = await deps.loadBulkSummaries();

  const queue = restoreBulkReviewQueue(
    buildBulkReviewQueue(inventory, workflow.plan),
    bulkSummaries,
  );

  return {
    workflow,
    queue,
  };
};

export const translateRemainingPages = async (
  language: TargetLanguage,
  excludedPageIds: ReadonlySet<string> = new Set(),
  overrides: Partial<Dependencies> = {},
): Promise<TranslateRemainingPagesResult> => {
  const deps = dependencies(overrides);

  const inventory = await deps.readInventory();

  const pageStateSummaries = await deps.loadPageStateSummaries();

  const workflow = await buildRemainingPagesWorkflow(excludedPageIds, {
    readInventory: async () => inventory,
    loadSummaries: async () => pageStateSummaries,
  });

  const bulkSummaries = await deps.loadBulkSummaries();

  const queue = restoreBulkReviewQueue(
    buildBulkReviewQueue(inventory, workflow.plan),
    bulkSummaries,
  );

  const translation = await deps.translatePending(language, inventory, queue);

  return {
    workflow,
    queue,
    translation,
  };
};
