import { App } from "../app";
import type { CopiedDesign, TargetLanguage } from "../copy_designs";
import type { SourceDesignContext } from "../source_design_context";
import { renderInTestProvider } from "../../../utils/test_render";
import { fireEvent, waitFor } from "@testing-library/react";

const emptyProgressSummary = {
  applied: 0,
  reviewed: 0,
  needsReview: 0,
  blocked: 0,
};

describe("Crochet Translator", () => {
  const pageTrackingProps = {
    getPageIdentity: async () => ({
      key: "page:page-1",
      source: "canva_page_id" as const,
    }),
    loadPageState: async () => ({
      disposition: "unreviewed" as const,
      appliedCount: 0,
      progressSummary: emptyProgressSummary,
      currentSnapshotDigest: "source-digest",
    }),
    savePageReview: async () => undefined,
    savePageApplied: async () => undefined,
    readSnapshotDigest: async () => "applied-digest",
    loadBulkPreferences: async () => ({ excludedPageIds: [] }),
    saveBulkPreferences: async () => undefined,
  };
  const verifiedContext: SourceDesignContext = {
    verified: true,
    title: "Ayıcık Tarifi",
    pageCount: 3,
  };

  const renderApp = (
    loadSourceContext: () => Promise<SourceDesignContext> = async () =>
      verifiedContext,
    copyDesign: (
      language: TargetLanguage,
      sourceTitle?: string,
    ) => Promise<CopiedDesign> = async (language) => ({
      language,
      copiedDesignId: `copy-${language}`,
      editUrl: `https://www.canva.com/design/copy-${language}/edit`,
      desiredTitle: `Ayıcık Tarifi - ${language.toUpperCase()}`,
      reused: false,
    }),
    openDesign: (url: string) => Promise<unknown> = async () => undefined,
  ) => {
    const result = renderInTestProvider(
      <App
        loadSourceContext={loadSourceContext}
        initialDesignRole={{ status: "source" }}
        copyDesign={copyDesign}
        openDesign={openDesign}
      />,
    );
    const english = result.getByRole("checkbox", { name: "English" });
    const spanish = result.getByRole("checkbox", { name: "Español" });
    const createButton = result.getByRole("button", {
      name: "Create translated copies",
    });

    return { createButton, english, result, spanish };
  };

  it("disables the CTA if source verification fails", async () => {
    const { createButton, english, result } = renderApp(async () => {
      throw new Error("verification failed");
    });
    fireEvent.click(english);

    await waitFor(() =>
      expect(
        result.getByText("Could not verify the current Canva design."),
      ).toBeTruthy(),
    );
    expect(createButton.getAttribute("aria-disabled")).toBe("true");
  });

  it("disables the CTA when no target language is selected", async () => {
    const { createButton, result } = renderApp();

    await result.findByText("Source design detected");
    expect(createButton.getAttribute("aria-disabled")).toBe("true");
    expect(
      result.queryByRole("button", { name: "Apply translation to this page" }),
    ).toBeNull();
  });

  it("enables the CTA only with verified source and a language", async () => {
    const { createButton, english, result } = renderApp();

    await result.findByText("Source design detected");
    fireEvent.click(english);

    expect(english).toHaveProperty("checked", true);
    expect(createButton.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("allows both target languages to be selected", async () => {
    const { createButton, english, result, spanish } = renderApp();

    await result.findByText("Source design detected");
    fireEvent.click(english);
    fireEvent.click(spanish);

    expect(english).toHaveProperty("checked", true);
    expect(spanish).toHaveProperty("checked", true);
    expect(createButton.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("shows design title and page count when metadata exists", async () => {
    const { result } = renderApp();

    expect(await result.findByText("Ayıcık Tarifi")).toBeTruthy();
    expect(result.getByText("3 pages")).toBeTruthy();
  });

  it("handles a missing design title gracefully", async () => {
    const { result } = renderApp(async () => ({
      verified: true,
      pageCount: 1,
    }));

    expect(await result.findByText("Untitled design")).toBeTruthy();
    expect(result.getByText("1 page")).toBeTruthy();
  });

  it("selected English triggers only the English copy", async () => {
    const copyDesign = jest.fn(async (language: TargetLanguage) => ({
      language,
      copiedDesignId: "copy-en",
      editUrl: "https://www.canva.com/exact-en",
      desiredTitle: "Ayıcık Tarifi - EN",
      reused: false,
    }));
    const { createButton, english, result } = renderApp(undefined, copyDesign);

    await result.findByText("Source design detected");
    fireEvent.click(english);
    fireEvent.click(createButton);
    await result.findByText("English copy created.");
    expect(copyDesign).toHaveBeenCalledTimes(1);
    expect(copyDesign).toHaveBeenCalledWith("en", "Ayıcık Tarifi");
  });

  it("selected Spanish triggers only the Spanish copy", async () => {
    const copyDesign = jest.fn(async (language: TargetLanguage) => ({
      language,
      copiedDesignId: "copy-es",
      editUrl: "https://www.canva.com/exact-es",
      desiredTitle: "Ayıcık Tarifi - ES",
      reused: false,
    }));
    const { createButton, result, spanish } = renderApp(undefined, copyDesign);
    await result.findByText("Source design detected");
    fireEvent.click(spanish);
    fireEvent.click(createButton);
    await result.findByText("Spanish copy created.");
    expect(copyDesign).toHaveBeenCalledWith("es", "Ayıcık Tarifi");
  });

  it("creates both selected copies and uses Canva's returned edit URL", async () => {
    const copyDesign = jest.fn(async (language: TargetLanguage) => ({
      language,
      copiedDesignId: `copy-${language}`,
      editUrl: `https://www.canva.com/exact-${language}`,
      desiredTitle: `Ayıcık Tarifi - ${language.toUpperCase()}`,
      reused: false,
    }));
    const openDesign = jest.fn(async () => undefined);
    const { createButton, english, result, spanish } = renderApp(
      undefined,
      copyDesign,
      openDesign,
    );
    await result.findByText("Source design detected");
    fireEvent.click(english);
    fireEvent.click(spanish);
    fireEvent.click(createButton);
    await result.findByText("English copy created.");
    await result.findByText("Spanish copy created.");
    expect(copyDesign).toHaveBeenCalledTimes(2);
    const openButton = result.getAllByRole("button", {
      name: "Open design",
    })[0];
    if (!openButton) throw new Error("Open design button was not rendered.");
    fireEvent.click(openButton);
    expect(openDesign).toHaveBeenCalledWith("https://www.canva.com/exact-en");
    expect(result.getByText("Ayıcık Tarifi")).toBeTruthy();
  });

  it("retains success and retries only a failed language", async () => {
    let spanishAttempts = 0;
    const copyDesign = jest.fn(async (language: TargetLanguage) => {
      if (language === "es" && spanishAttempts++ === 0)
        throw new Error("failed");
      return {
        language,
        copiedDesignId: `copy-${language}`,
        editUrl: `https://www.canva.com/${language}`,
        desiredTitle: `Title - ${language}`,
        reused: false,
      };
    });
    const { createButton, english, result, spanish } = renderApp(
      undefined,
      copyDesign,
    );
    await result.findByText("Source design detected");
    fireEvent.click(english);
    fireEvent.click(spanish);
    fireEvent.click(createButton);
    await result.findByText("English copy created.");
    await result.findByText("Copy failed");
    expect(copyDesign).toHaveBeenCalledTimes(2);
    fireEvent.click(result.getByRole("button", { name: "Retry" }));
    await result.findByText("Spanish copy created.");
    expect(copyDesign).toHaveBeenCalledTimes(3);
    expect(
      copyDesign.mock.calls.filter(([language]) => language === "en"),
    ).toHaveLength(1);
  });

  it("does not call translation or content mutation APIs", async () => {
    const copyDesign = jest.fn(async (language: TargetLanguage) => ({
      language,
      copiedDesignId: "copy",
      editUrl: "https://www.canva.com/copy",
      desiredTitle: "Copy",
      reused: false,
    }));
    const { createButton, english, result } = renderApp(undefined, copyDesign);
    await result.findByText("Source design detected");
    fireEvent.click(english);
    fireEvent.click(createButton);
    await result.findByText("English copy created.");

    expect(copyDesign).toHaveBeenCalledWith("en", "Ayıcık Tarifi");
  });

  it("shows the review workflow for a recognized target and edits locally", async () => {
    const reviewPage = jest.fn(async () => ({
      reviewStatus: "needs_review" as const,
      blocks: [
        {
          id: "local-block-1",
          source: "55 zn çekiyoruz.",
          translated: "Ch 55.",
          editedTranslation: "Ch 55.",
          validation: "WARNING" as const,
          errors: [],
          warnings: [
            { code: "MANUAL_REVIEW_RECOMMENDED", message: "Check wording." },
          ],
        },
      ],
    }));
    const result = renderInTestProvider(
      <App
        loadSourceContext={async () => verifiedContext}
        initialDesignRole={{
          status: "target",
          context: {
            isTranslationTarget: true,
            language: "en",
            sourceTitle: "Masal Doll Turkish",
            contextId: "target-context-1",
          },
        }}
        reviewPage={reviewPage}
        {...pageTrackingProps}
      />,
    );
    const reviewButton = await result.findByRole("button", {
      name: "Review current page",
    });
    await waitFor(() =>
      expect(reviewButton.getAttribute("aria-disabled")).not.toBe("true"),
    );
    expect(
      result.queryByRole("button", { name: "Create translated copies" }),
    ).toBeNull();
    expect(reviewPage).not.toHaveBeenCalled();
    fireEvent.click(reviewButton);
    const input = await result.findByRole("textbox", { name: "Translation" });
    expect(input).toHaveProperty("value", "Ch 55.");
    expect(result.getByText("Manual review recommended")).toBeTruthy();
    const applyButton = result.getByRole("button", {
      name: "Apply reviewed translation",
    });
    expect(applyButton.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(
      result.getByRole("checkbox", { name: "I reviewed the warnings" }),
    );
    expect(applyButton.getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.change(input, { target: { value: "Ch 55, then turn." } });
    expect(result.getByText("Edited")).toBeTruthy();
    expect(reviewPage).toHaveBeenCalledTimes(1);
    expect(
      result.getByRole("button", { name: "Translate again" }),
    ).toBeTruthy();
  });

  it("renders a persisted target on a fresh mount with no previous React state", async () => {
    const loadDesignRole = jest.fn(async () => ({
      isTranslationTarget: true as const,
      language: "es" as const,
      sourceTitle: "Masal Doll Turkish",
      contextId: "persisted-operation-id",
    }));
    const result = renderInTestProvider(
      <App
        loadSourceContext={async () => verifiedContext}
        loadDesignRole={loadDesignRole}
        getPageIdentity={pageTrackingProps.getPageIdentity}
        loadPageState={pageTrackingProps.loadPageState}
        savePageReview={pageTrackingProps.savePageReview}
        savePageApplied={pageTrackingProps.savePageApplied}
        readSnapshotDigest={pageTrackingProps.readSnapshotDigest}
      />,
    );

    expect(await result.findByText("Spanish")).toBeTruthy();
    expect(result.getByText("Masal Doll Turkish")).toBeTruthy();
    expect(
      result.getByRole("button", { name: "Review current page" }),
    ).toBeTruthy();
    expect(
      result.queryByRole("button", { name: "Create translated copies" }),
    ).toBeNull();
    expect(loadDesignRole).toHaveBeenCalledTimes(1);
  });

  it("inspects remaining pages without starting translation", async () => {
    const prepareRemaining = jest.fn(async () => ({
      workflow: {
        plan: {
          entries: [],
          counts: {
            eligible: 5,
            applied: 2,
            excluded: 1,
            locked: 1,
            empty: 1,
            template_candidate: 2,
          },
        },
        skippedCanvaPages: [],
      },
      queue: {
        entries: [],
        counts: {
          pending: 3,
          translating: 0,
          ready: 1,
          needs_review: 1,
          blocked: 0,
          failed: 0,
        },
      },
    }));

    const translateRemaining = jest.fn();

    const result = renderInTestProvider(
      <App
        loadSourceContext={async () => verifiedContext}
        initialDesignRole={{
          status: "target",
          context: {
            isTranslationTarget: true,
            language: "en",
            sourceTitle: "Masal Doll Turkish",
            contextId: "bulk-plan-context",
          },
        }}
        prepareRemaining={prepareRemaining as never}
        translateRemaining={translateRemaining as never}
        {...pageTrackingProps}
      />,
    );

    const checkButton = await result.findByRole("button", {
      name: "Check remaining pages",
    });

    expect(prepareRemaining).not.toHaveBeenCalled();
    expect(translateRemaining).not.toHaveBeenCalled();

    fireEvent.click(checkButton);

    await result.findByText("Eligible: 5");

    expect(prepareRemaining).toHaveBeenCalledTimes(1);
    expect(translateRemaining).not.toHaveBeenCalled();

    expect(result.getByText("Already applied: 2")).toBeTruthy();
    expect(result.getByText("Excluded: 1")).toBeTruthy();
    expect(result.getByText("Locked: 1")).toBeTruthy();
    expect(result.getByText("Empty: 1")).toBeTruthy();
    expect(result.getByText("Template candidates: 2")).toBeTruthy();
    expect(result.getByText("Ready from saved bulk review: 1")).toBeTruthy();
    expect(
      result.getByText("Needs review from saved bulk review: 1"),
    ).toBeTruthy();
    expect(result.getByText("Pending translation: 3")).toBeTruthy();
  });

  it("maps excluded Canva page numbers to page IDs for check and translation", async () => {
    const makePrepared = (excludedPageIds: ReadonlySet<string>) => ({
      workflow: {
        plan: {
          entries: [
            {
              pageId: "page-3",
              discoveryIndex: 2,
              fingerprint: "fp-3",
              classification: "content" as const,
              status: excludedPageIds.has("page-3")
                ? ("excluded" as const)
                : ("eligible" as const),
              textBlockCount: 1,
            },
            {
              pageId: "page-7",
              discoveryIndex: 6,
              fingerprint: "fp-7",
              classification: "content" as const,
              status: excludedPageIds.has("page-7")
                ? ("excluded" as const)
                : ("eligible" as const),
              textBlockCount: 1,
            },
          ],
          counts: {
            eligible: 2 - excludedPageIds.size,
            applied: 0,
            excluded: excludedPageIds.size,
            locked: 0,
            empty: 0,
            template_candidate: 0,
          },
        },
        skippedCanvaPages: [],
      },
      queue: {
        entries: [],
        counts: {
          pending: 2 - excludedPageIds.size,
          translating: 0,
          ready: 0,
          needs_review: 0,
          blocked: 0,
          failed: 0,
        },
      },
    });

    const prepareRemaining = jest.fn(
      async (excludedPageIds: ReadonlySet<string> = new Set()) =>
        makePrepared(excludedPageIds),
    );

    const translateRemaining = jest.fn(
      async (
        _language: string,
        excludedPageIds: ReadonlySet<string> = new Set(),
      ) => ({
        ...makePrepared(excludedPageIds),
        translation: {
          queue: makePrepared(excludedPageIds).queue,
          translatedPages: 0,
          failedPages: 0,
        },
      }),
    );

    const loadBulkPreferences = jest.fn(async () => ({
      excludedPageIds: ["page-7"],
    }));
    const saveBulkPreferences = jest.fn(async () => undefined);

    const result = renderInTestProvider(
      <App
        loadSourceContext={async () => verifiedContext}
        initialDesignRole={{
          status: "target",
          context: {
            isTranslationTarget: true,
            language: "en",
            sourceTitle: "Masal Doll Turkish",
            contextId: "bulk-exclusion-context",
          },
        }}
        prepareRemaining={prepareRemaining as never}
        translateRemaining={translateRemaining as never}
        {...pageTrackingProps}
        loadBulkPreferences={loadBulkPreferences}
        saveBulkPreferences={saveBulkPreferences}
      />,
    );

    const checkButton = await result.findByRole("button", {
      name: "Check remaining pages",
    });

    await waitFor(() => {
      expect(loadBulkPreferences).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(checkButton);

    await result.findByText("Eligible: 1");

    const exclusionInput = result.getByLabelText("Exclude page numbers");

    await waitFor(() => {
      expect((exclusionInput as HTMLTextAreaElement).value).toBe("7");
    });

    expect(prepareRemaining).toHaveBeenLastCalledWith(new Set(["page-7"]));
    expect(saveBulkPreferences).toHaveBeenLastCalledWith(new Set(["page-7"]));

    fireEvent.change(exclusionInput, {
      target: { value: "3, 7" },
    });

    fireEvent.click(checkButton);

    await result.findByText("Excluded: 2");

    expect(prepareRemaining).toHaveBeenLastCalledWith(
      new Set(["page-3", "page-7"]),
    );
    expect(saveBulkPreferences).toHaveBeenLastCalledWith(
      new Set(["page-3", "page-7"]),
    );

    const translateButton = result.getByRole("button", {
      name: "Translate remaining pages",
    });

    fireEvent.click(translateButton);

    await result.findByText("Remaining-page translation review completed.");

    expect(translateRemaining).toHaveBeenCalledWith(
      "en",
      new Set(["page-3", "page-7"]),
    );
    expect(saveBulkPreferences).toHaveBeenLastCalledWith(
      new Set(["page-3", "page-7"]),
    );
    expect(saveBulkPreferences).toHaveBeenCalledTimes(3);
  });

  it("continues bulk work when preference persistence fails", async () => {
    const makePrepared = () => ({
      workflow: {
        plan: {
          entries: [],
          counts: {
            eligible: 1,
            applied: 0,
            excluded: 0,
            locked: 0,
            empty: 0,
            template_candidate: 0,
          },
        },
        skippedCanvaPages: [],
      },
      queue: {
        entries: [],
        counts: {
          pending: 1,
          translating: 0,
          ready: 0,
          needs_review: 0,
          blocked: 0,
          failed: 0,
        },
      },
    });

    const prepareRemaining = jest.fn(async () => makePrepared());
    const translateRemaining = jest.fn(async () => ({
      ...makePrepared(),
      translation: {
        queue: makePrepared().queue,
        translatedPages: 1,
        failedPages: 0,
      },
    }));
    const saveBulkPreferences = jest.fn(async () => {
      throw new Error("persistence unavailable");
    });

    const result = renderInTestProvider(
      <App
        loadSourceContext={async () => verifiedContext}
        initialDesignRole={{
          status: "target",
          context: {
            isTranslationTarget: true,
            language: "en",
            sourceTitle: "Masal Doll Turkish",
            contextId: "bulk-persistence-failure-context",
          },
        }}
        prepareRemaining={prepareRemaining as never}
        translateRemaining={translateRemaining as never}
        {...pageTrackingProps}
        saveBulkPreferences={saveBulkPreferences}
      />,
    );

    const checkButton = await result.findByRole("button", {
      name: "Check remaining pages",
    });

    fireEvent.click(checkButton);

    await result.findByText("Eligible: 1");
    expect(prepareRemaining).toHaveBeenCalledTimes(1);

    const translateButton = result.getByRole("button", {
      name: "Translate remaining pages",
    });

    fireEvent.click(translateButton);

    await result.findByText("Remaining-page translation review completed.");
    expect(translateRemaining).toHaveBeenCalledTimes(1);
  });

  it("translates remaining pages only after explicit user action", async () => {
    const translateRemaining = jest.fn(async () => ({
      workflow: {
        plan: {
          entries: [],
          counts: {
            eligible: 0,
            applied: 0,
            excluded: 0,
            locked: 0,
            empty: 0,
            template_candidate: 0,
          },
        },
        skippedCanvaPages: [],
      },
      queue: {
        entries: [],
        counts: {
          pending: 0,
          translating: 0,
          ready: 0,
          needs_review: 0,
          blocked: 0,
          failed: 0,
        },
      },
      translation: {
        queue: {
          entries: [],
          counts: {
            pending: 0,
            translating: 0,
            ready: 2,
            needs_review: 1,
            blocked: 1,
            failed: 0,
          },
        },
        translatedPages: 4,
        failedPages: 0,
      },
    }));

    const result = renderInTestProvider(
      <App
        loadSourceContext={async () => verifiedContext}
        initialDesignRole={{
          status: "target",
          context: {
            isTranslationTarget: true,
            language: "en",
            sourceTitle: "Masal Doll Turkish",
            contextId: "bulk-context",
          },
        }}
        translateRemaining={translateRemaining as never}
        {...pageTrackingProps}
      />,
    );

    const bulkButton = await result.findByRole("button", {
      name: "Translate remaining pages",
    });

    expect(translateRemaining).not.toHaveBeenCalled();

    fireEvent.click(bulkButton);

    await result.findByText("Remaining-page translation review completed.");

    expect(translateRemaining).toHaveBeenCalledTimes(1);
    expect(translateRemaining).toHaveBeenCalledWith("en", new Set());

    expect(result.getByText("Translated this run: 4")).toBeTruthy();
    expect(result.getByText("Failed this run: 0")).toBeTruthy();
    expect(result.getByText("Ready: 2")).toBeTruthy();
    expect(result.getByText("Needs review: 1")).toBeTruthy();
    expect(result.getByText("Blocked: 1")).toBeTruthy();

    expect(
      result.getByText("No Canva pages were changed. Review before applying."),
    ).toBeTruthy();
  });

  it("keeps Apply disabled for a blocked page", async () => {
    const result = renderInTestProvider(
      <App
        loadSourceContext={async () => verifiedContext}
        initialDesignRole={{
          status: "target",
          context: {
            isTranslationTarget: true,
            language: "en",
            sourceTitle: "Masal Doll Turkish",
            contextId: "blocked-context",
          },
        }}
        reviewPage={async () => ({
          reviewStatus: "blocked",
          blocks: [
            {
              id: "local-block-1",
              source: "6x",
              translated: "",
              editedTranslation: "",
              validation: "BLOCK",
              errors: [
                {
                  code: "LOST_PATTERN_NOTATION",
                  message: "Notation was lost.",
                },
              ],
              warnings: [],
            },
          ],
        })}
        {...pageTrackingProps}
      />,
    );
    const blockedReviewButton = await result.findByRole("button", {
      name: "Review current page",
    });
    await waitFor(() =>
      expect(blockedReviewButton.getAttribute("aria-disabled")).not.toBe(
        "true",
      ),
    );
    fireEvent.click(blockedReviewButton);
    const applyButton = await result.findByRole("button", {
      name: "Apply translation to this page",
    });
    expect(applyButton.getAttribute("aria-disabled")).toBe("true");
  });

  it("allows an explicit PASS apply and prevents duplicate Apply", async () => {
    const applyReview = jest.fn(async () => ({
      appliedBlocks: 1,
      layoutReviewRecommended: true,
    }));
    const result = renderInTestProvider(
      <App
        loadSourceContext={async () => verifiedContext}
        initialDesignRole={{
          status: "target",
          context: {
            isTranslationTarget: true,
            language: "en",
            sourceTitle: "Masal Doll Turkish",
            contextId: "pass-context",
          },
        }}
        reviewPage={async () => ({
          reviewStatus: "ready",
          blocks: [
            {
              id: "local-block-1",
              source: "6x",
              translated: "6sc",
              editedTranslation: "6sc",
              validation: "PASS",
              errors: [],
              warnings: [],
            },
          ],
        })}
        applyReview={applyReview as never}
        {...pageTrackingProps}
      />,
    );
    const passReviewButton = await result.findByRole("button", {
      name: "Review current page",
    });
    await waitFor(() =>
      expect(passReviewButton.getAttribute("aria-disabled")).not.toBe("true"),
    );
    fireEvent.click(passReviewButton);
    const applyButton = await result.findByRole("button", {
      name: "Apply translation to this page",
    });
    expect(applyButton.getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(applyButton);
    expect(
      await result.findByText(/Translation applied to current page/u),
    ).toBeTruthy();
    expect(applyReview).toHaveBeenCalledTimes(1);
    expect(applyButton.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(applyButton);
    expect(applyReview).toHaveBeenCalledTimes(1);
    expect(
      result.getByRole("button", { name: "Review current page again" }),
    ).toBeTruthy();
  });
});
