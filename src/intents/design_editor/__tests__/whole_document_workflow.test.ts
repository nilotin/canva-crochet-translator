import { buildRemainingPagesWorkflow } from "../whole_document_workflow";
import type { WholeDocumentInventory } from "../whole_document_inventory";

const inventory: WholeDocumentInventory = {
  pages: [
    {
      pageId: "page-1",
      discoveryIndex: 3,
      locked: false,
      blocks: [
        {
          id: "block-1",
          sourceText: "6x örüyoruz",
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
          sourceText: "Kulak",
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
          sourceText: "Kaş",
          order: 0,
          formattingRegions: [],
        },
      ],
    },
  ],
  skippedPages: [
    {
      discoveryIndex: 4,
      reason: "Unsupported page",
    },
  ],
};

describe("whole document workflow", () => {
  it("automatically skips pages already persisted as applied", async () => {
    const result = await buildRemainingPagesWorkflow(new Set(), {
      readInventory: async () => inventory,
      loadSummaries: async () => [
        {
          pageIdentity: "page:page-1",
          status: "applied",
        },
        {
          pageIdentity: "page:page-2",
          status: "needs_review",
        },
      ],
    });

    expect(
      result.plan.entries.map(({ pageId, status }) => ({
        pageId,
        status,
      })),
    ).toEqual([
      { pageId: "page-1", status: "applied" },
      { pageId: "page-2", status: "eligible" },
      { pageId: "page-3", status: "eligible" },
    ]);

    expect(result.skippedCanvaPages).toBe(1);
  });

  it("combines persisted applied pages with manual exclusions", async () => {
    const result = await buildRemainingPagesWorkflow(new Set(["page-3"]), {
      readInventory: async () => inventory,
      loadSummaries: async () => [
        {
          pageIdentity: "page:page-1",
          status: "applied",
        },
      ],
    });

    expect(result.plan.entries.map(({ status }) => status)).toEqual([
      "applied",
      "eligible",
      "excluded",
    ]);
  });

  it("ignores non-page fallback identities when building the bulk plan", async () => {
    const result = await buildRemainingPagesWorkflow(new Set(), {
      readInventory: async () => inventory,
      loadSummaries: async () => [
        {
          pageIdentity: "fingerprint:legacy-page",
          status: "applied",
        },
      ],
    });

    expect(result.plan.counts.applied).toBe(0);
    expect(result.plan.counts.eligible).toBe(3);
  });
});
