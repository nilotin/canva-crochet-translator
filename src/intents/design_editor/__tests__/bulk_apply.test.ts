import {
  applyBulkReviews,
  digestBulkReviewExpectedSnapshot,
  digestBulkReviewSourceSnapshot,
  preflightBulkApply,
  preflightBulkApplySession,
  prepareBulkApply,
  prepareVerifiedBulkApply,
} from "../bulk_apply";
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

describe("bulk apply snapshot digests", () => {
  const pageBlocks = [
    {
      id: "page-page-1-block-1",
      sourceText: "Kulak",
      order: 0,
      formattingRegions: [],
    },
    {
      id: "page-page-1-block-2",
      sourceText: "Burun",
      order: 1,
      formattingRegions: [],
    },
  ];

  it("builds an exact source snapshot independent of local block IDs", () => {
    const renamed = pageBlocks.map((block, index) => ({
      ...block,
      id: `different-${index}`,
    }));

    expect(digestBulkReviewSourceSnapshot(pageBlocks)).toBe(
      digestBulkReviewSourceSnapshot(renamed),
    );
  });

  it("builds the expected snapshot from edited translations", () => {
    const review = {
      ...reviewFor("page-1"),
      blocks: [
        {
          ...reviewFor("page-1").blocks[0]!,
          source: "Kulak",
          translated: "Ear",
          editedTranslation: "Edited ear",
        },
        {
          id: "page-page-1-block-2",
          source: "Burun",
          translated: "Nose",
          editedTranslation: "Edited nose",
          validation: "PASS" as const,
          errors: [],
          warnings: [],
        },
      ],
    };

    const expectedBlocks = [
      {
        ...pageBlocks[0]!,
        sourceText: "Edited ear",
      },
      {
        ...pageBlocks[1]!,
        sourceText: "Edited nose",
      },
    ];

    expect(digestBulkReviewExpectedSnapshot(pageBlocks, review)).toBe(
      digestBulkReviewSourceSnapshot(expectedBlocks),
    );
  });

  it("rejects an expected snapshot when review source mapping does not match", () => {
    const review = {
      ...reviewFor("page-1"),
      blocks: [
        {
          ...reviewFor("page-1").blocks[0]!,
          source: "Different source",
        },
        {
          id: "page-page-1-block-2",
          source: "Burun",
          translated: "Nose",
          editedTranslation: "Nose",
          validation: "PASS" as const,
          errors: [],
          warnings: [],
        },
      ],
    };

    expect(() =>
      digestBulkReviewExpectedSnapshot(pageBlocks, review),
    ).toThrow();
  });
});

describe("bulk apply mutation", () => {
  const makeRange = (text: string) => ({
    readPlaintext: () => text,
    readTextRegions: () => [{ text, formatting: {} }],
    replaceText: jest.fn(),
    formatText: jest.fn(),
  });

  const verifiedTarget = async () => ({
    isTranslationTarget: true as const,
    contextId: "target-context",
    language: "en" as const,
    sourceTitle: "Pattern",
  });

  it("applies all reviewed pages and syncs exactly once", async () => {
    const firstRange = makeRange("Kulak");
    const secondRange = makeRange("Kaş");
    const sync = jest.fn();

    const pages = [
      {
        type: "absolute",
        id: "page-1",
        locked: false,
        elements: {
          toArray: () => [{ type: "text", text: firstRange }],
        },
      },
      {
        type: "absolute",
        id: "page-2",
        locked: false,
        elements: {
          toArray: () => [{ type: "text", text: secondRange }],
        },
      },
    ];

    const pageRefs = [{ type: "absolute" }, { type: "absolute" }];

    const openDesign = jest.fn(async (_options, callback) => {
      const openPage = jest.fn(async (pageRef, pageCallback) => {
        const page = pageRef === pageRefs[0] ? pages[0] : pages[1];
        await pageCallback({ page, helpers: {} });
        return { status: "executed" as const };
      });

      await callback({
        pageRefs: {
          toArray: () => pageRefs,
        },
        helpers: { openPage },
        sync,
      });
    });

    const firstReview = reviewFor("page-1");
    const secondReview = {
      ...reviewFor("page-2"),
      fingerprint: pageContentFingerprint([
        {
          id: "page-page-2-block-1",
          sourceText: "Kaş",
          order: 0,
          formattingRegions: [
            {
              index: 0,
              length: 3,
              text: "Kaş",
              formatting: {},
            },
          ],
        },
      ]),
      blocks: [
        {
          id: "page-page-2-block-1",
          source: "Kaş",
          translated: "Eyebrow",
          editedTranslation: "Eyebrow",
          validation: "PASS" as const,
          errors: [],
          warnings: [],
        },
      ],
    };

    const loadReviews = jest.fn(async () => [
      firstReview,
      secondReview,
    ]);

    const readInventory = jest.fn(async (): Promise<WholeDocumentInventory> => ({
      pages: [
        {
          ...inventory.pages[0]!,
          blocks: [
            {
              ...inventory.pages[0]!.blocks[0]!,
              sourceText: "Translated Kulak",
            },
          ],
        },
        {
          ...inventory.pages[1]!,
          blocks: [
            {
              ...inventory.pages[1]!.blocks[0]!,
              sourceText: "Eyebrow",
            },
          ],
        },
      ],
      skippedPages: [],
    }));

    const saveAppliedPageState = jest.fn(async () => undefined);

    const result = await applyBulkReviews(
      ["page-1", "page-2"],
      {
        contextId: "target-context",
        language: "en",
      },
      {
        verifyTarget: verifiedTarget,
        loadReviews,
        openDesign: openDesign as never,
        readInventory,
        saveAppliedPageState,
      },
    );

    expect(firstRange.replaceText).toHaveBeenCalledWith(
      { index: 0, length: "Kulak".length },
      "Translated Kulak",
    );
    expect(secondRange.replaceText).toHaveBeenCalledWith(
      { index: 0, length: "Kaş".length },
      "Eyebrow",
    );
    expect(sync).toHaveBeenCalledTimes(1);
    expect(loadReviews).toHaveBeenCalledTimes(1);
    expect(readInventory).toHaveBeenCalledTimes(1);
    expect(saveAppliedPageState).toHaveBeenCalledTimes(2);

    const firstSourceDigest = digestBulkReviewSourceSnapshot(
      inventory.pages[0]!.blocks,
    );
    const firstExpectedDigest = digestBulkReviewExpectedSnapshot(
      inventory.pages[0]!.blocks,
      firstReview,
    );

    expect(saveAppliedPageState).toHaveBeenNthCalledWith(
      1,
      "page-1",
      firstReview.blocks,
      firstSourceDigest,
      firstExpectedDigest,
      firstExpectedDigest,
    );

    expect(result.appliedPageIds).toEqual(["page-1", "page-2"]);
    expect(result.verifiedAppliedPageIds).toEqual(["page-1", "page-2"]);
    expect(result.verificationFailedPageIds).toEqual([]);
    expect(result.persistedAppliedPageIds).toEqual(["page-1", "page-2"]);
    expect(result.persistenceFailedPageIds).toEqual([]);
  });

  it("reports a post-sync snapshot mismatch without pretending mutation failed", async () => {
    const range = makeRange("Kulak");
    const sync = jest.fn();

    const page = {
      type: "absolute",
      id: "page-1",
      locked: false,
      elements: {
        toArray: () => [{ type: "text", text: range }],
      },
    };

    const pageRef = { type: "absolute" };

    const openDesign = jest.fn(async (_options, callback) => {
      const openPage = jest.fn(async (_pageRef, pageCallback) => {
        await pageCallback({ page, helpers: {} });
        return { status: "executed" as const };
      });

      await callback({
        pageRefs: {
          toArray: () => [pageRef],
        },
        helpers: { openPage },
        sync,
      });
    });

    const readInventory = jest.fn(async (): Promise<WholeDocumentInventory> => ({
      pages: [
        {
          ...inventory.pages[0]!,
          blocks: [
            {
              ...inventory.pages[0]!.blocks[0]!,
              sourceText: "Unexpected post-sync text",
            },
          ],
        },
      ],
      skippedPages: [],
    }));

    const saveAppliedPageState = jest.fn(async () => undefined);

    const result = await applyBulkReviews(
      ["page-1"],
      {
        contextId: "target-context",
        language: "en",
      },
      {
        verifyTarget: verifiedTarget,
        loadReviews: async () => [reviewFor("page-1")],
        openDesign: openDesign as never,
        readInventory,
        saveAppliedPageState,
      },
    );

    expect(sync).toHaveBeenCalledTimes(1);
    expect(range.replaceText).toHaveBeenCalledWith(
      { index: 0, length: "Kulak".length },
      "Translated Kulak",
    );
    expect(readInventory).toHaveBeenCalledTimes(1);
    expect(saveAppliedPageState).not.toHaveBeenCalled();
    expect(result.appliedPageIds).toEqual(["page-1"]);
    expect(result.verifiedAppliedPageIds).toEqual([]);
    expect(result.verificationFailedPageIds).toEqual(["page-1"]);
    expect(result.persistedAppliedPageIds).toEqual([]);
    expect(result.persistenceFailedPageIds).toEqual([]);
  });

  it("reports verification failure when the post-sync inventory read fails", async () => {
    const range = makeRange("Kulak");
    const sync = jest.fn();

    const page = {
      type: "absolute",
      id: "page-1",
      locked: false,
      elements: {
        toArray: () => [{ type: "text", text: range }],
      },
    };

    const pageRef = { type: "absolute" };

    const openDesign = jest.fn(async (_options, callback) => {
      const openPage = jest.fn(async (_pageRef, pageCallback) => {
        await pageCallback({ page, helpers: {} });
        return { status: "executed" as const };
      });

      await callback({
        pageRefs: {
          toArray: () => [pageRef],
        },
        helpers: { openPage },
        sync,
      });
    });

    const readInventory = jest.fn(async (): Promise<WholeDocumentInventory> => {
      throw new Error("Post-sync inventory read failed.");
    });

    const saveAppliedPageState = jest.fn(async () => undefined);

    const result = await applyBulkReviews(
      ["page-1"],
      {
        contextId: "target-context",
        language: "en",
      },
      {
        verifyTarget: verifiedTarget,
        loadReviews: async () => [reviewFor("page-1")],
        openDesign: openDesign as never,
        readInventory,
        saveAppliedPageState,
      },
    );

    expect(sync).toHaveBeenCalledTimes(1);
    expect(range.replaceText).toHaveBeenCalledWith(
      { index: 0, length: "Kulak".length },
      "Translated Kulak",
    );
    expect(readInventory).toHaveBeenCalledTimes(1);
    expect(saveAppliedPageState).not.toHaveBeenCalled();

    expect(result.appliedPageIds).toEqual(["page-1"]);
    expect(result.verifiedAppliedPageIds).toEqual([]);
    expect(result.verificationFailedPageIds).toEqual(["page-1"]);
    expect(result.persistedAppliedPageIds).toEqual([]);
    expect(result.persistenceFailedPageIds).toEqual([]);
  });

  it("reports persistence failure without pretending the applied mutation failed", async () => {
    const range = makeRange("Kulak");
    const sync = jest.fn();

    const page = {
      type: "absolute",
      id: "page-1",
      locked: false,
      elements: {
        toArray: () => [{ type: "text", text: range }],
      },
    };

    const pageRef = { type: "absolute" };

    const openDesign = jest.fn(async (_options, callback) => {
      const openPage = jest.fn(async (_pageRef, pageCallback) => {
        await pageCallback({ page, helpers: {} });
        return { status: "executed" as const };
      });

      await callback({
        pageRefs: {
          toArray: () => [pageRef],
        },
        helpers: { openPage },
        sync,
      });
    });

    const readInventory = jest.fn(
      async (): Promise<WholeDocumentInventory> => ({
        pages: [
          {
            ...inventory.pages[0]!,
            blocks: [
              {
                ...inventory.pages[0]!.blocks[0]!,
                sourceText: "Translated Kulak",
              },
            ],
          },
        ],
        skippedPages: [],
      }),
    );

    const saveAppliedPageState = jest.fn(async () => {
      throw new Error("Backend persistence failed.");
    });

    const result = await applyBulkReviews(
      ["page-1"],
      {
        contextId: "target-context",
        language: "en",
      },
      {
        verifyTarget: verifiedTarget,
        loadReviews: async () => [reviewFor("page-1")],
        openDesign: openDesign as never,
        readInventory,
        saveAppliedPageState,
      },
    );

    expect(sync).toHaveBeenCalledTimes(1);
    expect(range.replaceText).toHaveBeenCalledWith(
      { index: 0, length: "Kulak".length },
      "Translated Kulak",
    );
    expect(readInventory).toHaveBeenCalledTimes(1);
    expect(saveAppliedPageState).toHaveBeenCalledTimes(1);

    expect(result.appliedPageIds).toEqual(["page-1"]);
    expect(result.verifiedAppliedPageIds).toEqual(["page-1"]);
    expect(result.verificationFailedPageIds).toEqual([]);
    expect(result.persistedAppliedPageIds).toEqual([]);
    expect(result.persistenceFailedPageIds).toEqual(["page-1"]);
  });

  it("projects preserved formatting after replacing translated text", async () => {
    const formatText = jest.fn();
    const replaceText = jest.fn();

    const styledRange = {
      readPlaintext: () => "Burun",
      readTextRegions: () => [
        {
          text: "Bur",
          formatting: { fontWeight: "bold" },
        },
        {
          text: "un",
          formatting: {},
        },
      ],
      replaceText,
      formatText,
    };

    const page = {
      type: "absolute",
      id: "page-3",
      locked: false,
      elements: {
        toArray: () => [
          {
            type: "text",
            text: styledRange,
          },
        ],
      },
    };

    const pageRef = { type: "absolute" };
    const sync = jest.fn();

    const openDesign = jest.fn(async (_options, callback) => {
      const openPage = jest.fn(async (_pageRef, pageCallback) => {
        await pageCallback({ page, helpers: {} });
        return { status: "executed" as const };
      });

      await callback({
        pageRefs: {
          toArray: () => [pageRef],
        },
        helpers: { openPage },
        sync,
      });
    });

    const review = reviewFor("page-3", {
      blocks: [
        {
          id: "page-page-3-block-1",
          source: "Burun",
          translated: "Nose",
          editedTranslation: "Nose",
          validation: "PASS" as const,
          errors: [],
          warnings: [],
          targetFormattingRegions: [
            {
              id: "fmt-0",
              start: 0,
              end: 2,
            },
            {
              id: "fmt-1",
              start: 2,
              end: 4,
            },
          ],
        },
      ],
    });

    const result = await applyBulkReviews(
      ["page-3"],
      {
        contextId: "target-context",
        language: "en",
      },
      {
        verifyTarget: verifiedTarget,
        loadReviews: async () => [review],
        openDesign: openDesign as never,
      },
    );

    expect(replaceText).toHaveBeenCalledWith(
      { index: 0, length: "Burun".length },
      "Nose",
    );

    expect(formatText).toHaveBeenNthCalledWith(
      1,
      { index: 0, length: 2 },
      { fontWeight: "bold" },
    );
    expect(formatText).toHaveBeenNthCalledWith(
      2,
      { index: 2, length: 2 },
      {},
    );

    expect(formatText).toHaveBeenCalledTimes(2);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(result.appliedPageIds).toEqual(["page-3"]);
  });

  it("stops before mutation when the target changes after preflight", async () => {
    const range = makeRange("Kulak");
    const sync = jest.fn();

    const page = {
      type: "absolute",
      id: "page-1",
      locked: false,
      elements: {
        toArray: () => [{ type: "text", text: range }],
      },
    };

    const pageRef = { type: "absolute" };
    let targetChecks = 0;

    const verifyTarget = jest.fn(async () => {
      targetChecks += 1;

      if (targetChecks === 1) {
        return {
          isTranslationTarget: true as const,
          contextId: "target-context",
          language: "en" as const,
          sourceTitle: "Pattern",
        };
      }

      return {
        isTranslationTarget: true as const,
        contextId: "different-context",
        language: "en" as const,
        sourceTitle: "Pattern",
      };
    });

    const openDesign = jest.fn(async (_options, callback) => {
      const openPage = jest.fn(async (_pageRef, pageCallback) => {
        await pageCallback({ page, helpers: {} });
        return { status: "executed" as const };
      });

      await callback({
        pageRefs: {
          toArray: () => [pageRef],
        },
        helpers: { openPage },
        sync,
      });
    });

    await expect(
      applyBulkReviews(
        ["page-1"],
        {
          contextId: "target-context",
          language: "en",
        },
        {
          verifyTarget,
          loadReviews: async () => [reviewFor("page-1")],
          openDesign: openDesign as never,
        },
      ),
    ).rejects.toMatchObject({
      code: "TARGET_VERIFICATION_FAILED",
    });

    expect(verifyTarget).toHaveBeenCalledTimes(2);
    expect(openDesign).toHaveBeenCalledTimes(1);
    expect(range.replaceText).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it("does not sync partial mutations when a later page becomes stale", async () => {
    const firstPreflightRange = makeRange("Kulak");
    const secondPreflightRange = makeRange("Kaş");
    const firstMutationRange = makeRange("Kulak");
    const staleMutationRange = makeRange("Changed");
    const sync = jest.fn();

    const pageRefs = [{ type: "absolute" }, { type: "absolute" }];
    let sessionNumber = 0;

    const openDesign = jest.fn(async (_options, callback) => {
      sessionNumber += 1;

      const pages =
        sessionNumber === 1
          ? [
              {
                type: "absolute",
                id: "page-1",
                locked: false,
                elements: {
                  toArray: () => [
                    { type: "text", text: firstPreflightRange },
                  ],
                },
              },
              {
                type: "absolute",
                id: "page-2",
                locked: false,
                elements: {
                  toArray: () => [
                    { type: "text", text: secondPreflightRange },
                  ],
                },
              },
            ]
          : [
              {
                type: "absolute",
                id: "page-1",
                locked: false,
                elements: {
                  toArray: () => [
                    { type: "text", text: firstMutationRange },
                  ],
                },
              },
              {
                type: "absolute",
                id: "page-2",
                locked: false,
                elements: {
                  toArray: () => [
                    { type: "text", text: staleMutationRange },
                  ],
                },
              },
            ];

      const openPage = jest.fn(async (pageRef, pageCallback) => {
        const page = pageRef === pageRefs[0] ? pages[0] : pages[1];
        await pageCallback({ page, helpers: {} });
        return { status: "executed" as const };
      });

      await callback({
        pageRefs: {
          toArray: () => pageRefs,
        },
        helpers: { openPage },
        sync,
      });
    });

    const secondReview = {
      ...reviewFor("page-2"),
      fingerprint: pageContentFingerprint([
        {
          id: "page-page-2-block-1",
          sourceText: "Kaş",
          order: 0,
          formattingRegions: [
            {
              index: 0,
              length: 3,
              text: "Kaş",
              formatting: {},
            },
          ],
        },
      ]),
      blocks: [
        {
          id: "page-page-2-block-1",
          source: "Kaş",
          translated: "Eyebrow",
          editedTranslation: "Eyebrow",
          validation: "PASS" as const,
          errors: [],
          warnings: [],
        },
      ],
    };

    await expect(
      applyBulkReviews(
        ["page-1", "page-2"],
        {
          contextId: "target-context",
          language: "en",
        },
        {
          verifyTarget: verifiedTarget,
          loadReviews: async () => [
            reviewFor("page-1"),
            secondReview,
          ],
          openDesign: openDesign as never,
        },
      ),
    ).rejects.toMatchObject({
      code: "STALE_REVIEW",
    });

    expect(firstMutationRange.replaceText).toHaveBeenCalledTimes(1);
    expect(staleMutationRange.replaceText).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it("does not enter the mutation session when global preflight fails", async () => {
    const sync = jest.fn();
    const range = makeRange("Changed");
    let sessions = 0;

    const openDesign = jest.fn(async (_options, callback) => {
      sessions += 1;

      const page = {
        type: "absolute",
        id: "page-1",
        locked: false,
        elements: {
          toArray: () => [{ type: "text", text: range }],
        },
      };

      const openPage = jest.fn(async (_pageRef, pageCallback) => {
        await pageCallback({ page, helpers: {} });
        return { status: "executed" as const };
      });

      await callback({
        pageRefs: {
          toArray: () => [{ type: "absolute" }],
        },
        helpers: { openPage },
        sync,
      });
    });

    const result = await applyBulkReviews(
      ["page-1"],
      {
        contextId: "target-context",
        language: "en",
      },
      {
        verifyTarget: verifiedTarget,
        loadReviews: async () => [reviewFor("page-1")],
        openDesign: openDesign as never,
      },
    );

    expect(result.preflight.ok).toBe(false);
    expect(result.appliedPageIds).toEqual([]);
    expect(sessions).toBe(1);
    expect(range.replaceText).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });
});

describe("verified bulk apply preparation", () => {
  it("stops before loading reviews when the target does not match", async () => {
    const loadReviews = jest.fn();
    const openDesign = jest.fn();

    await expect(
      prepareVerifiedBulkApply(
        ["page-1"],
        {
          contextId: "expected-context",
          language: "en",
        },
        {
          verifyTarget: async () => ({
            isTranslationTarget: true,
            contextId: "wrong-context",
            language: "en",
            sourceTitle: "Pattern",
          }),
          loadReviews,
          openDesign: openDesign as never,
        },
      ),
    ).rejects.toMatchObject({
      code: "TARGET_VERIFICATION_FAILED",
    });

    expect(loadReviews).not.toHaveBeenCalled();
    expect(openDesign).not.toHaveBeenCalled();
  });

  it("loads persisted reviews and continues to session preflight for the verified target", async () => {
    const review = reviewFor("page-1");
    const loadReviews = jest.fn(async () => [review]);
    const sync = jest.fn();

    const page = {
      type: "absolute",
      id: "page-1",
      locked: false,
      elements: {
        toArray: () => [
          {
            type: "text",
            text: {
              readPlaintext: () => "Kulak",
              readTextRegions: () => [
                {
                  text: "Kulak",
                  formatting: {},
                },
              ],
            },
          },
        ],
      },
    };

    const openPage = jest.fn(async (_pageRef, callback) => {
      await callback({ page, helpers: {} });
      return { status: "executed" as const };
    });

    const openDesign = jest.fn(async (_options, callback) => {
      await callback({
        pageRefs: {
          toArray: () => [{ type: "absolute" }],
        },
        helpers: { openPage },
        sync,
      });
    });

    const result = await prepareVerifiedBulkApply(
      ["page-1"],
      {
        contextId: "target-context",
        language: "en",
      },
      {
        verifyTarget: async () => ({
          isTranslationTarget: true,
          contextId: "target-context",
          language: "en",
          sourceTitle: "Pattern",
        }),
        loadReviews,
        openDesign: openDesign as never,
      },
    );

    expect(loadReviews).toHaveBeenCalledWith(["page-1"]);
    expect(result.preflight.ok).toBe(true);
    expect(result.preflight.readyPageIds).toEqual(["page-1"]);
    expect(openDesign).toHaveBeenCalledTimes(1);
    expect(sync).not.toHaveBeenCalled();
  });
});

describe("bulk apply session preflight", () => {
  const makeRange = (
    text: string,
    regions = [{ text, formatting: {} }],
  ) => ({
    readPlaintext: () => text,
    readTextRegions: () => regions,
    replaceText: jest.fn(),
    formatText: jest.fn(),
  });

  it("maps fresh target pages without syncing", async () => {
    const sync = jest.fn();
    const targetRange = makeRange("Kulak");

    const page = {
      type: "absolute",
      id: "page-1",
      locked: false,
      elements: {
        toArray: () => [
          {
            type: "text",
            text: targetRange,
          },
        ],
      },
    };

    const pageRef = { type: "absolute" };

    const openPage = jest.fn(async (_pageRef, callback) => {
      await callback({ page, helpers: {} });
      return { status: "executed" as const };
    });

    const openDesign = jest.fn(async (_options, callback) => {
      await callback({
        pageRefs: {
          toArray: () => [pageRef],
        },
        helpers: { openPage },
        sync,
      });
    });

    const result = await preflightBulkApplySession(
      [reviewFor("page-1")],
      { openDesign: openDesign as never },
    );

    expect(result.preflight.ok).toBe(true);
    expect(result.preflight.readyPageIds).toEqual(["page-1"]);
    expect(result.mappings).toHaveLength(1);
    expect(
      result.mappings[0]?.references.get("page-page-1-block-1"),
    ).toBe(targetRange);
    expect(sync).not.toHaveBeenCalled();
  });

  it("keeps block-id mapping correct when blank text ranges are skipped", async () => {
    const sync = jest.fn();
    const firstRange = makeRange("Kulak");
    const blankRange = makeRange("   ");
    const secondRange = makeRange("Kaş");

    const page = {
      type: "absolute",
      id: "page-1",
      locked: false,
      elements: {
        toArray: () => [
          { type: "text", text: firstRange },
          { type: "text", text: blankRange },
          { type: "text", text: secondRange },
        ],
      },
    };

    const pageRef = { type: "absolute" };

    const openPage = jest.fn(async (_pageRef, callback) => {
      await callback({ page, helpers: {} });
      return { status: "executed" as const };
    });

    const openDesign = jest.fn(async (_options, callback) => {
      await callback({
        pageRefs: {
          toArray: () => [pageRef],
        },
        helpers: { openPage },
        sync,
      });
    });

    const review = reviewFor("page-1");
    review.fingerprint = "unused-in-this-test";
    review.blocks = [
      {
        id: "page-page-1-block-1",
        source: "Kulak",
        translated: "Ear",
        editedTranslation: "Ear",
        validation: "PASS",
        errors: [],
        warnings: [],
      },
      {
        id: "page-page-1-block-3",
        source: "Kaş",
        translated: "Eyebrow",
        editedTranslation: "Eyebrow",
        validation: "PASS",
        errors: [],
        warnings: [],
      },
    ];

    const result = await preflightBulkApplySession(
      [review],
      { openDesign: openDesign as never },
    );

    expect(
      result.mappings[0]?.references.get("page-page-1-block-1"),
    ).toBe(firstRange);
    expect(
      result.mappings[0]?.references.get("page-page-1-block-3"),
    ).toBe(secondRange);
    expect(sync).not.toHaveBeenCalled();
  });

  it("fails session preflight when the current source changed", async () => {
    const sync = jest.fn();
    const changedRange = makeRange("Changed");

    const page = {
      type: "absolute",
      id: "page-1",
      locked: false,
      elements: {
        toArray: () => [{ type: "text", text: changedRange }],
      },
    };

    const pageRef = { type: "absolute" };

    const openPage = jest.fn(async (_pageRef, callback) => {
      await callback({ page, helpers: {} });
      return { status: "executed" as const };
    });

    const openDesign = jest.fn(async (_options, callback) => {
      await callback({
        pageRefs: {
          toArray: () => [pageRef],
        },
        helpers: { openPage },
        sync,
      });
    });

    const result = await preflightBulkApplySession(
      [reviewFor("page-1")],
      { openDesign: openDesign as never },
    );

    expect(result.preflight.ok).toBe(false);
    expect(result.preflight.issues[0]?.code).toBe("STALE_REVIEW");
    expect(sync).not.toHaveBeenCalled();
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
