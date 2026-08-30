import { editContent, getDesignToken } from "@canva/design";
import { auth } from "@canva/user";
import type { PageIdentity } from "./page_identity";
import { TRANSLATION_PIPELINE_REVISION } from "./bulk_review_state";
import { normalizePageReviewSeverity } from "./review_severity";
import {
  readCurrentPageBlocks,
  type PageReview,
  type ReviewBlock,
} from "./translation_review";

type PersistedStatus = "reviewed" | "needs_review" | "blocked" | "applied";

export type DocumentProgressSummary = {
  applied: number;
  reviewed: number;
  needsReview: number;
  blocked: number;
};

type PersistedState = {
  pageIdentity: string;
  pipelineRevision?: string;
  sourceSnapshotDigest: string;
  expectedAppliedSnapshotDigest: string;
  appliedSnapshotDigest?: string;
  status: PersistedStatus;
  blocks: ReviewBlock[];
};

export type LoadedPageWorkflowState = {
  disposition:
    | "unreviewed"
    | "review_restored"
    | "stale_review"
    | "applied"
    | "applied_changed"
    | "reconcile_applied";
  review?: PageReview;
  appliedCount: number;
  progressSummary: DocumentProgressSummary;
  currentSnapshotDigest: string;
  persisted?: PersistedState;
};

type Dependencies = {
  getDesignToken: typeof getDesignToken;
  getUserToken: typeof auth.getCanvaUserToken;
  fetch: typeof fetch;
  backendHost: string;
  queryCurrentPage: typeof editContent;
};

const dependencies = (overrides: Partial<Dependencies> = {}): Dependencies => ({
  getDesignToken,
  getUserToken: auth.getCanvaUserToken,
  fetch: (...input) => globalThis.fetch(...input),
  backendHost: typeof BACKEND_HOST === "string" ? BACKEND_HOST : "",
  queryCurrentPage: editContent,
  ...overrides,
});

const digest = (entries: readonly { id: string; text: string }[]): string => {
  const serialized = entries
    .map(({ id, text }) => `${id.length}:${id}:${text.length}:${text}`)
    .join("|");
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < serialized.length; index += 1) {
    const value = serialized.charCodeAt(index);
    first = Math.imul(first ^ value, 16777619);
    second = Math.imul(second ^ value, 3266489917);
  }
  return `snapshot-v1-${(first >>> 0).toString(16).padStart(8, "0")}${(
    second >>> 0
  )
    .toString(16)
    .padStart(8, "0")}`;
};

export const digestReviewSource = (review: PageReview): string =>
  digest(review.blocks.map(({ id, source }) => ({ id, text: source })));

export const digestReviewTarget = (review: PageReview): string =>
  digest(
    review.blocks.map(({ id, editedTranslation }) => ({
      id,
      text: editedTranslation,
    })),
  );

export const readCurrentSnapshotDigest = async (
  contextId: string,
  queryCurrentPage: typeof editContent = editContent,
): Promise<string> => {
  const blocks = await readCurrentPageBlocks(queryCurrentPage, contextId);
  return digest(
    blocks.map(({ localId, sourceText }) => ({
      id: localId,
      text: sourceText,
    })),
  );
};

const authorizedRequest = async (
  path: string,
  body: Record<string, unknown>,
  overrides: Partial<Dependencies> = {},
) => {
  const deps = dependencies(overrides);
  const [{ token: designToken }, userToken] = await Promise.all([
    deps.getDesignToken(),
    deps.getUserToken(),
  ]);
  return deps.fetch(`${deps.backendHost.replace(/\/$/u, "")}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, designToken }),
  });
};

export type PersistedPageStateSummary = {
  pageIdentity: string;
  status: PersistedStatus;
};

export const loadPersistedPageStateSummaries = async (
  overrides: Partial<Dependencies> = {},
): Promise<PersistedPageStateSummary[]> => {
  const response = await authorizedRequest(
    "/api/canva/page-state/list",
    {},
    overrides,
  );

  if (!response.ok) {
    throw new Error("Could not load page-state summaries.");
  }

  const result = (await response.json()) as {
    states: PersistedPageStateSummary[];
  };

  return result.states;
};

export const loadPersistedPageState = async (
  pageIdentity: PageIdentity,
  contextId: string,
  overrides: Partial<Dependencies> = {},
): Promise<LoadedPageWorkflowState> => {
  const deps = dependencies(overrides);
  const currentSnapshotDigest = await readCurrentSnapshotDigest(
    contextId,
    deps.queryCurrentPage,
  );
  const response = await authorizedRequest(
    "/api/canva/page-state/get",
    { pageIdentity: pageIdentity.key },
    overrides,
  );
  if (!response.ok) throw new Error("Could not load saved page state.");
  const result = (await response.json()) as {
    state: PersistedState | null;
    appliedCount: number;
    progressSummary: DocumentProgressSummary;
  };
  const persisted = result.state ?? undefined;
  if (!persisted)
    return {
      disposition: "unreviewed",
      appliedCount: result.appliedCount,
      progressSummary: result.progressSummary,
      currentSnapshotDigest,
    };

  const review = normalizePageReviewSeverity({
    blocks: persisted.blocks,
    reviewStatus:
      persisted.status === "blocked"
        ? "blocked"
        : persisted.status === "needs_review"
          ? "needs_review"
          : "ready",
  });
  if (persisted.status === "applied") {
    return {
      disposition:
        currentSnapshotDigest === persisted.appliedSnapshotDigest
          ? "applied"
          : "applied_changed",
      review,
      appliedCount: result.appliedCount,
      progressSummary: result.progressSummary,
      currentSnapshotDigest,
      persisted,
    };
  }
  if (currentSnapshotDigest === persisted.sourceSnapshotDigest) {
    return {
      disposition:
        persisted.pipelineRevision === TRANSLATION_PIPELINE_REVISION
          ? "review_restored"
          : "stale_review",
      review,
      appliedCount: result.appliedCount,
      progressSummary: result.progressSummary,
      currentSnapshotDigest,
      persisted,
    };
  }
  return {
    disposition:
      currentSnapshotDigest === persisted.expectedAppliedSnapshotDigest
        ? "reconcile_applied"
        : "stale_review",
    review,
    appliedCount: result.appliedCount,
    progressSummary: result.progressSummary,
    currentSnapshotDigest,
    persisted,
  };
};

export const savePersistedReview = async (
  pageIdentity: PageIdentity,
  review: PageReview,
  overrides: Partial<Dependencies> = {},
): Promise<void> => {
  const status: PersistedStatus =
    review.reviewStatus === "blocked"
      ? "blocked"
      : review.reviewStatus === "needs_review"
        ? "needs_review"
        : "reviewed";
  const response = await authorizedRequest(
    "/api/canva/page-state/save",
    {
      pageIdentity: pageIdentity.key,
      pipelineRevision: TRANSLATION_PIPELINE_REVISION,
      sourceSnapshotDigest: digestReviewSource(review),
      expectedAppliedSnapshotDigest: digestReviewTarget(review),
      status,
      blocks: review.blocks,
    },
    overrides,
  );
  if (!response.ok) throw new Error("Could not save page review.");
};

export const savePersistedApplied = async (
  pageIdentity: PageIdentity,
  review: PageReview,
  appliedSnapshotDigest: string,
  overrides: Partial<Dependencies> = {},
): Promise<void> => {
  const response = await authorizedRequest(
    "/api/canva/page-state/save",
    {
      pageIdentity: pageIdentity.key,
      pipelineRevision: TRANSLATION_PIPELINE_REVISION,
      sourceSnapshotDigest: digestReviewSource(review),
      expectedAppliedSnapshotDigest: digestReviewTarget(review),
      appliedSnapshotDigest,
      status: "applied",
      blocks: review.blocks,
    },
    overrides,
  );
  if (!response.ok) throw new Error("Could not save applied page state.");
};
