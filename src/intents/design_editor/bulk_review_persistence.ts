import { getDesignToken } from "@canva/design";
import { auth } from "@canva/user";
import type {
  PersistedBulkPageReview,
  PersistedBulkPageStatus,
} from "./bulk_review_state";
import { TRANSLATION_PIPELINE_REVISION } from "./bulk_review_state";

export type BulkReviewSummary = {
  pageId: string;
  fingerprint: string;

  pipelineRevision?: string;
  status: PersistedBulkPageStatus;
  updatedAt: string;
};

type Dependencies = {
  getDesignToken: typeof getDesignToken;
  getUserToken: typeof auth.getCanvaUserToken;
  fetch: typeof fetch;
  backendHost: string;
};

const dependencies = (overrides: Partial<Dependencies> = {}): Dependencies => ({
  getDesignToken,
  getUserToken: auth.getCanvaUserToken,
  fetch: (...input) => globalThis.fetch(...input),
  backendHost: typeof BACKEND_HOST === "string" ? BACKEND_HOST : "",
  ...overrides,
});

const authorizedRequest = async (
  path: string,
  body: Record<string, unknown>,
  overrides: Partial<Dependencies> = {},
): Promise<Response> => {
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
    body: JSON.stringify({
      ...body,
      designToken,
    }),
  });
};

export const loadBulkReview = async (
  pageId: string,
  overrides: Partial<Dependencies> = {},
): Promise<PersistedBulkPageReview | undefined> => {
  const response = await authorizedRequest(
    "/api/canva/bulk-review/get",
    { pageId },
    overrides,
  );

  if (!response.ok) {
    throw new Error("Could not load bulk review.");
  }

  const result = (await response.json()) as {
    review:
      | (PersistedBulkPageReview & {
          updatedAt: string;
        })
      | null;
  };

  if (!result.review) return undefined;

  return {
    pageId: result.review.pageId,
    fingerprint: result.review.fingerprint,
    pipelineRevision: result.review.pipelineRevision,
    status: result.review.status,
    blocks: result.review.blocks,
  };
};

export const loadBulkReviewSummaries = async (
  overrides: Partial<Dependencies> = {},
): Promise<BulkReviewSummary[]> => {
  const response = await authorizedRequest(
    "/api/canva/bulk-review/list",
    {},
    overrides,
  );

  if (!response.ok) {
    throw new Error("Could not load bulk review summaries.");
  }

  const result = (await response.json()) as {
    reviews: BulkReviewSummary[];
  };

  return result.reviews;
};

export const saveBulkReview = async (
  review: PersistedBulkPageReview,
  overrides: Partial<Dependencies> = {},
): Promise<void> => {
  const response = await authorizedRequest(
    "/api/canva/bulk-review/save",
    {
      pageId: review.pageId,
      fingerprint: review.fingerprint,
      pipelineRevision: TRANSLATION_PIPELINE_REVISION,
      status: review.status,
      blocks: review.blocks,
    },
    overrides,
  );

  if (!response.ok) {
    throw new Error("Could not save bulk review.");
  }
};
