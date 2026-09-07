import {
  ApplyReviewError,
  applyPageReview,
  currentPageMatchesReview,
  readCurrentPageBlocks,
  snapshotFormattingRegions,
  translateCurrentPage,
} from "../translation_review";
import {
  ABBREVIATIONS_HEADING,
  EXPLANATIONS_HEADING,
  CLOSING,
  CLOSING_TR,
  FRONT_NOTICE,
  FRONT_NOTICE_TR,
  GLOSSARY,
  GLOSSARY_TR,
  INSTRUCTIONS,
  INSTRUCTIONS_TR,
  MATERIALS_HEADING,
} from "../static_template_translation";

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
    formatParagraph: jest.fn(),
  };
};

const translationAuth = {
  getDesignToken: (async () => ({ token: "design-jwt" })) as never,
  getUserToken: (async () => "user-jwt") as never,
};

const inventoryBlock = (id: string, sourceText: string, order: number) => ({
  id,
  sourceText,
  order,
  formattingRegions: [
    { index: 0, length: sourceText.length, text: sourceText, formatting: {} },
  ],
});

const currentPageQuery = (texts: readonly string[]) =>
  jest.fn(async (_options, callback) =>
    callback({
      contents: texts.map((text) => range(text)),
      sync: jest.fn(),
    }),
  );

const pageInventory = (
  pageId: string,
  discoveryIndex: number,
  texts: readonly string[],
) => ({
  pageId,
  discoveryIndex,
  locked: false,
  blocks: texts.map((text, index) =>
    inventoryBlock(`${pageId}-block-${index + 1}`, text, index),
  ),
});

const backendTranslations = (fetcher: jest.Mock) => {
  const request = fetcher.mock.calls[0]?.[1];
  return JSON.parse(String(request?.body)) as {
    contentKind?: string;
    blocks: { id: string; text: string }[];
  };
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

  describe("reusable static templates", () => {
    it.each([
      ["en", FRONT_NOTICE.en],
      ["es", FRONT_NOTICE.es],
    ] as const)(
      "reviews a known front cover in %s without a backend request",
      async (language, approvedNotice) => {
        const title = "ARBITRARY LIVE DOLL";
        const page = pageInventory("front-page", 0, [title, FRONT_NOTICE_TR]);
        const fetcher = jest.fn();

        const review = await translateCurrentPage(language, `front-${language}`, {
          queryCurrentPage: currentPageQuery([title, FRONT_NOTICE_TR]) as never,
          getPageMetadata: (async () => ({
            type: "absolute",
            id: "front-page",
          })) as never,
          readInventory: (async () => ({ pages: [page], skippedPages: [] })) as never,
          fetch: fetcher as never,
          ...translationAuth,
        });

        expect(review.blocks.map(({ translated }) => translated)).toEqual([
          title,
          approvedNotice,
        ]);
        expect(review.blocks.every(({ sourceFormattingSignature }) =>
          Boolean(sourceFormattingSignature),
        )).toBe(true);
        expect(fetcher).not.toHaveBeenCalled();
      },
    );

    it("keeps a static front-cover review editable and compatible with Apply", async () => {
      const title = "BUZU";
      const page = pageInventory("front-page", 0, [title, FRONT_NOTICE_TR]);
      const titleRange = mutableRange(title);
      const noticeRange = mutableRange(FRONT_NOTICE_TR);
      const sync = jest.fn();
      const query = jest.fn(async (_options, callback) =>
        callback({ contents: [titleRange, noticeRange], sync }),
      );
      const contextId = "static-front-apply";

      const review = await translateCurrentPage("en", contextId, {
        queryCurrentPage: query as never,
        getPageMetadata: (async () => ({
          type: "absolute",
          id: "front-page",
        })) as never,
        readInventory: (async () => ({ pages: [page], skippedPages: [] })) as never,
        fetch: jest.fn() as never,
        ...translationAuth,
      });
      const notice = review.blocks[1];
      if (!notice) throw new Error("Expected the front-cover notice block.");
      notice.editedTranslation = `${notice.editedTranslation} Reviewed.`;

      await applyPageReview(
        review,
        {
          contextId,
          language: "en",
          pageIdentityKey: "page:front-page",
          pageIdentitySource: "canva_page_id",
        },
        {
          queryCurrentPage: query as never,
          verifyTarget: async () => ({
            isTranslationTarget: true,
            contextId,
            language: "en",
            sourceTitle: "Source",
          }),
          getPageIdentity: async () => ({
            key: "page:front-page",
            source: "canva_page_id",
          }),
          getPageMetadata: (async () => ({
            type: "absolute",
            id: "front-page",
          })) as never,
        },
      );

      expect(titleRange.replaceText).toHaveBeenCalledWith(
        { index: 0, length: title.length },
        title,
      );
      expect(noticeRange.replaceText).toHaveBeenCalledWith(
        { index: 0, length: FRONT_NOTICE_TR.length },
        `${FRONT_NOTICE.en} Reviewed.`,
      );
      expect(sync).toHaveBeenCalledTimes(1);
    });

    it("sends only Page 2's materials body to the backend and restores source order", async () => {
      const materials = "✦ 1 skein tobacco brown yarn\n✦ 2.20 mm hook";
      const texts = [materials, INSTRUCTIONS_TR, ".", GLOSSARY_TR];
      const frontPage = pageInventory("front-page", 0, [
        "DOLL",
        FRONT_NOTICE_TR,
      ]);
      const currentPage = pageInventory("materials-page", 1, texts);
      const fetcher = jest.fn(async () => ({
        ok: true,
        json: async () => ({
          translations: [
            {
              id: "local-block-1",
              source: materials,
              translated: "✦ 1 skein of tobacco brown yarn\n✦ 2.20 mm hook",
              valid: true,
              errors: [],
              warnings: [],
            },
          ],
        }),
      }));

      const review = await translateCurrentPage("en", "materials-page", {
        queryCurrentPage: currentPageQuery(texts) as never,
        getPageMetadata: (async () => ({
          type: "absolute",
          id: "materials-page",
        })) as never,
        readInventory: (async () => ({
          pages: [frontPage, currentPage],
          skippedPages: [],
        })) as never,
        fetch: fetcher as never,
        ...translationAuth,
      });

      expect(backendTranslations(fetcher)).toMatchObject({
        contentKind: "materials",
        blocks: [
          {
            id: "local-block-1",
            text: materials,
            formattingRegions: [{ id: "fmt-0", start: 0, end: materials.length }],
          },
        ],
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(review.blocks.map(({ translated }) => translated)).toEqual([
        "✦ 1 skein of tobacco brown yarn\n✦ 2.20 mm hook",
        INSTRUCTIONS.en,
        ".",
        GLOSSARY.en,
      ]);
    });

    it.each([
      ["en", MATERIALS_HEADING.en, ABBREVIATIONS_HEADING.en, EXPLANATIONS_HEADING.en, GLOSSARY.en, INSTRUCTIONS.en],
      ["es", MATERIALS_HEADING.es, ABBREVIATIONS_HEADING.es, EXPLANATIONS_HEADING.es, GLOSSARY.es, INSTRUCTIONS.es],
    ] as const)(
      "routes the live six-block Page 2 shape through materials-only translation in %s",
      async (
        language,
        materialsHeading,
        abbreviationsHeading,
        explanationsHeading,
        glossary,
        instructions,
      ) => {
        const materials = "✦ Catania 162 Dark Brown\n✦ 2.20 mm tığ";
        const liveCurrentPageTexts = [
          "MALZEMELER",
          "TERİMLER",
          "AÇIKLAMALAR",
          materials,
          GLOSSARY_TR,
          INSTRUCTIONS_TR,
        ];
        const exportedInventoryPage = pageInventory("materials-page", 1, [
          materials,
          INSTRUCTIONS_TR,
          ".",
          GLOSSARY_TR,
        ]);
        const translatedMaterials = `translated ${language} materials`;
        const fetcher = jest.fn(async () => ({
          ok: true,
          json: async () => ({
            translations: [
              {
                id: "local-block-4",
                source: materials,
                translated: translatedMaterials,
                valid: true,
                errors: [],
                warnings: [],
              },
            ],
          }),
        }));

        const review = await translateCurrentPage(
          language,
          `live-materials-${language}`,
          {
            queryCurrentPage: currentPageQuery(liveCurrentPageTexts) as never,
            getPageMetadata: (async () => ({
              type: "absolute",
              id: "materials-page",
            })) as never,
            readInventory: (async () => ({
              pages: [
                pageInventory("front-page", 0, ["DOLL", FRONT_NOTICE_TR]),
                exportedInventoryPage,
              ],
              skippedPages: [],
            })) as never,
            fetch: fetcher as never,
            ...translationAuth,
          },
        );

        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(backendTranslations(fetcher)).toMatchObject({
          contentKind: "materials",
          blocks: [{ id: "local-block-4", text: materials }],
        });
        expect(backendTranslations(fetcher).blocks).toHaveLength(1);
        expect(review.blocks.map(({ translated }) => translated)).toEqual([
          materialsHeading,
          abbreviationsHeading,
          explanationsHeading,
          translatedMaterials,
          glossary,
          instructions,
        ]);
      },
    );

    it("reviews a known closing page without a backend request", async () => {
      const frontPage = pageInventory("front-page", 0, ["BUZU", FRONT_NOTICE_TR]);
      const closingPage = pageInventory("closing-page", 1, CLOSING_TR);
      const fetcher = jest.fn();

      const review = await translateCurrentPage("en", "closing-page", {
        queryCurrentPage: currentPageQuery(CLOSING_TR) as never,
        getPageMetadata: (async () => ({
          type: "absolute",
          id: "closing-page",
        })) as never,
        readInventory: (async () => ({
          pages: [frontPage, closingPage],
          skippedPages: [],
        })) as never,
        fetch: fetcher as never,
        ...translationAuth,
      });

      expect(review.blocks.map(({ translated }) => translated)).toEqual(
        CLOSING.en,
      );
      expect(fetcher).not.toHaveBeenCalled();
    });

    it("uses the normal backend path for an unknown page", async () => {
      const source = "6x sık iğne örüyoruz";
      const page = pageInventory("ordinary-page", 3, [source]);
      const fetcher = jest.fn(async () => ({
        ok: true,
        json: async () => ({
          translations: [
            {
              id: "local-block-1",
              source,
              translated: "Work 6sc",
              valid: true,
              errors: [],
              warnings: [],
            },
          ],
        }),
      }));

      const review = await translateCurrentPage("en", "ordinary-page", {
        queryCurrentPage: currentPageQuery([source]) as never,
        getPageMetadata: (async () => ({
          type: "absolute",
          id: "ordinary-page",
        })) as never,
        readInventory: (async () => ({ pages: [page], skippedPages: [] })) as never,
        fetch: fetcher as never,
        ...translationAuth,
      });

      expect(review.blocks[0]?.translated).toBe("Work 6sc");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(backendTranslations(fetcher).blocks).toHaveLength(1);
    });

    it("fails closed to the normal backend path for a near-match front notice", async () => {
      const changedNotice = FRONT_NOTICE_TR.replace(
        "kişisel kullanım içindir",
        "ticari kullanım içindir",
      );
      const texts = ["BUZU", changedNotice];
      const page = pageInventory("front-page", 0, texts);
      const fetcher = jest.fn(async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as {
          blocks: { id: string; text: string }[];
        };
        return {
          ok: true,
          json: async () => ({
            translations: request.blocks.map(({ id, text }) => ({
              id,
              source: text,
              translated: `LLM: ${text}`,
              valid: true,
              errors: [],
              warnings: [],
            })),
          }),
        };
      });

      const review = await translateCurrentPage("en", "near-front", {
        queryCurrentPage: currentPageQuery(texts) as never,
        getPageMetadata: (async () => ({
          type: "absolute",
          id: "front-page",
        })) as never,
        readInventory: (async () => ({ pages: [page], skippedPages: [] })) as never,
        fetch: fetcher as never,
        ...translationAuth,
      });

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(backendTranslations(fetcher).blocks).toHaveLength(2);
      expect(review.blocks.map(({ translated }) => translated)).toEqual(
        texts.map((text) => `LLM: ${text}`),
      );
    });
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

  it("restores uniform formatting after a manual translation edit", async () => {
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

    expect(content.formatText).toHaveBeenCalledWith(
      { index: 0, length: 8 },
      { color: "#ff0000", fontWeight: "bold" },
    );
  });

  it("allows manual edits within one of multiple inline styles", async () => {
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

    await applyPageReview(
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
    );
    expect(content.replaceText).toHaveBeenCalledWith(
      { index: 0, length: "v örüyoruz".length },
      "increase crochet",
    );
    expect(content.formatText).toHaveBeenCalledWith(
      { index: 0, length: 9 },
      { color: "#ff0000", fontWeight: "bold" },
    );
    expect(content.formatText).toHaveBeenCalledWith(
      { index: 9, length: 7 },
      { color: "#000000", fontWeight: "bold" },
    );
  });

  it("blocks apply when the page identity changes before mutation", async () => {
    const content = mutableRange("same");

    const readQuery = jest.fn(async (_options, callback) =>
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
            source: "same",
            translated: "same translated",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));

    const review = await translateCurrentPage(
      "en",
      "identity-race-context",
      {
        queryCurrentPage: readQuery as never,
        fetch: fetcher as never,
        ...translationAuth,
      },
    );

    const applyQuery = jest.fn();

    await expect(
      applyPageReview(
        review,
        {
          contextId: "identity-race-context",
          language: "en",
          pageIdentityKey: "page:A",
          pageIdentitySource: "canva_page_id",
        },
        {
          verifyTarget: async () => ({
            isTranslationTarget: true,
            language: "en",
            sourceTitle: "Source",
            contextId: "identity-race-context",
          }),
          getPageIdentity: async () => ({
            key: "page:B",
            source: "canva_page_id",
          }),
          queryCurrentPage: applyQuery as never,
        },
      ),
    ).rejects.toMatchObject({ code: "STALE_REVIEW" });

    expect(applyQuery).not.toHaveBeenCalled();
    expect(content.replaceText).not.toHaveBeenCalled();
  });

  it("blocks a page switch after the preflight identity check but before mutation", async () => {
    const content = mutableRange("same");

    const readQuery = jest.fn(async (_options, callback) =>
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
            source: "same",
            translated: "same translated",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));

    const review = await translateCurrentPage(
      "en",
      "identity-session-race-context",
      {
        queryCurrentPage: readQuery as never,
        fetch: fetcher as never,
        ...translationAuth,
      },
    );

    const sync = jest.fn();
    const applyQuery = jest.fn(async (_options, callback) =>
      callback({
        contents: [content],
        sync,
      }),
    );

    await expect(
      applyPageReview(
        review,
        {
          contextId: "identity-session-race-context",
          language: "en",
          pageIdentityKey: "page:A",
          pageIdentitySource: "canva_page_id",
        },
        {
          verifyTarget: async () => ({
            isTranslationTarget: true,
            language: "en",
            sourceTitle: "Source",
            contextId: "identity-session-race-context",
          }),
          // Preflight still sees the reviewed page.
          getPageIdentity: async () => ({
            key: "page:A",
            source: "canva_page_id",
          }),
          // But by the time the edit session is open, Canva reports page B.
          getPageMetadata: async () => ({
            type: "absolute",
            id: "B" as never,
          }),
          queryCurrentPage: applyQuery as never,
        },
      ),
    ).rejects.toMatchObject({ code: "STALE_REVIEW" });

    expect(applyQuery).toHaveBeenCalledTimes(1);
    expect(content.replaceText).not.toHaveBeenCalled();
    expect(content.formatText).not.toHaveBeenCalled();
    expect(content.formatParagraph).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it("fails closed for Apply when only a content-fingerprint page identity is available", async () => {
    const content = mutableRange("same");

    const readQuery = jest.fn(async (_options, callback) =>
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
            source: "same",
            translated: "same translated",
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    }));

    const review = await translateCurrentPage(
      "en",
      "fingerprint-identity-context",
      {
        queryCurrentPage: readQuery as never,
        fetch: fetcher as never,
        ...translationAuth,
      },
    );

    const applyQuery = jest.fn();

    await expect(
      applyPageReview(
        review,
        {
          contextId: "fingerprint-identity-context",
          language: "en",
          pageIdentityKey: "fingerprint:abc123",
          pageIdentitySource: "content_fingerprint",
        },
        {
          verifyTarget: async () => ({
            isTranslationTarget: true,
            language: "en",
            sourceTitle: "Source",
            contextId: "fingerprint-identity-context",
          }),
          getPageIdentity: async () => ({
            key: "fingerprint:abc123",
            source: "content_fingerprint",
          }),
          queryCurrentPage: applyQuery as never,
        },
      ),
    ).rejects.toMatchObject({ code: "STALE_REVIEW" });

    expect(applyQuery).not.toHaveBeenCalled();
    expect(content.replaceText).not.toHaveBeenCalled();
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

  it.each([
    [
      "inline style",
      [{ text: "original", formatting: { color: "#111111" } }],
      [{ text: "original", formatting: { color: "#222222" } }],
    ],
    [
      "paragraph style",
      [
        { text: "original", formatting: { fontRef: "font-noto", fontSize: 18 } },
      ],
      [
        { text: "original", formatting: { fontRef: "font-arimo", fontSize: 12 } },
      ],
    ],
    [
      "region boundary",
      [{ text: "original", formatting: { fontWeight: "normal" } }],
      [
        { text: "orig", formatting: { fontWeight: "normal" } },
        { text: "inal", formatting: { fontWeight: "bold" } },
      ],
    ],
  ])("blocks a formatting-only %s edit before mutation", async (label, initial, changed) => {
    const contextId = `format-${label}`;
    let liveRegions = initial;
    const content = {
      deleted: false,
      readPlaintext: () => "original",
      readTextRegions: () => liveRegions,
      replaceText: jest.fn(),
      formatText: jest.fn(),
      formatParagraph: jest.fn(),
    };
    const sync = jest.fn();
    const query = jest.fn(async (_options, callback) =>
      callback({ contents: [content], sync }),
    );
    const review = await translateCurrentPage("en", contextId, {
      queryCurrentPage: query as never,
      fetch: (async () => ({
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
      })) as never,
      ...translationAuth,
    });
    liveRegions = changed;

    await expect(
      applyPageReview(
        review,
        { contextId, language: "en" },
        {
          queryCurrentPage: query as never,
          verifyTarget: async () => ({
            isTranslationTarget: true,
            language: "en",
            sourceTitle: "Source",
            contextId,
          }),
        },
      ),
    ).rejects.toMatchObject({ code: "STALE_REVIEW" });
    expect(content.replaceText).not.toHaveBeenCalled();
    expect(content.formatText).not.toHaveBeenCalled();
    expect(content.formatParagraph).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
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
