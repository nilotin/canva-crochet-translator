import { fireEvent, waitFor } from "@testing-library/react";
import { TargetReview } from "../app";
import type { PageIdentity } from "../page_identity";
import type { PageReview } from "../translation_review";
import { renderInTestProvider } from "../../../utils/test_render";

const emptyProgressSummary = {
  applied: 0,
  reviewed: 0,
  needsReview: 0,
  blocked: 0,
};

const pageReview = {
  reviewStatus: "ready" as const,
  blocks: [
    {
      id: "local-block-1",
      source: "6x",
      translated: "6sc",
      editedTranslation: "6sc",
      validation: "PASS" as const,
      errors: [],
      warnings: [],
    },
  ],
};

const context = {
  isTranslationTarget: true as const,
  language: "en" as const,
  sourceTitle: "Source",
  contextId: "target-context",
};

const createPersistence = () => {
  const states = new Map<
    string,
    { status: "reviewed" | "applied"; review: PageReview }
  >();
  return {
    loadPageState: async ({ key }: PageIdentity) => {
      const state = states.get(key);
      return {
        disposition: state
          ? state.status === "applied"
            ? "applied"
            : "review_restored"
          : "unreviewed",
        review: state?.review,
        appliedCount: [...states.values()].filter(
          ({ status }) => status === "applied",
        ).length,
        progressSummary: {
          applied: [...states.values()].filter(
            ({ status }) => status === "applied",
          ).length,
          reviewed: [...states.values()].filter(
            ({ status }) => status === "reviewed",
          ).length,
          needsReview: 0,
          blocked: 0,
        },
        currentSnapshotDigest: "current-digest",
      } as const;
    },
    savePageReview: async ({ key }: PageIdentity, review: PageReview) => {
      states.set(key, { status: "reviewed", review });
    },
    savePageApplied: async ({ key }: PageIdentity, review: PageReview) => {
      states.set(key, { status: "applied", review });
    },
    readSnapshotDigest: async () => "applied-digest",
  };
};

describe("document progress summary", () => {
  it("shows total and unreviewed page counts when target metadata is available", async () => {
    const result = renderInTestProvider(
      <TargetReview
        context={{ ...context, pageCount: 10 }}
        reviewPage={async () => pageReview}
        applyReview={jest.fn() as never}
        verifyTarget={async () => ({ ...context, pageCount: 10 })}
        getPageIdentity={async () => ({
          key: "page-1",
          source: "canva_page_id",
        })}
        loadPageState={async () => ({
          disposition: "unreviewed",
          appliedCount: 3,
          progressSummary: {
            applied: 3,
            reviewed: 2,
            needsReview: 1,
            blocked: 1,
          },
          currentSnapshotDigest: "source",
        })}
        savePageReview={async () => undefined}
        savePageApplied={async () => undefined}
        readSnapshotDigest={async () => "applied"}
        pagePollIntervalMs={60_000}
      />,
    );

    expect(await result.findByText("Applied: 3 / 10")).toBeTruthy();
    expect(result.getByText("Ready: 2")).toBeTruthy();
    expect(result.getByText("Needs review: 1")).toBeTruthy();
    expect(result.getByText("Blocked: 1")).toBeTruthy();
    expect(result.getByText("Unreviewed: 3")).toBeTruthy();
    expect(result.getByText("7 pages still need to be applied.")).toBeTruthy();
  });

  it("shows document completion when every page is applied", async () => {
    const result = renderInTestProvider(
      <TargetReview
        context={{ ...context, pageCount: 4 }}
        reviewPage={async () => pageReview}
        applyReview={jest.fn() as never}
        verifyTarget={async () => ({ ...context, pageCount: 4 })}
        getPageIdentity={async () => ({
          key: "page-1",
          source: "canva_page_id",
        })}
        loadPageState={async () => ({
          disposition: "applied",
          review: pageReview,
          appliedCount: 4,
          progressSummary: {
            applied: 4,
            reviewed: 0,
            needsReview: 0,
            blocked: 0,
          },
          currentSnapshotDigest: "applied",
        })}
        savePageReview={async () => undefined}
        savePageApplied={async () => undefined}
        readSnapshotDigest={async () => "applied"}
        pagePollIntervalMs={60_000}
      />,
    );

    expect(await result.findByText("Applied: 4 / 4")).toBeTruthy();
    expect(result.getByText("Document translation complete")).toBeTruthy();
    expect(result.queryByText(/pages still need to be applied/u)).toBeNull();
  });

  it("falls back to applied-only progress when page count is unavailable", async () => {
    const result = renderInTestProvider(
      <TargetReview
        context={context}
        reviewPage={async () => pageReview}
        applyReview={jest.fn() as never}
        verifyTarget={async () => context}
        getPageIdentity={async () => ({
          key: "page-1",
          source: "canva_page_id",
        })}
        loadPageState={async () => ({
          disposition: "unreviewed",
          appliedCount: 2,
          progressSummary: {
            applied: 2,
            reviewed: 0,
            needsReview: 0,
            blocked: 0,
          },
          currentSnapshotDigest: "source",
        })}
        savePageReview={async () => undefined}
        savePageApplied={async () => undefined}
        readSnapshotDigest={async () => "applied"}
        pagePollIntervalMs={60_000}
      />,
    );

    expect(await result.findByText("Applied: 2")).toBeTruthy();
    expect(result.queryByText(/Unreviewed:/u)).toBeNull();
  });
});

describe("page-to-page translation workflow", () => {
  it("clears a stale visible review on navigation without translating", async () => {
    let page = "page-1";
    const reviewPage = jest.fn(async () => pageReview);
    const persistence = createPersistence();
    const result = renderInTestProvider(
      <TargetReview
        context={context}
        reviewPage={reviewPage}
        applyReview={jest.fn() as never}
        verifyTarget={async () => context}
        getPageIdentity={async () => ({ key: page, source: "canva_page_id" })}
        {...persistence}
        pagePollIntervalMs={10}
      />,
    );
    const reviewButton = await result.findByRole("button", {
      name: "Review current page",
    });
    await waitFor(() =>
      expect(reviewButton.getAttribute("aria-disabled")).not.toBe("true"),
    );
    fireEvent.click(reviewButton);
    await result.findByRole("textbox", { name: "Translation" });
    expect(reviewPage).toHaveBeenCalledTimes(1);

    page = "page-2";
    await result.findByText(
      "The Canva page changed. Review the current page before applying.",
    );
    expect(result.queryByRole("textbox", { name: "Translation" })).toBeNull();
    expect(reviewPage).toHaveBeenCalledTimes(1);

    page = "page-1";
    await result.findByRole("textbox", { name: "Translation" });
    expect(reviewPage).toHaveBeenCalledTimes(1);
  });

  it("reuses a matching reviewed page and remembers an applied page", async () => {
    let page = "page-1";
    const reviewPage = jest.fn(async () => pageReview);
    const applyReview = jest.fn(async () => ({
      appliedBlocks: 1,
      layoutReviewRecommended: true,
    }));
    const persistence = createPersistence();
    const result = renderInTestProvider(
      <TargetReview
        context={context}
        reviewPage={reviewPage}
        applyReview={applyReview as never}
        verifyTarget={async () => context}
        getPageIdentity={async () => ({ key: page, source: "canva_page_id" })}
        {...persistence}
        pagePollIntervalMs={10}
      />,
    );
    const reviewButton = await result.findByRole("button", {
      name: "Review current page",
    });
    await waitFor(() =>
      expect(reviewButton.getAttribute("aria-disabled")).not.toBe("true"),
    );
    expect(result.getByText("Current page status: Unreviewed")).toBeTruthy();
    expect(result.getByText("Review this page to continue.")).toBeTruthy();
    fireEvent.click(reviewButton);
    const applyButton = await result.findByRole("button", {
      name: "Apply translation to this page",
    });
    expect(result.getByText("Applied: 0")).toBeTruthy();
    expect(result.getByText("Ready: 1")).toBeTruthy();
    expect(result.getByText("Current page status: Ready")).toBeTruthy();
    expect(
      result.getByText("Review is ready. Apply when you are satisfied."),
    ).toBeTruthy();

    fireEvent.click(applyButton);
    await result.findByText("Applied: 1");
    expect(result.getByText("Current page status: Applied")).toBeTruthy();
    expect(
      result.getByText("This page is complete. Move to another Canva page."),
    ).toBeTruthy();
    expect(result.getByText("Ready: 0")).toBeTruthy();
    expect(
      result.getByText("Go to the next Canva page, then return here."),
    ).toBeTruthy();
    expect(result.queryByRole("button", { name: "Next page" })).toBeNull();

    page = "page-2";
    await result.findByText("New page detected");
    page = "page-1";
    await result.findByText("Applied");
    expect(reviewPage).toHaveBeenCalledTimes(1);
    expect(result.getByText("Applied: 1")).toBeTruthy();
  });

  it("blocks Apply if the page changes before the preflight", async () => {
    let page = "page-1";
    const applyReview = jest.fn();
    const persistence = createPersistence();
    const result = renderInTestProvider(
      <TargetReview
        context={context}
        reviewPage={async () => pageReview}
        applyReview={applyReview as never}
        verifyTarget={async () => context}
        getPageIdentity={async () => ({ key: page, source: "canva_page_id" })}
        {...persistence}
        pagePollIntervalMs={60_000}
      />,
    );
    const reviewButton = await result.findByRole("button", {
      name: "Review current page",
    });
    await waitFor(() =>
      expect(reviewButton.getAttribute("aria-disabled")).not.toBe("true"),
    );
    fireEvent.click(reviewButton);
    const applyButton = await result.findByRole("button", {
      name: "Apply translation to this page",
    });
    page = "page-2";
    fireEvent.click(applyButton);
    await result.findByText(
      "The Canva page changed. Review the current page before applying.",
    );
    expect(applyReview).not.toHaveBeenCalled();
    expect(result.getByText("Applied: 0")).toBeTruthy();
  });

  it("does not increment progress after a failed Apply", async () => {
    const persistence = createPersistence();
    const result = renderInTestProvider(
      <TargetReview
        context={context}
        reviewPage={async () => pageReview}
        applyReview={
          jest.fn(async () => {
            throw new Error("failed");
          }) as never
        }
        verifyTarget={async () => context}
        getPageIdentity={async () => ({
          key: "page-1",
          source: "canva_page_id",
        })}
        {...persistence}
        pagePollIntervalMs={60_000}
      />,
    );
    const reviewButton = await result.findByRole("button", {
      name: "Review current page",
    });
    await waitFor(() =>
      expect(reviewButton.getAttribute("aria-disabled")).not.toBe("true"),
    );
    fireEvent.click(reviewButton);
    fireEvent.click(
      await result.findByRole("button", {
        name: "Apply translation to this page",
      }),
    );
    await result.findByText("The reviewed translation could not be applied.");
    expect(result.getByText("Applied: 0")).toBeTruthy();
  });

  it("restores a persisted warning review without a translation call or acknowledgement", async () => {
    const reviewPage = jest.fn(async () => pageReview);
    const baseBlock = pageReview.blocks[0];
    if (baseBlock == null) {
      throw new Error("Expected the review fixture to contain a block.");
    }
    const restoredReview: PageReview = {
      reviewStatus: "needs_review",
      blocks: [
        {
          ...baseBlock,
          editedTranslation: "saved manual edit",
          validation: "WARNING",
          warnings: [{ code: "CHECK", message: "Check this." }],
        },
      ],
    };
    const result = renderInTestProvider(
      <TargetReview
        context={context}
        reviewPage={reviewPage}
        applyReview={jest.fn() as never}
        verifyTarget={async () => context}
        getPageIdentity={async () => ({
          key: "page-1",
          source: "canva_page_id",
        })}
        loadPageState={async () => ({
          disposition: "review_restored",
          review: restoredReview,
          appliedCount: 2,
          progressSummary: {
            applied: 2,
            reviewed: 0,
            needsReview: 1,
            blocked: 0,
          },
          currentSnapshotDigest: "source",
        })}
        savePageReview={async () => undefined}
        savePageApplied={async () => undefined}
        readSnapshotDigest={async () => "applied"}
        pagePollIntervalMs={60_000}
      />,
    );
    const input = await result.findByRole("textbox", { name: "Translation" });
    expect(input).toHaveProperty("value", "saved manual edit");
    expect(result.getByText("Saved review restored")).toBeTruthy();
    expect(result.getByText("Applied: 2")).toBeTruthy();
    expect(
      result.getByRole("checkbox", { name: "I reviewed the warnings" }),
    ).toHaveProperty("checked", false);
    expect(reviewPage).not.toHaveBeenCalled();
  });

  it("persists edited translation text after the debounce", async () => {
    const savePageReview = jest.fn(
      async (_page: PageIdentity, _review: PageReview) => undefined,
    );
    const result = renderInTestProvider(
      <TargetReview
        context={context}
        reviewPage={async () => pageReview}
        applyReview={jest.fn() as never}
        verifyTarget={async () => context}
        getPageIdentity={async () => ({
          key: "page-1",
          source: "canva_page_id",
        })}
        loadPageState={async () => ({
          disposition: "unreviewed",
          appliedCount: 0,
          progressSummary: emptyProgressSummary,
          currentSnapshotDigest: "source",
        })}
        savePageReview={savePageReview}
        savePageApplied={async () => undefined}
        readSnapshotDigest={async () => "applied"}
        pagePollIntervalMs={60_000}
      />,
    );
    const reviewButton = await result.findByRole("button", {
      name: "Review current page",
    });
    await waitFor(() =>
      expect(reviewButton.getAttribute("aria-disabled")).not.toBe("true"),
    );
    fireEvent.click(reviewButton);
    const input = await result.findByRole("textbox", { name: "Translation" });
    await waitFor(() => expect(savePageReview).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: "saved after debounce" } });
    await waitFor(() => expect(savePageReview).toHaveBeenCalledTimes(2), {
      timeout: 1_000,
    });
    expect(savePageReview.mock.calls[1]?.[1].blocks[0]?.editedTranslation).toBe(
      "saved after debounce",
    );
  });

  it("keeps a persisted BLOCK non-applicable", async () => {
    const baseBlock = pageReview.blocks[0];
    if (baseBlock == null) {
      throw new Error("Expected the review fixture to contain a block.");
    }
    const blocked: PageReview = {
      reviewStatus: "blocked",
      blocks: [{ ...baseBlock, validation: "BLOCK" }],
    };
    const result = renderInTestProvider(
      <TargetReview
        context={context}
        reviewPage={jest.fn(async () => blocked)}
        applyReview={jest.fn() as never}
        verifyTarget={async () => context}
        getPageIdentity={async () => ({
          key: "page-1",
          source: "canva_page_id",
        })}
        loadPageState={async () => ({
          disposition: "review_restored",
          review: blocked,
          appliedCount: 0,
          progressSummary: emptyProgressSummary,
          currentSnapshotDigest: "source",
        })}
        savePageReview={async () => undefined}
        savePageApplied={async () => undefined}
        readSnapshotDigest={async () => "applied"}
        pagePollIntervalMs={60_000}
      />,
    );
    const applyButton = await result.findByRole("button", {
      name: "Apply translation to this page",
    });
    expect(applyButton.getAttribute("aria-disabled")).toBe("true");
  });

  it("defensively blocks a mislabeled numeric warning and hides acknowledgement", async () => {
    const applyReview = jest.fn();
    const malformed: PageReview = {
      reviewStatus: "needs_review",
      blocks: [
        {
          id: "local-block-1",
          source: "2.00 no tığ ile örüyoruz.",
          translated: "2.00 2.00 crochet without a hook.",
          editedTranslation: "2.00 2.00 crochet without a hook.",
          validation: "WARNING",
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
    };
    const result = renderInTestProvider(
      <TargetReview
        context={context}
        reviewPage={jest.fn(async () => malformed)}
        applyReview={applyReview as never}
        verifyTarget={async () => context}
        getPageIdentity={async () => ({
          key: "page-1",
          source: "canva_page_id",
        })}
        loadPageState={async () => ({
          disposition: "review_restored",
          review: malformed,
          appliedCount: 0,
          progressSummary: emptyProgressSummary,
          currentSnapshotDigest: "source",
        })}
        savePageReview={async () => undefined}
        savePageApplied={async () => undefined}
        readSnapshotDigest={async () => "applied"}
        pagePollIntervalMs={60_000}
      />,
    );
    const applyButton = await result.findByRole("button", {
      name: "Apply reviewed translation",
    });
    expect(result.getByText("Page status: Blocked")).toBeTruthy();
    expect(
      result.queryByRole("checkbox", { name: "I reviewed the warnings" }),
    ).toBeNull();
    expect(applyButton.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(applyButton);
    expect(applyReview).not.toHaveBeenCalled();
  });

  it("restores Applied and durable progress without retaining the old Apply action", async () => {
    const reviewPage = jest.fn(async () => pageReview);
    const result = renderInTestProvider(
      <TargetReview
        context={context}
        reviewPage={reviewPage}
        applyReview={jest.fn() as never}
        verifyTarget={async () => context}
        getPageIdentity={async () => ({
          key: "page-1",
          source: "canva_page_id",
        })}
        loadPageState={async () => ({
          disposition: "applied",
          review: pageReview,
          appliedCount: 4,
          progressSummary: {
            applied: 4,
            reviewed: 0,
            needsReview: 0,
            blocked: 0,
          },
          currentSnapshotDigest: "applied",
        })}
        savePageReview={async () => undefined}
        savePageApplied={async () => undefined}
        readSnapshotDigest={async () => "applied"}
        pagePollIntervalMs={60_000}
      />,
    );
    expect(await result.findByText("Applied")).toBeTruthy();
    expect(result.getByText("Applied: 4")).toBeTruthy();
    expect(
      result.queryByRole("button", { name: "Apply translation to this page" }),
    ).toBeNull();
    expect(reviewPage).not.toHaveBeenCalled();
  });

  it("prevents unsafe re-apply when persistence fails after Canva sync", async () => {
    const savePageApplied = jest.fn(async () => {
      throw new Error("disk unavailable");
    });
    const result = renderInTestProvider(
      <TargetReview
        context={context}
        reviewPage={async () => pageReview}
        applyReview={
          jest.fn(async () => ({
            appliedBlocks: 1,
            layoutReviewRecommended: true,
          })) as never
        }
        verifyTarget={async () => context}
        getPageIdentity={async () => ({
          key: "page-1",
          source: "canva_page_id",
        })}
        loadPageState={async () => ({
          disposition: "unreviewed",
          appliedCount: 0,
          progressSummary: emptyProgressSummary,
          currentSnapshotDigest: "source",
        })}
        savePageReview={async () => undefined}
        savePageApplied={savePageApplied}
        readSnapshotDigest={async () => "applied"}
        pagePollIntervalMs={60_000}
      />,
    );
    const reviewButton = await result.findByRole("button", {
      name: "Review current page",
    });
    await waitFor(() =>
      expect(reviewButton.getAttribute("aria-disabled")).not.toBe("true"),
    );
    fireEvent.click(reviewButton);
    fireEvent.click(
      await result.findByRole("button", {
        name: "Apply translation to this page",
      }),
    );
    expect(
      await result.findByText(
        "Translation was applied, but progress could not be saved.",
      ),
    ).toBeTruthy();
    expect(
      result
        .getByRole("button", { name: "Apply translation to this page" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(result.getByText("Applied: 0")).toBeTruthy();
  });
});
