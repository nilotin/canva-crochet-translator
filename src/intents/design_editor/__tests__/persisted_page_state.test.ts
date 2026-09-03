import {
  digestReviewSource,
  digestReviewTarget,
  loadPersistedPageState,
  loadPersistedPageStateSummaries,
  savePersistedReview,
  savePersistedWholeDocumentApplied,
} from "../persisted_page_state";
import type { PageReview } from "../translation_review";
import { digestWholeDocumentPage } from "../whole_document_snapshot";

const review: PageReview = {
  reviewStatus: "needs_review",
  blocks: [
    {
      id: "local-block-1",
      source: "6x",
      translated: "6sc",
      editedTranslation: "manually edited 6sc",
      validation: "WARNING",
      errors: [],
      warnings: [{ code: "REVIEW", message: "Check layout." }],
      targetFormattingRegions: [{ id: "fmt-0", start: 0, end: 3 }],
    },
  ],
};

const queryWith = (text: string) =>
  jest.fn(async (_options, callback) =>
    callback({
      contents: [
        {
          deleted: false,
          readPlaintext: () => text,
          readTextRegions: () => [
            {
              text,
              formatting: {},
            },
          ],
        },
      ],
      sync: jest.fn(),
    }),
  );

const overrides = (fetcher: jest.Mock, currentText = "6x") => ({
  getDesignToken: async () => ({ token: "design-jwt" }),
  getUserToken: async () => "user-jwt" as never,
  fetch: fetcher as never,
  backendHost: "http://backend",
  queryCurrentPage: queryWith(currentText) as never,
});

const wholeDocumentPage = (text: string) => ({
  pageId: "one",
  discoveryIndex: 0,
  locked: false,
  blocks: [
    {
      id: "page-one-block-1",
      sourceText: text,
      order: 0,
      formattingRegions: [],
    },
  ],
});

describe("persisted page-state client", () => {
  it("loads lightweight page-state summaries with fresh Canva authorization", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        states: [
          { pageIdentity: "page:first", status: "applied" },
          { pageIdentity: "page:second", status: "needs_review" },
        ],
      }),
    }));

    await expect(
      loadPersistedPageStateSummaries(overrides(fetcher)),
    ).resolves.toEqual([
      { pageIdentity: "page:first", status: "applied" },
      { pageIdentity: "page:second", status: "needs_review" },
    ]);

    const call = (fetcher.mock.calls as unknown as [string, RequestInit][])[0];
    if (!call) throw new Error("Expected a persistence request.");

    const [url, init] = call;

    expect(url).toBe("http://backend/api/canva/page-state/list");

    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ designToken: "design-jwt" });
  });

  it("restores edited review text when the source digest matches", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        appliedCount: 3,
        state: {
          pageIdentity: "page:one",
          pipelineRevision: "translation-pipeline-v10",
          sourceSnapshotDigest: digestReviewSource(review),
          expectedAppliedSnapshotDigest: digestReviewTarget(review),
          status: "needs_review",
          blocks: review.blocks,
        },
      }),
    }));
    const loaded = await loadPersistedPageState(
      { key: "page:one", source: "canva_page_id" },
      "context",
      overrides(fetcher),
    );
    expect(loaded).toMatchObject({
      disposition: "review_restored",
      appliedCount: 3,
      review: {
        reviewStatus: "needs_review",
        blocks: [
          {
            editedTranslation: "manually edited 6sc",
            targetFormattingRegions: [{ id: "fmt-0", start: 0, end: 3 }],
          },
        ],
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not restore a review from a superseded pipeline revision", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        appliedCount: 3,
        state: {
          pageIdentity: "page:one",
          pipelineRevision: "translation-pipeline-v2",
          sourceSnapshotDigest: digestReviewSource(review),
          expectedAppliedSnapshotDigest: digestReviewTarget(review),
          status: "needs_review",
          blocks: review.blocks,
        },
      }),
    }));

    await expect(
      loadPersistedPageState(
        { key: "page:one", source: "canva_page_id" },
        "context",
        overrides(fetcher),
      ),
    ).resolves.toMatchObject({
      disposition: "stale_review",
    });
  });

  it("restores a fresh whole-document applied state without reading current-page content", async () => {
    const page = wholeDocumentPage("manually edited 6sc");
    const queryCurrentPage = queryWith("should not be read");

    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        appliedCount: 1,
        progressSummary: {
          applied: 1,
          reviewed: 0,
          needsReview: 0,
          blocked: 0,
        },
        state: {
          pageIdentity: "page:one",
          pipelineRevision: "translation-pipeline-v10",
          sourceSnapshotDigest: digestReviewSource(review),
          expectedAppliedSnapshotDigest: digestReviewTarget(review),
          appliedSnapshotDigest: digestWholeDocumentPage(page),
          snapshotMode: "whole_document",
          status: "applied",
          blocks: review.blocks,
        },
      }),
    }));

    const readWholeDocumentInventory = jest.fn(async () => ({
      pages: [page],
      skippedPages: [],
    }));

    await expect(
      loadPersistedPageState(
        { key: "page:one", source: "canva_page_id" },
        "context",
        {
          ...overrides(fetcher),
          queryCurrentPage: queryCurrentPage as never,
          readWholeDocumentInventory: readWholeDocumentInventory as never,
        },
      ),
    ).resolves.toMatchObject({
      disposition: "applied",
    });

    expect(queryCurrentPage).not.toHaveBeenCalled();
    expect(readWholeDocumentInventory).toHaveBeenCalledTimes(1);
  });

  it("detects a changed whole-document applied snapshot", async () => {
    const persistedPage = wholeDocumentPage("manually edited 6sc");
    const currentPage = wholeDocumentPage("manually changed after apply");
    const queryCurrentPage = queryWith("should not be read");

    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        appliedCount: 1,
        progressSummary: {
          applied: 1,
          reviewed: 0,
          needsReview: 0,
          blocked: 0,
        },
        state: {
          pageIdentity: "page:one",
          pipelineRevision: "translation-pipeline-v10",
          sourceSnapshotDigest: digestReviewSource(review),
          expectedAppliedSnapshotDigest: digestReviewTarget(review),
          appliedSnapshotDigest: digestWholeDocumentPage(persistedPage),
          snapshotMode: "whole_document",
          status: "applied",
          blocks: review.blocks,
        },
      }),
    }));

    const readWholeDocumentInventory = jest.fn(async () => ({
      pages: [currentPage],
      skippedPages: [],
    }));

    await expect(
      loadPersistedPageState(
        { key: "page:one", source: "canva_page_id" },
        "context",
        {
          ...overrides(fetcher),
          queryCurrentPage: queryCurrentPage as never,
          readWholeDocumentInventory: readWholeDocumentInventory as never,
        },
      ),
    ).resolves.toMatchObject({
      disposition: "applied_changed",
    });

    expect(queryCurrentPage).not.toHaveBeenCalled();
    expect(readWholeDocumentInventory).toHaveBeenCalledTimes(1);
  });

  it("detects stale reviewed and manually changed applied pages", async () => {
    const state = {
      pageIdentity: "page:one",
      sourceSnapshotDigest: digestReviewSource(review),
      expectedAppliedSnapshotDigest: digestReviewTarget(review),
      appliedSnapshotDigest: "different-applied-digest",
      status: "applied",
      blocks: review.blocks,
    };
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({ appliedCount: 1, state }),
    }));
    await expect(
      loadPersistedPageState(
        { key: "page:one", source: "canva_page_id" },
        "context",
        overrides(fetcher, "manually changed"),
      ),
    ).resolves.toMatchObject({ disposition: "applied_changed" });

    state.status = "reviewed";
    delete (state as Partial<typeof state>).appliedSnapshotDigest;
    await expect(
      loadPersistedPageState(
        { key: "page:one", source: "canva_page_id" },
        "context",
        overrides(fetcher, "manually changed"),
      ),
    ).resolves.toMatchObject({ disposition: "stale_review" });
  });

  it("recognizes the expected translated digest for post-sync reconciliation", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        appliedCount: 0,
        state: {
          pageIdentity: "page:one",
          sourceSnapshotDigest: digestReviewSource(review),
          expectedAppliedSnapshotDigest: digestReviewTarget(review),
          status: "needs_review",
          blocks: review.blocks,
        },
      }),
    }));
    await expect(
      loadPersistedPageState(
        { key: "page:one", source: "canva_page_id" },
        "context",
        overrides(fetcher, "manually edited 6sc"),
      ),
    ).resolves.toMatchObject({ disposition: "reconcile_applied" });
  });

  it("saves whole-document applied state with an absolute page identity", async () => {
    const fetcher = jest.fn(async () => ({ ok: true }));

    await savePersistedWholeDocumentApplied(
      "absolute-page-id",
      review.blocks,
      "whole-source-digest",
      "whole-expected-digest",
      "whole-applied-digest",
      overrides(fetcher),
    );

    const call = (fetcher.mock.calls as unknown as [string, RequestInit][])[0];
    if (!call) throw new Error("Expected a persistence request.");

    const [url, init] = call;
    const body = JSON.parse(String(init.body));

    expect(url).toBe("http://backend/api/canva/page-state/save");
    expect(body).toMatchObject({
      designToken: "design-jwt",
      pageIdentity: "page:absolute-page-id",
      pipelineRevision: "translation-pipeline-v10",
      sourceSnapshotDigest: "whole-source-digest",
      expectedAppliedSnapshotDigest: "whole-expected-digest",
      appliedSnapshotDigest: "whole-applied-digest",
      snapshotMode: "whole_document",
      status: "applied",
      blocks: review.blocks,
    });
  });

  it("saves only normalized review state with fresh Canva authorization", async () => {
    const fetcher = jest.fn(async () => ({ ok: true }));
    await savePersistedReview(
      { key: "page:one", source: "canva_page_id" },
      review,
      overrides(fetcher),
    );
    const call = (fetcher.mock.calls as unknown as [string, RequestInit][])[0];
    if (!call) throw new Error("Expected a persistence request.");
    const [url, init] = call;
    expect(url).toBe("http://backend/api/canva/page-state/save");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer user-jwt",
    );
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      designToken: "design-jwt",
      pageIdentity: "page:one",
      pipelineRevision: "translation-pipeline-v10",
      status: "needs_review",
      blocks: [{ editedTranslation: "manually edited 6sc" }],
    });
    expect(JSON.stringify(body)).not.toContain("user-jwt");
  });
});
