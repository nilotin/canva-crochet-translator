import {
  prepareRemainingPages,
  translateRemainingPages,
} from "../translate_remaining_workflow";
import type { WholeDocumentInventory } from "../whole_document_inventory";
import type { BulkReviewQueue } from "../whole_document_queue";
import { TRANSLATION_PIPELINE_REVISION } from "../bulk_review_state";
import { pageContentFingerprint } from "../whole_document_classification";

const inventory: WholeDocumentInventory = {
  pages: [
    {
      pageId: "page-1",
      discoveryIndex: 3,
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
          id: "block-2",
          sourceText: "Kaş",
          order: 0,
          formattingRegions: [],
        },
      ],
    },
    {
      pageId: "page-3",
      discoveryIndex: 2,
      locked: false,
      blocks: [
        {
          id: "block-3",
          sourceText: "6x örüyoruz",
          order: 0,
          formattingRegions: [],
        },
      ],
    },
  ],
  skippedPages: [],
};

describe("translate remaining pages workflow", () => {
  it("prepares a resumable queue from applied and persisted bulk states", async () => {
    const prepared = await prepareRemainingPages(new Set(), {
      readInventory: async () => inventory,
      loadPageStateSummaries: async () => [
        {
          pageIdentity: "page:page-1",
          status: "applied",
        },
      ],
      loadBulkSummaries: async () => [
        {
          pageId: "page-2",
          fingerprint: pageContentFingerprint(inventory.pages[1]!.blocks),
          pipelineRevision: TRANSLATION_PIPELINE_REVISION,
          status: "ready",
          updatedAt: "2026-08-29T20:00:00.000Z",
        },
      ],
    });

    expect(prepared.workflow.plan.entries.map(({ status }) => status)).toEqual([
      "applied",
      "eligible",
      "eligible",
    ]);

    expect(prepared.queue.entries.map(({ status }) => status)).toEqual([
      "ready",
      "pending",
    ]);
  });

  it("translates only queue entries that remain pending after restore", async () => {
    const translatePending = jest.fn(async (_language, _inventory, queue) => ({
      queue,
      translatedPages: 1,
      failedPages: 0,
    }));

    const result = await translateRemainingPages("en", new Set(), {
      readInventory: async () => inventory,
      loadPageStateSummaries: async () => [
        {
          pageIdentity: "page:page-1",
          status: "applied",
        },
      ],
      loadBulkSummaries: async () => [],
      translatePending,
    });

    expect(translatePending).toHaveBeenCalledTimes(1);

    const passedQueue = translatePending.mock.calls[0]?.[2] as
      | BulkReviewQueue
      | undefined;

    expect(passedQueue?.entries.map(({ status }) => status)).toEqual([
      "pending",
      "pending",
    ]);

    expect(result.translation.translatedPages).toBe(1);
  });

  it("respects manual exclusions before building the bulk queue", async () => {
    const prepared = await prepareRemainingPages(new Set(["page-3"]), {
      readInventory: async () => inventory,
      loadPageStateSummaries: async () => [],
      loadBulkSummaries: async () => [],
    });

    expect(prepared.workflow.plan.entries.map(({ status }) => status)).toEqual([
      "eligible",
      "eligible",
      "excluded",
    ]);

    expect(prepared.queue.entries.map(({ pageId }) => pageId)).toEqual([
      "page-1",
      "page-2",
    ]);
  });
});
