import {
  ApplyReviewError,
  applyPageReview,
  currentPageMatchesReview,
  readCurrentPageBlocks,
  snapshotFormattingRegions,
  translateCurrentPage,
} from "../translation_review";

const range = (text: string, deleted = false) => ({
  deleted,
  readPlaintext: () => text,
  readTextRegions: () => [{ text, formatting: {} }],
});

const mutableRange = (
  initial: string,
  regions = [{ text: initial, formatting: {} }],
) => {
  let text = initial;

  return {
    deleted: false,
    readPlaintext: () => text,
    readTextRegions: () => regions,
    replaceText: jest.fn((_bounds, replacement: string) => {
      text = replacement;
      return { bounds: { index: 0, length: replacement.length } };
    }),
    formatText: jest.fn(),
  };
};

const translationAuth = {
  getDesignToken: (async () => ({ token: "design-jwt" })) as never,
  getUserToken: (async () => "user-jwt") as never,
};

describe("translation review", () => {
  it("snapshots formatting regions with cumulative bounds", () => {
    const regions = snapshotFormattingRegions([
      {
        text: "6x, ",
        formatting: { color: "#000000" },
      },
      {
        text: "v",
        formatting: {
          color: "#ff0000",
          fontWeight: "bold",
        },
      },
      {
        text: ", 4x",
        formatting: { color: "#000000" },
      },
    ]);

    expect(regions).toEqual([
      {
        index: 0,
        length: 4,
        text: "6x, ",
        formatting: { color: "#000000" },
      },
      {
        index: 4,
        length: 1,
        text: "v",
        formatting: {
          color: "#ff0000",
          fontWeight: "bold",
        },
      },
      {
        index: 5,
        length: 4,
        text: ", 4x",
        formatting: { color: "#000000" },
      },
    ]);
  });

  it("reads separate non-empty current-page blocks and includes pattern-only text", async () => {
    const sync = jest.fn();
    const query = jest.fn(async (_options, callback) => {
      await callback({
        contents: [
          range("  "),
          range("55 zn çekiyoruz."),
          range("6x, v, 6x, CC"),
          range("deleted", true),
        ],
        sync,
      });
    });
    const blocks = await readCurrentPageBlocks(query as never);
    expect(blocks).toEqual([
      { localId: "local-block-2", sourceText: "55 zn çekiyoruz.", order: 1 },
      { localId: "local-block-3", sourceText: "6x, v, 6x, CC", order: 2 },
    ]);
    expect(query).toHaveBeenCalledWith(
      { contentType: "richtext", target: "current_page" },
      expect.any(Function),
    );
    expect(sync).not.toHaveBeenCalled();
  });

  it("sends only local IDs/text and maps returned results by ID", async () => {
    const query = jest.fn(async (_options, callback) =>
      callback({
        contents: [range("first"), range("second")],
        sync: jest.fn(),
      }),
    );
    const fetcher = jest.fn(async (_url, init) => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "local-block-2",
            source: "second",
            translated: "dos",
            valid: true,
            errors: [],
            warnings: [],
          },
          {
            id: "local-block-1",
            source: "first",
            translated: "uno",
            valid: true,
            errors: [],
            warnings: [],
            targetFormattingRegions: [
              {
                id: "fmt-0",
                start: 0,
                end: 3,
              },
            ],
          },
        ],
      }),
      requestBody: init?.body,
    }));
    const review = await translateCurrentPage("es", "context-test", {
      queryCurrentPage: query as never,
      fetch: fetcher as never,
      ...translationAuth,
      backendHost: "http://backend",
    });
    expect(review.blocks.map(({ translated }) => translated)).toEqual([
      "uno",
      "dos",
    ]);

    expect(review.blocks[0]?.targetFormattingRegions).toEqual([
      {
        id: "fmt-0",
        start: 0,
        end: 3,
      },
    ]);
    const request = fetcher.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));

    expect((request?.headers as Record<string, string>).Authorization).toBe(
      "Bearer user-jwt",
    );
    expect(body.designToken).toBe("design-jwt");
    expect(body.blocks).toEqual([
      {
        id: "local-block-1",
        text: "first",
        formattingRegions: [
          {
            id: "fmt-0",
            start: 0,
            end: 5,
          },
        ],
      },
      {
        id: "local-block-2",
        text: "second",
        formattingRegions: [
          {
            id: "fmt-0",
            start: 0,
            end: 6,
          },
        ],
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("readPlaintext");
  });

  it("treats a numeric integrity diagnostic plus semantic warnings as BLOCK", async () => {
    const query = jest.fn(async (_options, callback) =>
      callback({
        contents: [range("2.00 no tığ ile örüyoruz.")],
        sync: jest.fn(),
      }),
    );
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "local-block-1",
            source: "2.00 no tığ ile örüyoruz.",
            translated: "2.00 2.00 crochet without a hook.",
            valid: true,
            errors: [],
            warnings: [
              { code: "NUMBER_MISMATCH", message: "Segment 1 mismatch" },
              {
                code: "MANUAL_REVIEW_RECOMMENDED",
                message: "Segment 18 review",
              },
            ],
          },
        ],
      }),
    }));
    const review = await translateCurrentPage("en", "severity-test", {
      queryCurrentPage: query as never,
      fetch: fetcher as never,
      ...translationAuth,
      backendHost: "http://backend",
    });
    expect(review.reviewStatus).toBe("blocked");
    expect(review.blocks[0]?.validation).toBe("BLOCK");
    expect(review.blocks[0]?.errors[0]?.code).toBe("NUMBER_MISMATCH");
  });

  it.each([
    [{ translations: [] }],
    [
      {
        translations: [
          {
            id: "local-block-1",
            source: "first",
            translated: "one",
            valid: true,
            errors: [],
            warnings: [],
          },
          {
            id: "local-block-1",
            source: "first",
            translated: "one",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      },
    ],
  ])("blocks missing or duplicate returned IDs", async (payload) => {
    const query = jest.fn(async (_options, callback) =>
      callback({ contents: [range("first")], sync: jest.fn() }),
    );
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => payload,
    }));
    await expect(
      translateCurrentPage("en", "context-test", {
        queryCurrentPage: query as never,
        fetch: fetcher as never,
      ...translationAuth,
      }),
    ).rejects.toThrow("block IDs");
  });

  it("computes blocked page readiness from backend validation", async () => {
    const query = jest.fn(async (_options, callback) =>
      callback({ contents: [range("6x")], sync: jest.fn() }),
    );
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "local-block-1",
            source: "6x",
            translated: "",
            valid: false,
            errors: [
              { code: "LOST_PATTERN_NOTATION", message: "Notation was lost." },
            ],
            warnings: [],
          },
        ],
      }),
    }));
    const review = await translateCurrentPage("en", "context-test", {
      queryCurrentPage: query as never,
      fetch: fetcher as never,
      ...translationAuth,
    });
    expect(review.reviewStatus).toBe("blocked");
    expect(review.blocks[0]?.validation).toBe("BLOCK");
  });

  it("applies edited text to exact mapped ranges and syncs once without another model call", async () => {
    const first = mutableRange("first");
    const second = mutableRange("second");
    const sync = jest.fn(async () => undefined);
    const query = jest.fn(async (_options, callback) =>
      callback({ contents: [first, second], sync }),
    );
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "local-block-1",
            source: "first",
            translated: "one",
            valid: true,
            errors: [],
            warnings: [],
          },
          {
            id: "local-block-2",
            source: "second",
            translated: "two",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));
    const review = await translateCurrentPage("en", "apply-context", {
      queryCurrentPage: query as never,
      fetch: fetcher as never,
      ...translationAuth,
    });
    const firstReviewBlock = review.blocks[0];
    if (!firstReviewBlock) throw new Error("Expected the first review block.");
    firstReviewBlock.editedTranslation = "edited one";
    const result = await applyPageReview(
      review,
      { contextId: "apply-context", language: "en" },
      {
        verifyTarget: async () => ({
          isTranslationTarget: true,
          language: "en",
          sourceTitle: "Source",
          contextId: "apply-context",
        }),
        queryCurrentPage: query as never,
      },
    );
    expect(first.replaceText).toHaveBeenCalledWith(
      { index: 0, length: 5 },
      "edited one",
    );
    expect(second.replaceText).toHaveBeenCalledWith(
      { index: 0, length: 6 },
      "two",
    );
    expect(sync).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ appliedBlocks: 2, layoutReviewRecommended: true });
    await expect(
      applyPageReview(
        review,
        { contextId: "apply-context", language: "en" },
        {
          verifyTarget: async () => ({
            isTranslationTarget: true,
            language: "en",
            sourceTitle: "Source",
            contextId: "apply-context",
          }),
          queryCurrentPage: query as never,
        },
      ),
    ).rejects.toMatchObject({ code: "ALREADY_APPLIED" });
  });

  it("applies duplicate source text blocks by their original block order", async () => {
    const first = mutableRange("Turn.");
    const second = mutableRange("Turn.");
    const sync = jest.fn(async () => undefined);

    const query = jest.fn(async (_options, callback) =>
      callback({
        contents: [first, second],
        sync,
      }),
    );

    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "local-block-1",
            source: "Turn.",
            translated: "Turn first.",
            valid: true,
            errors: [],
            warnings: [],
          },
          {
            id: "local-block-2",
            source: "Turn.",
            translated: "Turn second.",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));

    const review = await translateCurrentPage(
      "en",
      "duplicate-text-context",
      {
        queryCurrentPage: query as never,
        fetch: fetcher as never,
      ...translationAuth,
      },
    );

    await applyPageReview(
      review,
      {
        contextId: "duplicate-text-context",
        language: "en",
      },
      {
        verifyTarget: async () => ({
          isTranslationTarget: true,
          language: "en",
          sourceTitle: "Source",
          contextId: "duplicate-text-context",
        }),
        queryCurrentPage: query as never,
      },
    );

    expect(first.replaceText).toHaveBeenCalledWith(
      { index: 0, length: 5 },
      "Turn first.",
    );
    expect(second.replaceText).toHaveBeenCalledWith(
      { index: 0, length: 5 },
      "Turn second.",
    );
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("fails closed when fresh Canva block order changes", async () => {
    const first = mutableRange("First");
    const second = mutableRange("Second");

    const readQuery = jest.fn(async (_options, callback) =>
      callback({
        contents: [first, second],
        sync: jest.fn(),
      }),
    );

    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "local-block-1",
            source: "First",
            translated: "Uno",
            valid: true,
            errors: [],
            warnings: [],
          },
          {
            id: "local-block-2",
            source: "Second",
            translated: "Dos",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));

    const review = await translateCurrentPage(
      "en",
      "reordered-context",
      {
        queryCurrentPage: readQuery as never,
        fetch: fetcher as never,
      ...translationAuth,
      },
    );

    const applyQuery = jest.fn(async (_options, callback) =>
      callback({
        contents: [second, first],
        sync: jest.fn(),
      }),
    );

    await expect(
      applyPageReview(
        review,
        {
          contextId: "reordered-context",
          language: "en",
        },
        {
          verifyTarget: async () => ({
            isTranslationTarget: true,
            language: "en",
            sourceTitle: "Source",
            contextId: "reordered-context",
          }),
          queryCurrentPage: applyQuery as never,
        },
      ),
    ).rejects.toMatchObject({
      code: "MISSING_MAPPING",
    });

    expect(first.replaceText).not.toHaveBeenCalled();
    expect(second.replaceText).not.toHaveBeenCalled();
  });

  it("blocks a multi-style text block when formatting projection is missing", async () => {
    const content = mutableRange("6x örüyoruz", [
      {
        text: "6x ",
        formatting: {
          color: "#ff7f66",
          fontWeight: "bold",
        },
      },
      {
        text: "örüyoruz",
        formatting: {
          color: "#000000",
        },
      },
    ]);

    const query = jest.fn(async (_options, callback) =>
      callback({
        contents: [content],
        sync: jest.fn(),
      }),
    );

    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "local-block-1",
            source: "6x örüyoruz",
            translated: "Work 6sc",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));

    const review = await translateCurrentPage("en", "missing-format-context", {
      queryCurrentPage: query as never,
      fetch: fetcher as never,
      ...translationAuth,
    });

    expect(review.reviewStatus).toBe("blocked");
    expect(review.blocks[0]?.validation).toBe("BLOCK");
    expect(review.blocks[0]?.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "FORMATTING_MAPPING_REQUIRED",
        }),
      ]),
    );
  });

  it("preserves projected inline formatting on translated notation", async () => {
    const content = mutableRange("6x, v, 4x", [
      { text: "6x, ", formatting: { color: "#000000" } },
      {
        text: "v",
        formatting: {
          color: "#ff0000",
          fontWeight: "bold",
        },
      },
      { text: ", 4x", formatting: { color: "#000000" } },
    ]);

    const sync = jest.fn(async () => undefined);

    const query = jest.fn(async (_options, callback) =>
      callback({
        contents: [content],
        sync,
      }),
    );

    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "local-block-1",
            source: "6x, v, 4x",
            translated: "6sc, inc, 4sc",
            valid: true,
            errors: [],
            warnings: [],
            targetFormattingRegions: [
              { id: "fmt-0", start: 0, end: 5 },
              { id: "fmt-1", start: 5, end: 8 },
              { id: "fmt-2", start: 8, end: 13 },
            ],
          },
        ],
      }),
    }));

    const review = await translateCurrentPage("en", "format-context", {
      queryCurrentPage: query as never,
      fetch: fetcher as never,
      ...translationAuth,
    });

    await applyPageReview(
      review,
      { contextId: "format-context", language: "en" },
      {
        verifyTarget: async () => ({
          isTranslationTarget: true,
          language: "en",
          sourceTitle: "Source",
          contextId: "format-context",
        }),
        queryCurrentPage: query as never,
      },
    );

    expect(content.replaceText).toHaveBeenCalledWith(
      { index: 0, length: 9 },
      "6sc, inc, 4sc",
    );

    expect(content.formatText).toHaveBeenCalledWith(
      { index: 5, length: 3 },
      expect.objectContaining({
        color: "#ff0000",
        fontWeight: "bold",
      }),
    );

    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("preserves separate inline styles across mixed notation and prose", async () => {
    const content = mutableRange("6x örüyoruz", [
      {
        text: "6x ",
        formatting: {
          color: "#ff7f66",
          fontWeight: "bold",
        },
      },
      {
        text: "örüyoruz",
        formatting: {
          color: "#000000",
        },
      },
    ]);

    const sync = jest.fn(async () => undefined);

    const query = jest.fn(async (_options, callback) =>
      callback({
        contents: [content],
        sync,
      }),
    );

    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "local-block-1",
            source: "6x örüyoruz",
            translated: "6sc crochet",
            valid: true,
            errors: [],
            warnings: [],
            targetFormattingRegions: [
              { id: "fmt-0", start: 0, end: 4 },
              { id: "fmt-1", start: 4, end: 11 },
            ],
          },
        ],
      }),
    }));

    const review = await translateCurrentPage("en", "mixed-format-context", {
      queryCurrentPage: query as never,
      fetch: fetcher as never,
      ...translationAuth,
    });

    expect(review.reviewStatus).toBe("ready");

    await applyPageReview(
      review,
      {
        contextId: "mixed-format-context",
        language: "en",
      },
      {
        verifyTarget: async () => ({
          isTranslationTarget: true,
          language: "en",
          sourceTitle: "Source",
          contextId: "mixed-format-context",
        }),
        queryCurrentPage: query as never,
      },
    );

    expect(content.replaceText).toHaveBeenCalledWith(
      { index: 0, length: 11 },
      "6sc crochet",
    );

    expect(content.formatText).toHaveBeenCalledWith(
      { index: 0, length: 4 },
      expect.objectContaining({
        color: "#ff7f66",
        fontWeight: "bold",
      }),
    );

    expect(content.formatText).toHaveBeenCalledWith(
      { index: 4, length: 7 },
      expect.objectContaining({
        color: "#000000",
      }),
    );

    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("does not apply projected formatting after a manual translation edit", async () => {
    const content = mutableRange("v", [
      {
        text: "v",
        formatting: {
          color: "#ff0000",
          fontWeight: "bold",
        },
      },
    ]);

    const query = jest.fn(async (_options, callback) =>
      callback({
        contents: [content],
        sync: jest.fn(async () => undefined),
      }),
    );

    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "local-block-1",
            source: "v",
            translated: "inc",
            valid: true,
            errors: [],
            warnings: [],
            targetFormattingRegions: [{ id: "fmt-0", start: 0, end: 3 }],
          },
        ],
      }),
    }));

    const review = await translateCurrentPage("en", "manual-format-context", {
      queryCurrentPage: query as never,
      fetch: fetcher as never,
      ...translationAuth,
    });

    const block = review.blocks[0];
    if (!block) throw new Error("Expected review block.");

    block.editedTranslation = "increase";

    await applyPageReview(
      review,
      { contextId: "manual-format-context", language: "en" },
      {
        verifyTarget: async () => ({
          isTranslationTarget: true,
          language: "en",
          sourceTitle: "Source",
          contextId: "manual-format-context",
        }),
        queryCurrentPage: query as never,
      },
    );

    expect(content.replaceText).toHaveBeenCalledWith(
      { index: 0, length: 1 },
      "increase",
    );

    expect(content.formatText).not.toHaveBeenCalled();
  });

  it("blocks manual edits when a block contains multiple inline styles", async () => {
    const content = mutableRange("v örüyoruz", [
      {
        text: "v ",
        formatting: {
          color: "#ff0000",
          fontWeight: "bold",
        },
      },
      {
        text: "örüyoruz",
        formatting: {
          color: "#000000",
          fontWeight: "bold",
        },
      },
    ]);

    const query = jest.fn(async (_options, callback) =>
      callback({
        contents: [content],
        sync: jest.fn(async () => undefined),
      }),
    );

    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "local-block-1",
            source: "v örüyoruz",
            translated: "inc crochet",
            valid: true,
            errors: [],
            warnings: [],
            targetFormattingRegions: [
              { id: "fmt-0", start: 0, end: 4 },
              { id: "fmt-1", start: 4, end: 11 },
            ],
          },
        ],
      }),
    }));

    const review = await translateCurrentPage("en", "manual-multi-style", {
      queryCurrentPage: query as never,
      fetch: fetcher as never,
      ...translationAuth,
    });

    const block = review.blocks[0];
    if (!block) throw new Error("Expected review block.");

    block.editedTranslation = "increase crochet";

    await expect(
      applyPageReview(
        review,
        { contextId: "manual-multi-style", language: "en" },
        {
          verifyTarget: async () => ({
            isTranslationTarget: true,
            language: "en",
            sourceTitle: "Source",
            contextId: "manual-multi-style",
          }),
          queryCurrentPage: query as never,
        },
      ),
    ).rejects.toMatchObject({
      code: "FORMATTING_EDIT_CONFLICT",
    });

    expect(content.replaceText).not.toHaveBeenCalled();
    expect(content.formatText).not.toHaveBeenCalled();
  });

  it("blocks stale reviews before mutating", async () => {
    const content = mutableRange("original");
    const query = jest.fn(async (_options, callback) =>
      callback({ contents: [content], sync: jest.fn() }),
    );
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "local-block-1",
            source: "original",
            translated: "translation",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));
    const review = await translateCurrentPage("en", "stale-context", {
      queryCurrentPage: query as never,
      fetch: fetcher as never,
      ...translationAuth,
    });
    const freshQuery = jest.fn(async (_options, callback) =>
      callback({
        contents: [mutableRange("changed in Canva")],
        sync: jest.fn(),
      }),
    );
    await expect(
      applyPageReview(
        review,
        { contextId: "stale-context", language: "en" },
        {
          verifyTarget: async () => ({
            isTranslationTarget: true,
            language: "en",
            sourceTitle: "Source",
            contextId: "stale-context",
          }),
          queryCurrentPage: freshQuery as never,
        },
      ),
    ).rejects.toBeInstanceOf(ApplyReviewError);
    expect(content.replaceText).not.toHaveBeenCalled();
  });

  it("does not reuse a review when the current-page snapshot differs", async () => {
    const query = jest.fn(async (_options, callback) =>
      callback({ contents: [range("different page")], sync: jest.fn() }),
    );
    await expect(
      currentPageMatchesReview(
        {
          reviewStatus: "ready",
          blocks: [
            {
              id: "local-block-1",
              source: "previous page",
              translated: "previous page",
              editedTranslation: "previous page",
              validation: "PASS",
              errors: [],
              warnings: [],
            },
          ],
        },
        "snapshot-context",
        query as never,
      ),
    ).resolves.toBe(false);
  });

  it("requires the exact verified target and an active mapping", async () => {
    const review = { blocks: [], reviewStatus: "ready" as const };
    await expect(
      applyPageReview(
        review,
        { contextId: "missing", language: "en" },
        {
          verifyTarget: async () => ({ isTranslationTarget: false }),
        },
      ),
    ).rejects.toMatchObject({ code: "TARGET_VERIFICATION_FAILED" });
    await expect(
      applyPageReview(
        review,
        { contextId: "missing", language: "en" },
        {
          verifyTarget: async () => ({
            isTranslationTarget: true,
            language: "en",
            sourceTitle: "Source",
            contextId: "missing",
          }),
        },
      ),
    ).rejects.toMatchObject({ code: "MISSING_MAPPING" });
  });

  it("does not mark a review applied when sync fails", async () => {
    const content = mutableRange("same");
    const sync = jest
      .fn()
      .mockRejectedValueOnce(new Error("sync failed"))
      .mockResolvedValueOnce(undefined);
    const query = jest.fn(async (_options, callback) =>
      callback({ contents: [content], sync }),
    );
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        translations: [
          {
            id: "local-block-1",
            source: "same",
            translated: "same",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));
    const review = await translateCurrentPage("en", "sync-context", {
      queryCurrentPage: query as never,
      fetch: fetcher as never,
      ...translationAuth,
    });
    const dependencies = {
      verifyTarget: async () => ({
        isTranslationTarget: true as const,
        language: "en" as const,
        sourceTitle: "Source",
        contextId: "sync-context",
      }),
      queryCurrentPage: query as never,
    };
    await expect(
      applyPageReview(
        review,
        { contextId: "sync-context", language: "en" },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "SYNC_FAILED" });
    await expect(
      applyPageReview(
        review,
        { contextId: "sync-context", language: "en" },
        dependencies,
      ),
    ).resolves.toMatchObject({ appliedBlocks: 1 });
    expect(sync).toHaveBeenCalledTimes(2);
  });
});
