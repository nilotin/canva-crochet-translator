import { translatePendingBulkPages } from "../bulk_translation";
import type { WholeDocumentInventory } from "../whole_document_inventory";
import type { BulkReviewQueue } from "../whole_document_queue";
import {
  FRONT_NOTICE_TR,
  INSTRUCTIONS_TR,
  GLOSSARY_TR,
  CLOSING_TR,
  SELENE_CLOSING_TR,
} from "../static_template_translation";

const inventory: WholeDocumentInventory = {
  pages: [
    {
      pageId: "page-1",
      discoveryIndex: 0,
      locked: false,
      blocks: [
        {
          id: "bulk-block-1",
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
          id: "bulk-block-2",
          sourceText: "Kaş",
          order: 0,
          formattingRegions: [],
        },
      ],
    },
  ],
  skippedPages: [],
};

const queue: BulkReviewQueue = {
  entries: [
    {
      pageId: "page-1",
      discoveryIndex: 0,
      fingerprint: "fp-1",
      status: "pending",
      blockIds: ["bulk-block-1"],
    },
    {
      pageId: "page-2",
      discoveryIndex: 1,
      fingerprint: "fp-2",
      status: "ready",
      blockIds: ["bulk-block-2"],
    },
  ],
  counts: {
    pending: 1,
    translating: 0,
    ready: 1,
    needs_review: 0,
    blocked: 0,
    failed: 0,
  },
};

const translationAuth = {
  getDesignToken: (async () => ({ token: "design-jwt" })) as never,
  getUserToken: (async () => "user-jwt") as never,
};

describe("bulk translation", () => {
  it("translates only pending pages and persists each completed review", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "bulk-block-1",
            source: "Kulak",
            translated: "Ear",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));

    const saveReview = jest.fn(async () => undefined);

    const result = await translatePendingBulkPages("en", inventory, queue, {
      fetch: fetcher as unknown as typeof fetch,
      ...translationAuth,
      backendHost: "http://backend",
      saveReview,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);

    const call = (
      fetcher.mock.calls as unknown as [string, RequestInit][]
    )[0];

    if (!call) throw new Error("Expected a translation request.");

    const [, request] = call;
    const body = JSON.parse(String(request.body));

    expect((request.headers as Record<string, string>).Authorization).toBe(
      "Bearer user-jwt",
    );
    expect(body.designToken).toBe("design-jwt");

    expect(saveReview).toHaveBeenCalledWith({
      pageId: "page-1",
      fingerprint: "fp-1",
      status: "ready",
      blocks: [
        expect.objectContaining({
          id: "bulk-block-1",
          source: "Kulak",
          translated: "Ear",
          editedTranslation: "Ear",
          validation: "PASS",
        }),
      ],
    });

    expect(result.queue.entries.map(({ status }) => status)).toEqual([
      "ready",
      "ready",
    ]);

    expect(result.translatedPages).toBe(1);
    expect(result.failedPages).toBe(0);
  });

  it("sends template candidate metadata to the authenticated backend", async () => {
    const templateInventory: WholeDocumentInventory = {
      pages: [
        {
          pageId: "template-page",
          discoveryIndex: 0,
          locked: false,
          blocks: [
            {
              id: "template-block",
              sourceText: "Synthetic template source",
              order: 0,
              formattingRegions: [],
            },
          ],
        },
      ],
      skippedPages: [],
    };

    const templateQueue: BulkReviewQueue = {
      entries: [
        {
          pageId: "template-page",
          discoveryIndex: 0,
          fingerprint: "page-content-v1-synthetic-template",
          status: "pending",
          blockIds: ["template-block"],
          templateCandidate: true,
        },
      ],
      counts: {
        pending: 1,
        translating: 0,
        ready: 0,
        needs_review: 0,
        blocked: 0,
        failed: 0,
      },
    };

    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "template-block",
            source: "Synthetic template source",
            translated: "Synthetic translated template",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));

    const saveReview = jest.fn(async () => undefined);

    const result = await translatePendingBulkPages(
      "en",
      templateInventory,
      templateQueue,
      {
        fetch: fetcher as unknown as typeof fetch,
        ...translationAuth,
        backendHost: "http://backend",
        saveReview,
      },
    );

    expect(fetcher).toHaveBeenCalledTimes(1);

    const call = (
      fetcher.mock.calls as unknown as [string, RequestInit][]
    )[0];

    if (!call) throw new Error("Expected a translation request.");

    const body = JSON.parse(String(call[1].body));

    expect(body).toMatchObject({
      designToken: "design-jwt",
      targetLanguage: "en",
      templateCandidate: true,
      pageFingerprint: "page-content-v1-synthetic-template",
    });

    expect(result.queue.entries[0]?.status).toBe("ready");
    expect(result.translatedPages).toBe(1);
    expect(result.failedPages).toBe(0);
  });

  it("keeps backend deterministic responses subject to formatting safety checks", async () => {
    const templateInventory: WholeDocumentInventory = {
      pages: [
        {
          pageId: "template-page",
          discoveryIndex: 0,
          locked: false,
          blocks: [
            {
              id: "template-block",
              sourceText: "Synthetic Title",
              order: 0,
              formattingRegions: [
                {
                  index: 0,
                  length: 9,
                  text: "Synthetic",
                  formatting: {
                    fontWeight: "bold",
                  },
                },
                {
                  index: 9,
                  length: 6,
                  text: " Title",
                  formatting: {},
                },
              ],
            },
          ],
        },
      ],
      skippedPages: [],
    };

    const templateQueue: BulkReviewQueue = {
      entries: [
        {
          pageId: "template-page",
          discoveryIndex: 0,
          fingerprint: "page-content-v1-synthetic-template",
          status: "pending",
          blockIds: ["template-block"],
          templateCandidate: true,
        },
      ],
      counts: {
        pending: 1,
        translating: 0,
        ready: 0,
        needs_review: 0,
        blocked: 0,
        failed: 0,
      },
    };

    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "template-block",
            source: "Synthetic Title",
            translated: "Synthetic Heading",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));

    const saveReview = jest.fn(async () => undefined);

    const result = await translatePendingBulkPages(
      "en",
      templateInventory,
      templateQueue,
      {
        fetch: fetcher as unknown as typeof fetch,
        ...translationAuth,
        backendHost: "http://backend",
        saveReview,
      },
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(saveReview).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: "template-page",
        status: "blocked",
        blocks: expect.arrayContaining([
          expect.objectContaining({
            id: "template-block",
            validation: "BLOCK",
            errors: expect.arrayContaining([
              expect.objectContaining({
                code: "FORMATTING_MAPPING_REQUIRED",
              }),
            ]),
          }),
        ]),
      }),
    );

    expect(result.queue.entries[0]?.status).toBe("blocked");
  });

  it("continues after a failed pending page", async () => {
    const twoPending: BulkReviewQueue = {
      entries: queue.entries.map((entry) => ({
        ...entry,
        status: "pending" as const,
      })),
      counts: {
        pending: 2,
        translating: 0,
        ready: 0,
        needs_review: 0,
        blocked: 0,
        failed: 0,
      },
    };

    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          translations: [
            {
              id: "bulk-block-2",
              source: "Kaş",
              translated: "Eyebrow",
              valid: true,
              errors: [],
              warnings: [],
            },
          ],
        }),
      });

    const saveReview = jest.fn(async () => undefined);

    const result = await translatePendingBulkPages(
      "en",
      inventory,
      twoPending,
      {
        fetch: fetcher as unknown as typeof fetch,
      ...translationAuth,
        backendHost: "http://backend",
        saveReview,
      },
    );

    expect(result.queue.entries.map(({ status }) => status)).toEqual([
      "failed",
      "ready",
    ]);

    expect(result.translatedPages).toBe(1);
    expect(result.failedPages).toBe(1);
    expect(saveReview).toHaveBeenCalledTimes(1);
  });


  it(
    "never acquires design/user tokens or calls fetch for a static " +
    "front-cover page, even without the templateCandidate hint",
    async () => {
      const frontCoverInventory: WholeDocumentInventory = {
        pages: [
          {
            pageId: "front-page",
            discoveryIndex: 0,
            locked: false,
            blocks: [
              {
                id: "title-block",
                sourceText: "Buzu Amigurumi Pattern",
                order: 0,
                formattingRegions: [],
              },
              {
                id: "notice-block",
                sourceText: FRONT_NOTICE_TR,
                order: 1,
                formattingRegions: [],
              },
            ],
          },
        ],
        skippedPages: [],
      };

      const frontCoverQueue: BulkReviewQueue = {
        entries: [
          {
            pageId: "front-page",
            discoveryIndex: 0,
            fingerprint: "fp-front",
            status: "pending",
            blockIds: ["title-block", "notice-block"],
            // Deliberately omitted: proves the static match does not
            // depend on the templateCandidate heuristic hint.
          },
        ],
        counts: {
          pending: 1,
          translating: 0,
          ready: 0,
          needs_review: 0,
          blocked: 0,
          failed: 0,
        },
      };

      const getDesignTokenSpy = jest.fn(async () => ({ token: "design-jwt" }));
      const getUserTokenSpy = jest.fn(async () => "user-jwt");
      const fetcher = jest.fn();
      const saveReview = jest.fn(async () => undefined);

      const result = await translatePendingBulkPages(
        "en",
        frontCoverInventory,
        frontCoverQueue,
        {
          fetch: fetcher as unknown as typeof fetch,
          getDesignToken: getDesignTokenSpy as never,
          getUserToken: getUserTokenSpy as never,
          backendHost: "http://backend",
          saveReview,
        },
      );

      expect(getDesignTokenSpy).not.toHaveBeenCalled();
      expect(getUserTokenSpy).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();

      expect(result.queue.entries[0]?.status).toBe("ready");
      expect(result.translatedPages).toBe(1);
      expect(result.failedPages).toBe(0);
    },
  );

  it("Page 2 (plain shape): sends exactly one translation request containing only the materials body, and merges it with the deterministic headings/instructions/glossary result", async () => {
    const page2Inventory: WholeDocumentInventory = {
      pages: [
        {
          pageId: "materials-page",
          discoveryIndex: 1,
          locked: false,
          blocks: [
            {
              id: "materials-block",
              sourceText: "300gr bej ip, 2mm tığ, oyuncak gözü",
              order: 0,
              formattingRegions: [],
            },
            {
              id: "instructions-block",
              sourceText: INSTRUCTIONS_TR,
              order: 1,
              formattingRegions: [],
            },
            {
              id: "dot-block",
              sourceText: ".",
              order: 2,
              formattingRegions: [],
            },
            {
              id: "glossary-block",
              sourceText: GLOSSARY_TR,
              order: 3,
              formattingRegions: [],
            },
          ],
        },
      ],
      skippedPages: [],
    };

    const page2Queue: BulkReviewQueue = {
      entries: [
        {
          pageId: "materials-page",
          discoveryIndex: 1,
          fingerprint: "fp-materials",
          status: "pending",
          blockIds: [
            "materials-block",
            "instructions-block",
            "dot-block",
            "glossary-block",
          ],
        },
      ],
      counts: {
        pending: 1,
        translating: 0,
        ready: 0,
        needs_review: 0,
        blocked: 0,
        failed: 0,
      },
    };

    const getDesignTokenSpy = jest.fn(async () => ({ token: "design-jwt" }));
    const getUserTokenSpy = jest.fn(async () => "user-jwt");
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "materials-block",
            source: "300gr bej ip, 2mm tığ, oyuncak gözü",
            translated: "300g beige yarn, 2mm hook, safety eyes",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));
    const saveReview = jest.fn(async () => undefined);

    const result = await translatePendingBulkPages(
      "en",
      page2Inventory,
      page2Queue,
      {
        fetch: fetcher as unknown as typeof fetch,
        getDesignToken: getDesignTokenSpy as never,
        getUserToken: getUserTokenSpy as never,
        backendHost: "http://backend",
        saveReview,
      },
    );

    // Exactly one token acquisition and one /api/translate request --
    // never the whole page.
    expect(getDesignTokenSpy).toHaveBeenCalledTimes(1);
    expect(getUserTokenSpy).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const [, request] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0]!;
    const body = JSON.parse(String(request.body));

    expect(body.contentKind).toBe("materials");
    expect(body.blocks).toHaveLength(1);
    expect(body.blocks[0].id).toBe("materials-block");
    expect(body.blocks[0].text).toBe("300gr bej ip, 2mm tığ, oyuncak gözü");

    // The instructions/glossary/decorative content must never appear in
    // the request body sent to the LLM.
    const requestedText = JSON.stringify(body.blocks);
    expect(requestedText).not.toContain(INSTRUCTIONS_TR);
    expect(requestedText).not.toContain(GLOSSARY_TR);
    expect(requestedText.includes('"text":"."')).toBe(false);

    // The merged review must contain the LLM-translated materials block
    // alongside the deterministic instructions/glossary/dot entries.
    expect(saveReview).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: "materials-page",
        status: "ready",
        blocks: expect.arrayContaining([
          expect.objectContaining({
            id: "materials-block",
            translated: "300g beige yarn, 2mm hook, safety eyes",
          }),
          expect.objectContaining({ id: "instructions-block" }),
          expect.objectContaining({ id: "glossary-block" }),
          expect.objectContaining({ id: "dot-block", translated: "." }),
        ]),
      }),
    );

    expect(result.queue.entries[0]?.status).toBe("ready");
    expect(result.translatedPages).toBe(1);
    expect(result.failedPages).toBe(0);
  });

  it("Page 2 (headings shape): sends exactly one translation request containing only the materials body, and translates the three headings deterministically", async () => {
    const headingsInventory: WholeDocumentInventory = {
      pages: [
        {
          pageId: "materials-page",
          discoveryIndex: 1,
          locked: false,
          blocks: [
            { id: "materials-heading", sourceText: "MALZEMELER", order: 0, formattingRegions: [] },
            {
              id: "materials-block",
              sourceText: "300gr bej ip, 2mm tığ, oyuncak gözü",
              order: 1,
              formattingRegions: [],
            },
            { id: "explanations-heading", sourceText: "AÇIKLAMALAR", order: 2, formattingRegions: [] },
            { id: "instructions-block", sourceText: INSTRUCTIONS_TR, order: 3, formattingRegions: [] },
            { id: "abbreviations-heading", sourceText: "TERIMLER", order: 4, formattingRegions: [] },
            { id: "glossary-block", sourceText: GLOSSARY_TR, order: 5, formattingRegions: [] },
          ],
        },
      ],
      skippedPages: [],
    };

    const headingsQueue: BulkReviewQueue = {
      entries: [
        {
          pageId: "materials-page",
          discoveryIndex: 1,
          fingerprint: "fp-materials-headings",
          status: "pending",
          blockIds: [
            "materials-heading",
            "materials-block",
            "explanations-heading",
            "instructions-block",
            "abbreviations-heading",
            "glossary-block",
          ],
        },
      ],
      counts: {
        pending: 1,
        translating: 0,
        ready: 0,
        needs_review: 0,
        blocked: 0,
        failed: 0,
      },
    };

    const getDesignTokenSpy = jest.fn(async () => ({ token: "design-jwt" }));
    const getUserTokenSpy = jest.fn(async () => "user-jwt");
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "materials-block",
            source: "300gr bej ip, 2mm tığ, oyuncak gözü",
            translated: "300g beige yarn, 2mm hook, safety eyes",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));
    const saveReview = jest.fn(async () => undefined);

    const result = await translatePendingBulkPages(
      "en",
      headingsInventory,
      headingsQueue,
      {
        fetch: fetcher as unknown as typeof fetch,
        getDesignToken: getDesignTokenSpy as never,
        getUserToken: getUserTokenSpy as never,
        backendHost: "http://backend",
        saveReview,
      },
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [, request] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0]!;
    const body = JSON.parse(String(request.body));
    expect(body.contentKind).toBe("materials");
    expect(body.blocks).toHaveLength(1);
    expect(body.blocks[0].id).toBe("materials-block");

    expect(saveReview).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: "materials-page",
        status: "ready",
        blocks: expect.arrayContaining([
          expect.objectContaining({ id: "materials-heading", translated: "Materials" }),
          expect.objectContaining({ id: "explanations-heading", translated: "Explanations" }),
          expect.objectContaining({ id: "abbreviations-heading", translated: "Abbreviations" }),
          expect.objectContaining({
            id: "materials-block",
            translated: "300g beige yarn, 2mm hook, safety eyes",
          }),
        ]),
      }),
    );

    expect(result.queue.entries[0]?.status).toBe("ready");
    expect(result.translatedPages).toBe(1);
  });

  it("falls back to the normal full-page backend pipeline when Page 2 is not statically recognized (e.g. missing/altered instructions text)", async () => {
    const unrecognizedInventory: WholeDocumentInventory = {
      pages: [
        {
          pageId: "materials-page",
          discoveryIndex: 1,
          locked: false,
          blocks: [
            { id: "materials-block", sourceText: "300gr bej ip", order: 0, formattingRegions: [] },
            { id: "unknown-block", sourceText: "Some unrelated paragraph.", order: 1, formattingRegions: [] },
          ],
        },
      ],
      skippedPages: [],
    };

    const unrecognizedQueue: BulkReviewQueue = {
      entries: [
        {
          pageId: "materials-page",
          discoveryIndex: 1,
          fingerprint: "fp-unrecognized",
          status: "pending",
          blockIds: ["materials-block", "unknown-block"],
        },
      ],
      counts: {
        pending: 1,
        translating: 0,
        ready: 0,
        needs_review: 0,
        blocked: 0,
        failed: 0,
      },
    };

    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "materials-block",
            source: "300gr bej ip",
            translated: "300g beige yarn",
            valid: true,
            errors: [],
            warnings: [],
          },
          {
            id: "unknown-block",
            source: "Some unrelated paragraph.",
            translated: "Some unrelated paragraph translated.",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));
    const saveReview = jest.fn(async () => undefined);

    const result = await translatePendingBulkPages(
      "en",
      unrecognizedInventory,
      unrecognizedQueue,
      {
        fetch: fetcher as unknown as typeof fetch,
        ...translationAuth,
        backendHost: "http://backend",
        saveReview,
      },
    );

    // Falls through to the normal pipeline: BOTH blocks go to the LLM in
    // a single request, never the privileged materials-only path.
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [, request] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0]!;
    const body = JSON.parse(String(request.body));
    expect(body.blocks).toHaveLength(2);
    expect(result.queue.entries[0]?.status).toBe("ready");
  });

  it("does not mark Page 2 as Ready when the materials translation request fails", async () => {
    const page2Inventory: WholeDocumentInventory = {
      pages: [
        {
          pageId: "materials-page",
          discoveryIndex: 1,
          locked: false,
          blocks: [
            { id: "materials-block", sourceText: "300gr bej ip", order: 0, formattingRegions: [] },
            { id: "instructions-block", sourceText: INSTRUCTIONS_TR, order: 1, formattingRegions: [] },
            { id: "glossary-block", sourceText: GLOSSARY_TR, order: 2, formattingRegions: [] },
          ],
        },
      ],
      skippedPages: [],
    };

    const page2Queue: BulkReviewQueue = {
      entries: [
        {
          pageId: "materials-page",
          discoveryIndex: 1,
          fingerprint: "fp-materials-fail",
          status: "pending",
          blockIds: ["materials-block", "instructions-block", "glossary-block"],
        },
      ],
      counts: {
        pending: 1,
        translating: 0,
        ready: 0,
        needs_review: 0,
        blocked: 0,
        failed: 0,
      },
    };

    const fetcher = jest.fn(async () => ({ ok: false, json: async () => ({}) }));
    const saveReview = jest.fn(async () => undefined);

    const result = await translatePendingBulkPages(
      "en",
      page2Inventory,
      page2Queue,
      {
        fetch: fetcher as unknown as typeof fetch,
        ...translationAuth,
        backendHost: "http://backend",
        saveReview,
      },
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.queue.entries[0]?.status).toBe("failed");
    expect(result.failedPages).toBe(1);
    expect(result.translatedPages).toBe(0);
    // A failed materials translation must never be silently persisted as
    // a Ready page.
    expect(saveReview).not.toHaveBeenCalledWith(
      expect.objectContaining({ pageId: "materials-page", status: "ready" }),
    );
  });

  it("does not mark Page 2 as Ready when the materials translation response is malformed (missing/extra entries)", async () => {
    const page2Inventory: WholeDocumentInventory = {
      pages: [
        {
          pageId: "materials-page",
          discoveryIndex: 1,
          locked: false,
          blocks: [
            { id: "materials-block", sourceText: "300gr bej ip", order: 0, formattingRegions: [] },
            { id: "instructions-block", sourceText: INSTRUCTIONS_TR, order: 1, formattingRegions: [] },
            { id: "glossary-block", sourceText: GLOSSARY_TR, order: 2, formattingRegions: [] },
          ],
        },
      ],
      skippedPages: [],
    };

    const page2Queue: BulkReviewQueue = {
      entries: [
        {
          pageId: "materials-page",
          discoveryIndex: 1,
          fingerprint: "fp-materials-malformed",
          status: "pending",
          blockIds: ["materials-block", "instructions-block", "glossary-block"],
        },
      ],
      counts: {
        pending: 1,
        translating: 0,
        ready: 0,
        needs_review: 0,
        blocked: 0,
        failed: 0,
      },
    };

    // Malformed: response omits the requested materials-block id
    // entirely (e.g. backend returned an empty/wrong translations array).
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({ translations: [] }),
    }));
    const saveReview = jest.fn(async () => undefined);

    const result = await translatePendingBulkPages(
      "en",
      page2Inventory,
      page2Queue,
      {
        fetch: fetcher as unknown as typeof fetch,
        ...translationAuth,
        backendHost: "http://backend",
        saveReview,
      },
    );

    expect(result.queue.entries[0]?.status).toBe("failed");
    expect(result.failedPages).toBe(1);
    expect(saveReview).not.toHaveBeenCalledWith(
      expect.objectContaining({ pageId: "materials-page", status: "ready" }),
    );
  });

  it("never acquires design/user tokens or calls fetch for the static closing page (Buzu)", async () => {
    // The closing route now requires the page to be the document's
    // ACTUAL final page (see static_template_translation.ts's
    // isFinalPage) AND requires the document's actual front-cover title
    // to be readable from this SAME inventory (see
    // StaticTemplateDocumentContext.firstPage / extractFrontCoverTitle),
    // so this fixture must include a real front-cover page at
    // discoveryIndex 0 -- not just filler. In the real product,
    // "isolating" the closing page via exclusion still reads the FULL
    // document inventory (see translate_remaining_workflow.ts --
    // exclusion only affects which queue entries are pending, never what
    // readWholeDocumentInventory returns), so a realistic fixture keeps
    // every page slot present: the real front cover, the closing page,
    // and filler skippedPages for the pages in between. These filler
    // slots are not in the queue below, so the routing loop never looks
    // at them.
    const closingInventory: WholeDocumentInventory = {
      pages: [
        {
          pageId: "front-page",
          discoveryIndex: 0,
          locked: false,
          blocks: [
            { id: "title-block", sourceText: "BUZU", order: 0, formattingRegions: [] },
            { id: "notice-block", sourceText: FRONT_NOTICE_TR, order: 1, formattingRegions: [] },
          ],
        },
        {
          pageId: "closing-page",
          discoveryIndex: 8,
          locked: false,
          blocks: CLOSING_TR.map((text, index) => ({
            id: `closing-block-${index}`,
            sourceText: text,
            order: index,
            formattingRegions: [],
          })),
        },
      ],
      skippedPages: Array.from({ length: 7 }, (_, offset) => ({
        discoveryIndex: offset + 1,
        reason: "not relevant to this test",
      })),
    };

    const closingQueue: BulkReviewQueue = {
      entries: [
        {
          pageId: "closing-page",
          discoveryIndex: 8,
          fingerprint: "fp-closing",
          status: "pending",
          blockIds: CLOSING_TR.map((_, index) => `closing-block-${index}`),
        },
      ],
      counts: {
        pending: 1,
        translating: 0,
        ready: 0,
        needs_review: 0,
        blocked: 0,
        failed: 0,
      },
    };

    const getDesignTokenSpy = jest.fn(async () => ({ token: "design-jwt" }));
    const getUserTokenSpy = jest.fn(async () => "user-jwt");
    const fetcher = jest.fn();
    const saveReview = jest.fn(async () => undefined);

    const result = await translatePendingBulkPages(
      "en",
      closingInventory,
      closingQueue,
      {
        fetch: fetcher as unknown as typeof fetch,
        getDesignToken: getDesignTokenSpy as never,
        getUserToken: getUserTokenSpy as never,
        backendHost: "http://backend",
        saveReview,
      },
    );

    expect(getDesignTokenSpy).not.toHaveBeenCalled();
    expect(getUserTokenSpy).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();

    expect(result.queue.entries[0]?.status).toBe("ready");
    expect(result.translatedPages).toBe(1);
    expect(result.failedPages).toBe(0);
  });

  it("never acquires design/user tokens or calls fetch for the static closing page (Selene Doll, real 38-page document)", async () => {
    // Same shape as the Buzu proof above, but for a different pattern
    // name and a genuinely different (larger) document -- proves the
    // zero-token static route is not Buzu-specific and does not depend
    // on any particular total page count.
    const closingInventory: WholeDocumentInventory = {
      pages: [
        {
          pageId: "front-page",
          discoveryIndex: 0,
          locked: false,
          blocks: [
            { id: "title-block", sourceText: "SELENE DOLL", order: 0, formattingRegions: [] },
            { id: "notice-block", sourceText: FRONT_NOTICE_TR, order: 1, formattingRegions: [] },
          ],
        },
        {
          pageId: "closing-page",
          discoveryIndex: 37,
          locked: false,
          blocks: SELENE_CLOSING_TR.map((text, index) => ({
            id: `closing-block-${index}`,
            sourceText: text,
            order: index,
            formattingRegions: [],
          })),
        },
      ],
      skippedPages: Array.from({ length: 36 }, (_, offset) => ({
        discoveryIndex: offset + 1,
        reason: "not relevant to this test",
      })),
    };

    const closingQueue: BulkReviewQueue = {
      entries: [
        {
          pageId: "closing-page",
          discoveryIndex: 37,
          fingerprint: "fp-closing-selene",
          status: "pending",
          blockIds: SELENE_CLOSING_TR.map((_, index) => `closing-block-${index}`),
        },
      ],
      counts: {
        pending: 1,
        translating: 0,
        ready: 0,
        needs_review: 0,
        blocked: 0,
        failed: 0,
      },
    };

    const getDesignTokenSpy = jest.fn(async () => ({ token: "design-jwt" }));
    const getUserTokenSpy = jest.fn(async () => "user-jwt");
    const fetcher = jest.fn();
    const saveReview = jest.fn(async () => undefined);

    const result = await translatePendingBulkPages(
      "en",
      closingInventory,
      closingQueue,
      {
        fetch: fetcher as unknown as typeof fetch,
        getDesignToken: getDesignTokenSpy as never,
        getUserToken: getUserTokenSpy as never,
        backendHost: "http://backend",
        saveReview,
      },
    );

    expect(getDesignTokenSpy).not.toHaveBeenCalled();
    expect(getUserTokenSpy).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();

    expect(saveReview).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: "closing-page",
        blocks: expect.arrayContaining([
          expect.objectContaining({
            id: "closing-block-2",
            translated: "You've Completed Selene!",
          }),
        ]),
      }),
    );

    expect(result.queue.entries[0]?.status).toBe("ready");
    expect(result.translatedPages).toBe(1);
    expect(result.failedPages).toBe(0);
  });

  it("still uses the authenticated backend for an ordinary (non-static) page -- regression guard", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "bulk-block-1",
            source: "Kulak",
            translated: "Ear",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));

    const saveReview = jest.fn(async () => undefined);

    await translatePendingBulkPages("en", inventory, queue, {
      fetch: fetcher as unknown as typeof fetch,
      ...translationAuth,
      backendHost: "http://backend",
      saveReview,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("marks persistence failure as failed instead of pretending the page is resumable", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "bulk-block-1",
            source: "Kulak",
            translated: "Ear",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));

    const result = await translatePendingBulkPages("en", inventory, queue, {
      fetch: fetcher as unknown as typeof fetch,
      ...translationAuth,
      backendHost: "http://backend",
      saveReview: async () => {
        throw new Error("Persistence unavailable.");
      },
    });

    expect(result.queue.entries[0]?.status).toBe("failed");
    expect(result.translatedPages).toBe(0);
    expect(result.failedPages).toBe(1);
  });
});
