import type { WholeDocumentInventory } from "./whole_document_inventory";
import type { BulkReviewSummary } from "./bulk_review_persistence";
import { TRANSLATION_PIPELINE_REVISION } from "./bulk_review_state";
import type {
  WholeDocumentPlan,
  WholeDocumentPlanEntry,
} from "./whole_document_plan";

export type BulkQueueStatus =
  | "pending"
  | "translating"
  | "ready"
  | "needs_review"
  | "blocked"
  | "failed";

export type BulkQueueEntry = {
  pageId: string;
  discoveryIndex: number;
  fingerprint: string;
  status: BulkQueueStatus;
  blockIds: string[];
  templateCandidate?: true;
};

export type BulkReviewQueue = {
  entries: BulkQueueEntry[];
  counts: Record<BulkQueueStatus, number>;
};

const emptyCounts = (): Record<BulkQueueStatus, number> => ({
  pending: 0,
  translating: 0,
  ready: 0,
  needs_review: 0,
  blocked: 0,
  failed: 0,
});

const inventoryPageById = (
  inventory: WholeDocumentInventory,
): Map<string, WholeDocumentInventory["pages"][number]> =>
  new Map(inventory.pages.map((page) => [page.pageId, page]));

const eligibleEntries = (plan: WholeDocumentPlan): WholeDocumentPlanEntry[] =>
  plan.entries.filter(
    (entry) =>
      entry.status === "eligible" || entry.status === "template_candidate",
  );

export const buildBulkReviewQueue = (
  inventory: WholeDocumentInventory,
  plan: WholeDocumentPlan,
): BulkReviewQueue => {
  const pages = inventoryPageById(inventory);
  const counts = emptyCounts();

  const entries = eligibleEntries(plan).flatMap((entry) => {
    const page = pages.get(entry.pageId);
    if (!page) return [];

    counts.pending += 1;

    return [
      {
        pageId: entry.pageId,
        discoveryIndex: entry.discoveryIndex,
        fingerprint: entry.fingerprint,
        status: "pending" as const,
        blockIds: page.blocks.map((block) => block.id),
        ...(entry.status === "template_candidate"
          ? { templateCandidate: true as const }
          : {}),
      },
    ];
  });

  return { entries, counts };
};

export const updateBulkQueueEntry = (
  queue: BulkReviewQueue,
  pageId: string,
  status: BulkQueueStatus,
): BulkReviewQueue => {
  const current = queue.entries.find((entry) => entry.pageId === pageId);
  if (!current || current.status === status) return queue;

  const counts = { ...queue.counts };
  counts[current.status] -= 1;
  counts[status] += 1;

  return {
    entries: queue.entries.map((entry) =>
      entry.pageId === pageId ? { ...entry, status } : entry,
    ),
    counts,
  };
};

const restoredStatus = (status: BulkReviewSummary["status"]): BulkQueueStatus =>
  status;

export const restoreBulkReviewQueue = (
  queue: BulkReviewQueue,
  summaries: readonly BulkReviewSummary[],
): BulkReviewQueue => {
  const summariesByPageId = new Map(
    summaries.map((summary) => [summary.pageId, summary]),
  );

  let restored = queue;

  for (const entry of queue.entries) {
    const summary = summariesByPageId.get(entry.pageId);

    if (!summary) continue;
    if (summary.fingerprint !== entry.fingerprint) continue;
    if (summary.pipelineRevision !== TRANSLATION_PIPELINE_REVISION) continue;

    restored = updateBulkQueueEntry(
      restored,
      entry.pageId,
      restoredStatus(summary.status),
    );
  }

  return restored;
};
