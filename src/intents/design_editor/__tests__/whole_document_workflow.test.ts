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

  it("reports fingerprint-identified applied pages explicitly instead of silently dropping them", async () => {
    // A page can be genuinely absolute (and present in the whole-document
    // inventory under a real pageId) while Canva's getCurrentPageMetadata()
    // still omits its id -- the SDK types that id as optional even for
    // "absolute" pages. When that happens, the current-page apply flow
    // persists the review under a "fingerprint:" identity instead of
    // "page:<id>", and this workflow cannot safely reconcile the two
    // (different hash, no shared input, content can drift). It must not
    // guess -- but it must not hide the fact that it happened either.
    const result = await buildRemainingPagesWorkflow(new Set(), {
      readInventory: async () => inventory,
      loadSummaries: async () => [
        {
          pageIdentity: "fingerprint:legacy-page",
          status: "applied",
        },
        {
          pageIdentity: "fingerprint:another-page",
          status: "applied",
        },
        {
          pageIdentity: "page:page-1",
          status: "applied",
        },
      ],
    });

    // Safety is unchanged: only the reconcilable "page:" identity counts
    // as applied, and page-1 still correctly shows as applied.
    expect(
      result.plan.entries.find(({ pageId }) => pageId === "page-1")?.status,
    ).toBe("applied");
    expect(result.plan.counts.applied).toBe(1);

    // But the two unreconcilable applied pages are now explicit and
    // countable, rather than an invisible drop.
    expect(result.unreconciledAppliedPageIdentities).toBe(2);
  });

  it("reports zero unreconciled applied pages in the common case", async () => {
    const result = await buildRemainingPagesWorkflow(new Set(), {
      readInventory: async () => inventory,
      loadSummaries: async () => [
        { pageIdentity: "page:page-1", status: "applied" },
      ],
    });

    expect(result.unreconciledAppliedPageIdentities).toBe(0);
  });
});

describe("template-candidate diagnostics wiring (development only)", () => {
  const inventoryWithCandidates: WholeDocumentInventory = {
    pages: [
      {
        pageId: "front-cover",
        discoveryIndex: 0,
        locked: false,
        blocks: [
          { id: "b1", sourceText: "Sample Doll", order: 0, formattingRegions: [] },
        ],
      },
      {
        pageId: "page-2",
        discoveryIndex: 1,
        locked: false,
        blocks: [
          { id: "b2", sourceText: "Kulak", order: 0, formattingRegions: [] },
        ],
      },
    ],
    skippedPages: [],
  };

  it("returns and logs diagnostics when isDevelopment is true", async () => {
    const logger = { debug: jest.fn() };

    const result = await buildRemainingPagesWorkflow(new Set(), {
      readInventory: async () => inventoryWithCandidates,
      loadSummaries: async () => [],
      isDevelopment: true,
      logger,
    });

    expect(result.templateCandidateDiagnostics).toEqual([
      {
        pageNumber: 1,
        kind: "front_cover",
        fingerprint: expect.stringMatching(/^page-content-v1-/),
        textBlockCount: 1,
      },
    ]);
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(String(logger.debug.mock.calls[0]?.[0])).toContain("front_cover");
  });

  it("never includes source text in the logged diagnostic", async () => {
    const logger = { debug: jest.fn() };

    await buildRemainingPagesWorkflow(new Set(), {
      readInventory: async () => inventoryWithCandidates,
      loadSummaries: async () => [],
      isDevelopment: true,
      logger,
    });

    const logged = String(logger.debug.mock.calls[0]?.[0]);
    expect(logged).not.toContain("Sample Doll");
  });

  it("omits diagnostics entirely and never logs when isDevelopment is false", async () => {
    const logger = { debug: jest.fn() };

    const result = await buildRemainingPagesWorkflow(new Set(), {
      readInventory: async () => inventoryWithCandidates,
      loadSummaries: async () => [],
      isDevelopment: false,
      logger,
    });

    expect(result.templateCandidateDiagnostics).toBeUndefined();
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it("does not log when isDevelopment is true but there are no template candidates", async () => {
    const logger = { debug: jest.fn() };

    const result = await buildRemainingPagesWorkflow(new Set(), {
      readInventory: async () => inventory,
      loadSummaries: async () => [],
      isDevelopment: true,
      logger,
    });

    expect(result.templateCandidateDiagnostics).toEqual([]);
    expect(logger.debug).not.toHaveBeenCalled();
  });
});
