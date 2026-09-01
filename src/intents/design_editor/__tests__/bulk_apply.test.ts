import { preflightBulkApply, prepareBulkApply } from "../bulk_apply";
import { TRANSLATION_PIPELINE_REVISION } from "../bulk_review_state";
import { pageContentFingerprint } from "../whole_document_classification";
import type { WholeDocumentInventory } from "../whole_document_inventory";

const inventory: WholeDocumentInventory = {
  pages: [
    {
      pageId: "page-1",
      discoveryIndex: 0,
      locked: false,
      blocks: [
        {
          id: "page-page-1-block-1",
          sourceText: "Kulak",
          order: 0,
          formattingRegions: [],
        },
      ],
    },
    {
      pageId: "page-2",
      discoveryIndex: 1,
      locked: true,
      blocks: [
        {
          id: "page-page-2-block-1",
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
          id: "page-page-3-block-1",
          sourceText: "Burun",
          order: 0,
          formattingRegions: [
            {
              index: 0,
              length: 3,
              text: "Bur",
              formatting: { fontWeight: "bold" },
            },
            {
              index: 3,
              length: 2,
              text: "un",
              formatting: {},
            },
          ],
        },
      ],
    },
  ],
  skippedPages: [],
};

const reviewFor = (
  pageId: string,
  overrides: Record<string, unknown> = {},
) => {
  const page = inventory.pages.find((candidate) => candidate.pageId === pageId);

  if (!page) {
    throw new Error("Unknown test page.");
  }

  return {
    pageId,
    fingerprint: pageContentFingerprint(page.blocks),
    pipelineRevision: TRANSLATION_PIPELINE_REVISION,
    status: "ready" as const,
    blocks: page.blocks.map((block) => ({
      id: block.id,
      source: block.sourceText,
      translated: `Translated ${block.sourceText}`,
      editedTranslation: `Translated ${block.sourceText}`,
      validation: "PASS" as const,
      errors: [],
      warnings: [],
    })),
    ...overrides,
  };
};

describe("bulk apply preparation", () => {
  it("fails when a requested persisted review is missing", async () => {
    const result = await prepareBulkApply(["page-1", "page-3"], {
      readInventory: async () => inventory,
      loadReviews: async () => [reviewFor("page-1")],
    });

    expect(result).toEqual({
      ok: false,
      issues: [{ pageId: "page-3", code: "MISSING_REVIEW" }],
      readyPageIds: [],
    });
  });

  it("runs normal preflight when all requested reviews are available", async () => {
    const result = await prepareBulkApply(["page-1"], {
      readInventory: async () => inventory,
      loadReviews: async () => [reviewFor("page-1")],
    });

    expect(result).toEqual({
      ok: true,
      issues: [],
      readyPageIds: ["page-1"],
    });
  });
});

describe("bulk apply preflight", () => {
  it("rejects an empty review set", () => {
    const result = preflightBulkApply(inventory, []);

    expect(result).toEqual({
      ok: false,
      issues: [{ pageId: null, code: "EMPTY_REVIEW_SET" }],
      readyPageIds: [],
    });
  });

  it("rejects duplicate reviews for the same page", () => {
    const review = reviewFor("page-1");

    const result = preflightBulkApply(inventory, [review, review]);

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({
      pageId: "page-1",
      code: "DUPLICATE_PAGE_REVIEW",
    });
    expect(result.readyPageIds).toEqual(["page-1"]);
  });

  it("accepts a fresh ready review", () => {
    const result = preflightBulkApply(inventory, [reviewFor("page-1")]);

    expect(result).toEqual({
      ok: true,
      issues: [],
      readyPageIds: ["page-1"],
    });
  });

  it("rejects a review whose page no longer exists", () => {
    const review = {
      ...reviewFor("page-1"),
      pageId: "missing-page",
    };

    const result = preflightBulkApply(inventory, [review]);

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({
      pageId: "missing-page",
      code: "MISSING_PAGE",
    });
  });

  it("rejects a locked page", () => {
    const result = preflightBulkApply(inventory, [reviewFor("page-2")]);

    expect(result.issues).toContainEqual({
      pageId: "page-2",
      code: "LOCKED_PAGE",
    });
  });

  it("rejects stale fingerprint and pipeline revisions", () => {
    const staleFingerprint = preflightBulkApply(inventory, [
      reviewFor("page-1", {
        fingerprint: "page-content-v1-stale",
      }),
    ]);

    const stalePipeline = preflightBulkApply(inventory, [
      reviewFor("page-1", {
        pipelineRevision: "translation-pipeline-old",
      }),
    ]);

    expect(staleFingerprint.issues[0]?.code).toBe("STALE_REVIEW");
    expect(stalePipeline.issues[0]?.code).toBe("STALE_REVIEW");
  });

  it("rejects blocked reviews", () => {
    const result = preflightBulkApply(inventory, [
      reviewFor("page-1", { status: "blocked" }),
    ]);

    expect(result.issues[0]?.code).toBe("BLOCKED_REVIEW");
  });

  it("requires explicit review before applying warning reviews", () => {
    const result = preflightBulkApply(inventory, [
      reviewFor("page-1", { status: "needs_review" }),
    ]);

    expect(result.issues[0]?.code).toBe("REVIEW_REQUIRED");
    expect(result.readyPageIds).toEqual([]);
  });

  it("rejects source block mismatches", () => {
    const review = reviewFor("page-1");
    review.blocks[0]!.source = "Changed source";

    const result = preflightBulkApply(inventory, [review]);

    expect(result.issues[0]?.code).toBe("BLOCK_MISMATCH");
  });

  it("rejects manual edits when formatting projection is required", () => {
    const review = reviewFor("page-3");
    review.blocks[0]!.editedTranslation = "Manually edited translation";

    const result = preflightBulkApply(inventory, [review]);

    expect(result.issues[0]?.code).toBe("FORMATTING_EDIT_CONFLICT");
  });
});
