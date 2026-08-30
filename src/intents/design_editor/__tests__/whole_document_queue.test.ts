import { TRANSLATION_PIPELINE_REVISION } from "../bulk_review_state";

import {
  buildBulkReviewQueue,
  restoreBulkReviewQueue,
  updateBulkQueueEntry,
} from "../whole_document_queue";
import type { WholeDocumentInventory } from "../whole_document_inventory";
import type { WholeDocumentPlan } from "../whole_document_plan";

const inventory: WholeDocumentInventory = {
  pages: [
    {
      pageId: "page-1",
      discoveryIndex: 0,
      locked: false,
      blocks: [
        {
          id: "block-1",
          sourceText: "Kulak",
          order: 0,
          formattingRegions: [],
        },
      ],
    },
    {
      pageId: "page-2",
      discoveryIndex: 1,
      locked: false,
      blocks: [
        {
          id: "block-2a",
          sourceText: "Kaş",
          order: 0,
          formattingRegions: [],
        },
        {
          id: "block-2b",
          sourceText: "6x örüyoruz",
          order: 1,
          formattingRegions: [],
        },
      ],
    },
  ],
  skippedPages: [],
};

const plan: WholeDocumentPlan = {
  entries: [
    {
      pageId: "page-1",
      discoveryIndex: 0,
      fingerprint: "fp-1",
      classification: "content",
      status: "eligible",
      textBlockCount: 1,
    },
    {
      pageId: "page-2",
      discoveryIndex: 1,
      fingerprint: "fp-2",
      classification: "content",
      status: "eligible",
      textBlockCount: 2,
    },
  ],
  counts: {
    eligible: 2,
    applied: 0,
    excluded: 0,
    locked: 0,
    empty: 0,
    template_candidate: 0,
  },
};

describe("whole document bulk queue", () => {
  it("creates pending queue entries only for eligible pages", () => {
    const queue = buildBulkReviewQueue(inventory, plan);

    expect(queue.entries).toEqual([
      {
        pageId: "page-1",
        discoveryIndex: 0,
        fingerprint: "fp-1",
        status: "pending",
        blockIds: ["block-1"],
      },
      {
        pageId: "page-2",
        discoveryIndex: 1,
        fingerprint: "fp-2",
        status: "pending",
        blockIds: ["block-2a", "block-2b"],
      },
    ]);

    expect(queue.counts.pending).toBe(2);
  });

  it("keeps template candidates pending and marks them for backend lookup", () => {
    const templatePlan = {
      ...plan,
      entries: [
        ...plan.entries,
        {
          pageId: "page-template",
          discoveryIndex: 2,
          fingerprint: "page-content-v1-synthetic-template",
          classification: "template_candidate" as const,
          status: "template_candidate" as const,
          textBlockCount: 1,
        },
      ],
      counts: {
        ...plan.counts,
        template_candidate: 1,
      },
    };

    const templateInventory = {
      ...inventory,
      pages: [
        ...inventory.pages,
        {
          pageId: "page-template",
          discoveryIndex: 2,
          locked: false,
          blocks: [
            {
              id: "template-block-1",
              sourceText: "Synthetic template source",
              order: 0,
              formattingRegions: [],
            },
          ],
        },
      ],
    };

    const queue = buildBulkReviewQueue(templateInventory, templatePlan);
    const candidate = queue.entries.find(
      ({ pageId }) => pageId === "page-template",
    );

    expect(candidate).toMatchObject({
      pageId: "page-template",
      fingerprint: "page-content-v1-synthetic-template",
      status: "pending",
      blockIds: ["template-block-1"],
      templateCandidate: true,
    });
  });

  it("still excludes applied, excluded, locked, and empty pages from the bulk queue", () => {
    const nonEligiblePlan = {
      ...plan,
      entries: [
        {
          ...plan.entries[0]!,
          status: "applied" as const,
        },
        {
          ...plan.entries[1]!,
          status: "excluded" as const,
        },
        {
          pageId: "page-locked",
          discoveryIndex: 2,
          fingerprint: "fp-locked",
          classification: "content" as const,
          status: "locked" as const,
          textBlockCount: 1,
        },
        {
          pageId: "page-empty",
          discoveryIndex: 3,
          fingerprint: "fp-empty",
          classification: "empty" as const,
          status: "empty" as const,
          textBlockCount: 0,
        },
      ],
    };

    const nonEligibleInventory = {
      ...inventory,
      pages: [
        ...inventory.pages,
        {
          pageId: "page-locked",
          discoveryIndex: 2,
          locked: true,
          blocks: [
            {
              id: "locked-block",
              sourceText: "Locked",
              order: 0,
              formattingRegions: [],
            },
          ],
        },
        {
          pageId: "page-empty",
          discoveryIndex: 3,
          locked: false,
          blocks: [],
        },
      ],
    };

    const queue = buildBulkReviewQueue(nonEligibleInventory, nonEligiblePlan);

    expect(queue.entries).toHaveLength(0);
    expect(queue.counts.pending).toBe(0);
  });

  it("updates queue status and counts immutably", () => {
    const queue = buildBulkReviewQueue(inventory, plan);

    const updated = updateBulkQueueEntry(queue, "page-1", "ready");

    expect(updated).not.toBe(queue);
    expect(updated.entries[0]?.status).toBe("ready");
    expect(updated.counts.pending).toBe(1);
    expect(updated.counts.ready).toBe(1);

    expect(queue.entries[0]?.status).toBe("pending");
    expect(queue.counts.pending).toBe(2);
  });

  it("restores persisted status when page fingerprint still matches", () => {
    const queue = buildBulkReviewQueue(inventory, plan);

    const restored = restoreBulkReviewQueue(queue, [
      {
        pageId: "page-1",
        fingerprint: "fp-1",

        pipelineRevision: TRANSLATION_PIPELINE_REVISION,
        status: "ready",
        updatedAt: "2026-08-29T20:00:00.000Z",
      },
      {
        pageId: "page-2",
        fingerprint: "fp-2",

        pipelineRevision: TRANSLATION_PIPELINE_REVISION,
        status: "blocked",
        updatedAt: "2026-08-29T20:00:00.000Z",
      },
    ]);

    expect(restored.entries.map(({ status }) => status)).toEqual([
      "ready",
      "blocked",
    ]);

    expect(restored.counts.pending).toBe(0);
    expect(restored.counts.ready).toBe(1);
    expect(restored.counts.blocked).toBe(1);
  });

  it("does not restore persisted reviews from an older pipeline", () => {

    const queue = buildBulkReviewQueue(inventory, plan);

    const restored = restoreBulkReviewQueue(queue, [
      {
        pageId: "page-1",
        fingerprint: "fp-1",
        pipelineRevision: "translation-pipeline-v1",
        status: "ready",
        updatedAt: "2026-08-29T20:00:00.000Z",
      },
    ]);

    expect(restored.entries[0]?.status).toBe("pending");
    expect(restored.counts.pending).toBe(2);
    expect(restored.counts.ready).toBe(0);

  });

  it("does not restore legacy persisted reviews with no pipeline revision", () => {

    const queue = buildBulkReviewQueue(inventory, plan);

    const restored = restoreBulkReviewQueue(queue, [
      {
        pageId: "page-1",
        fingerprint: "fp-1",
        status: "ready",
        updatedAt: "2026-08-29T20:00:00.000Z",
      },
    ]);

    expect(restored.entries[0]?.status).toBe("pending");
    expect(restored.counts.pending).toBe(2);
    expect(restored.counts.ready).toBe(0);

  });

  it("does not restore stale persisted reviews after page content changes", () => {
    const queue = buildBulkReviewQueue(inventory, plan);

    const restored = restoreBulkReviewQueue(queue, [
      {
        pageId: "page-1",
        fingerprint: "old-fingerprint",
        status: "ready",
        updatedAt: "2026-08-29T20:00:00.000Z",
      },
    ]);

    expect(restored.entries[0]?.status).toBe("pending");
    expect(restored.counts.pending).toBe(2);
    expect(restored.counts.ready).toBe(0);
  });

  it("leaves the queue unchanged for unknown pages", () => {
    const queue = buildBulkReviewQueue(inventory, plan);

    expect(updateBulkQueueEntry(queue, "missing", "failed")).toBe(queue);
  });
});
