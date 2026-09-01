import {
  editContent,
  getDesignToken,
  type RichtextContentRange,
  type RichtextFormatting,
  type TextRegion,
} from "@canva/design";
import { auth } from "@canva/user";
import type { TargetLanguage } from "./copy_designs";
import type { DesignRole } from "./target_context";
import { normalizePageReviewSeverity } from "./review_severity";

export type CanvaTranslationBlock = {
  localId: string;
  sourceText: string;
  order: number;
};

export type ReviewBlock = {
  id: string;
  source: string;
  translated: string;
  editedTranslation: string;
  validation: "PASS" | "WARNING" | "BLOCK";
  errors: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
  targetFormattingRegions?: {
    id: string;
    start: number;
    end: number;
  }[];
};

export type PageReview = {
  blocks: ReviewBlock[];
  reviewStatus: "ready" | "needs_review" | "blocked";
};

export type TranslationResponse = {
  translations: {
    id: string;
    source: string;
    translated: string;
    valid: boolean;
    errors: { code: string; message: string }[];
    warnings: { code: string; message: string }[];
    targetFormattingRegions?: {
      id: string;
      start: number;
      end: number;
    }[];
  }[];
};

type Dependencies = {
  queryCurrentPage: typeof editContent;
  getDesignToken: typeof getDesignToken;
  getUserToken: typeof auth.getCanvaUserToken;
  fetch: typeof fetch;
  backendHost: string;
};

export type FormattingRegionSnapshot = {
  index: number;
  length: number;
  text: string;
  formatting: Partial<RichtextFormatting>;
};

export const snapshotFormattingRegions = (
  regions: readonly TextRegion[],
): FormattingRegionSnapshot[] => {
  let index = 0;

  return regions.map((region) => {
    const snapshot = {
      index,
      length: region.text.length,
      text: region.text,
      formatting: { ...(region.formatting ?? {}) },
    };

    index += region.text.length;
    return snapshot;
  });
};

// Session-bound Canva ranges and formatting stay in frontend memory and are never serialized.
type ActiveReviewSession = {
  references: Map<string, RichtextContentRange>;
  sourceSnapshot: Map<string, string>;
  formattingSnapshot: Map<string, FormattingRegionSnapshot[]>;
  applied: boolean;
};

const activeReviewSessions = new Map<string, ActiveReviewSession>();

export const readCurrentPageBlocks = async (
  queryCurrentPage: typeof editContent = editContent,
  contextId = "test-session",
): Promise<CanvaTranslationBlock[]> => {
  const blocks: CanvaTranslationBlock[] = [];
  const references = new Map<string, RichtextContentRange>();
  const sourceSnapshot = new Map<string, string>();
  const formattingSnapshot = new Map<string, FormattingRegionSnapshot[]>();
  await queryCurrentPage(
    { contentType: "richtext", target: "current_page" },
    (session) => {
      session.contents.forEach((content, index) => {
        if (content.deleted) return;
        const sourceText = content.readPlaintext();
        if (!sourceText.trim()) return;
        const localId = `local-block-${index + 1}`;
        blocks.push({ localId, sourceText, order: index });
        references.set(localId, content);
        sourceSnapshot.set(localId, sourceText);
        const formattingRegions = snapshotFormattingRegions(
          content.readTextRegions(),
        );

        formattingSnapshot.set(localId, formattingRegions);
      });
      activeReviewSessions.set(contextId, {
        references,
        sourceSnapshot,
        formattingSnapshot,
        applied: false,
      });
      // Read-only stage: deliberately no session.sync().
    },
  );
  return blocks;
};

const inlineFormattingKey = (formatting: Partial<RichtextFormatting>): string =>
  JSON.stringify({
    color: formatting.color,
    fontWeight: formatting.fontWeight,
    fontStyle: formatting.fontStyle,
    decoration: formatting.decoration,
    strikethrough: formatting.strikethrough,
    link: formatting.link,
  });

export const requiresFormattingProjection = (
  snapshots: readonly FormattingRegionSnapshot[],
): boolean =>
  new Set(snapshots.map(({ formatting }) => inlineFormattingKey(formatting)))
    .size > 1;

const hasCompleteFormattingProjection = (
  snapshots: readonly FormattingRegionSnapshot[],
  targetRegions:
    | readonly { id: string; start: number; end: number }[]
    | undefined,
): boolean => {
  if (!requiresFormattingProjection(snapshots)) return true;
  if (!targetRegions || targetRegions.length !== snapshots.length) return false;

  const expectedIds = new Set(snapshots.map((_, index) => `fmt-${index}`));

  return (
    new Set(targetRegions.map(({ id }) => id)).size === targetRegions.length &&
    targetRegions.every(({ id }) => expectedIds.has(id))
  );
};

export const buildPageReview = (
  blocks: readonly CanvaTranslationBlock[],
  formattingSnapshots: ReadonlyMap<string, FormattingRegionSnapshot[]>,
  result: TranslationResponse,
): PageReview => {
  const returnedIds = result.translations.map(({ id }) => id);
  const expectedIds = new Set(blocks.map(({ localId }) => localId));

  if (
    new Set(returnedIds).size !== returnedIds.length ||
    returnedIds.some((id) => !expectedIds.has(id)) ||
    blocks.some(({ localId }) => !returnedIds.includes(localId))
  ) {
    throw new Error(
      "Translation response block IDs did not match the request.",
    );
  }

  const byId = new Map(result.translations.map((item) => [item.id, item]));

  const reviewBlocks = blocks.map(({ localId }) => {
    const item = byId.get(localId);

    if (!item) {
      throw new Error("Translation response is missing a block.");
    }

    const snapshots = formattingSnapshots.get(localId) ?? [];

    const formattingProjectionMissing = !hasCompleteFormattingProjection(
      snapshots,
      item.targetFormattingRegions,
    );

    const formattingErrors = formattingProjectionMissing
      ? [
          {
            code: "FORMATTING_MAPPING_REQUIRED",
            message:
              "This text block uses multiple inline styles, but the translated formatting regions could not be mapped safely.",
          },
        ]
      : [];

    const errors = [...item.errors, ...formattingErrors];

    const validation =
      !item.valid || errors.length > 0
        ? "BLOCK"
        : item.warnings.length > 0
          ? "WARNING"
          : "PASS";

    return {
      id: item.id,
      source: item.source,
      translated: item.translated,
      editedTranslation: item.translated,
      validation,
      errors,
      warnings: item.warnings,
      targetFormattingRegions: item.targetFormattingRegions,
    } satisfies ReviewBlock;
  });

  return normalizePageReviewSeverity({
    blocks: reviewBlocks,
    reviewStatus: "ready",
  });
};

export const translateCurrentPage = async (
  language: TargetLanguage,
  contextId: string,
  overrides: Partial<Dependencies> = {},
): Promise<PageReview> => {
  const dependencies: Dependencies = {
    queryCurrentPage: editContent,
    getDesignToken,
    getUserToken: auth.getCanvaUserToken,
    fetch: (...input) => globalThis.fetch(...input),
    backendHost: typeof BACKEND_HOST === "string" ? BACKEND_HOST : "",
    ...overrides,
  };
  const blocks = await readCurrentPageBlocks(
    dependencies.queryCurrentPage,
    contextId,
  );
  if (blocks.length === 0) return { blocks: [], reviewStatus: "ready" };

  const [{ token: designToken }, userToken] = await Promise.all([
    dependencies.getDesignToken(),
    dependencies.getUserToken(),
  ]);

  const response = await dependencies.fetch(
    `${dependencies.backendHost.replace(/\/$/u, "")}/api/translate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        designToken,
        sourceLanguage: "tr",
        targetLanguage: language,
        blocks: blocks.map(({ localId, sourceText }) => ({
          id: localId,
          text: sourceText,
          formattingRegions: activeReviewSessions
            .get(contextId)
            ?.formattingSnapshot.get(localId)
            ?.map(({ index, length }, regionIndex) => ({
              id: `fmt-${regionIndex}`,
              start: index,
              end: index + length,
            })),
        })),
      }),
    },
  );
  if (!response.ok) throw new Error("Translation request failed.");
  const result = (await response.json()) as TranslationResponse;
  return buildPageReview(
    blocks,
    activeReviewSessions.get(contextId)?.formattingSnapshot ?? new Map(),
    result,
  );
};

export const currentPageMatchesReview = async (
  review: PageReview,
  contextId: string,
  queryCurrentPage: typeof editContent = editContent,
): Promise<boolean> => {
  const blocks = await readCurrentPageBlocks(queryCurrentPage, contextId);
  return (
    blocks.length === review.blocks.length &&
    blocks.every(
      ({ localId, sourceText }, index) =>
        localId === review.blocks[index]?.id &&
        sourceText === review.blocks[index]?.source,
    )
  );
};

export class ApplyReviewError extends Error {
  constructor(
    public readonly code:
      | "TARGET_VERIFICATION_FAILED"
      | "STALE_REVIEW"
      | "MISSING_MAPPING"
      | "ALREADY_APPLIED"
      | "MUTATION_FAILED"
      | "SYNC_FAILED"
      | "PERMISSION_REQUIRED"
      | "FORMATTING_EDIT_CONFLICT",
  ) {
    super(code);
    this.name = "ApplyReviewError";
  }
}

const sortedTexts = (texts: readonly string[]) => [...texts].sort();

const inlineFormattingFromSnapshot = (
  formatting: Partial<RichtextFormatting>,
) => {
  const result: Record<string, unknown> = {};

  if (formatting.color !== undefined) {
    result.color = formatting.color;
  }

  if (formatting.fontWeight !== undefined) {
    result.fontWeight = formatting.fontWeight;
  }

  if (formatting.fontStyle !== undefined) {
    result.fontStyle = formatting.fontStyle;
  }

  if (formatting.decoration !== undefined) {
    result.decoration = formatting.decoration;
  }

  if (formatting.strikethrough !== undefined) {
    result.strikethrough = formatting.strikethrough;
  }

  if (formatting.link !== undefined) {
    result.link = formatting.link;
  }

  return result;
};

const applyProjectedFormatting = (
  block: ReviewBlock,
  reference: RichtextContentRange,
  snapshots: readonly FormattingRegionSnapshot[],
) => {
  if (block.editedTranslation !== block.translated) return;

  const targetRegions = block.targetFormattingRegions;
  if (!targetRegions?.length) return;

  const byId = new Map(
    snapshots.map((snapshot, index) => [`fmt-${index}`, snapshot]),
  );

  if (
    targetRegions.some(
      ({ id, start, end }) =>
        !byId.has(id) ||
        start < 0 ||
        end < start ||
        end > block.editedTranslation.length,
    )
  ) {
    return;
  }

  for (const region of targetRegions) {
    const snapshot = byId.get(region.id);
    if (!snapshot) continue;

    const formatting = inlineFormattingFromSnapshot(snapshot.formatting);

    reference.formatText(
      {
        index: region.start,
        length: region.end - region.start,
      },
      formatting,
    );
  }
};

export const applyPageReview = async (
  review: PageReview,
  expectedTarget: {
    contextId: string;
    language: TargetLanguage;
  },
  dependencies: {
    verifyTarget: () => Promise<DesignRole>;
    queryCurrentPage?: typeof editContent;
  },
) => {
  const verified = await dependencies.verifyTarget().catch(() => undefined);
  if (
    !verified?.isTranslationTarget ||
    verified.contextId !== expectedTarget.contextId ||
    verified.language !== expectedTarget.language
  ) {
    throw new ApplyReviewError("TARGET_VERIFICATION_FAILED");
  }
  const active = activeReviewSessions.get(expectedTarget.contextId);
  if (!active) throw new ApplyReviewError("MISSING_MAPPING");
  if (active.applied) throw new ApplyReviewError("ALREADY_APPLIED");
  if (review.reviewStatus === "blocked") {
    throw new ApplyReviewError("MUTATION_FAILED");
  }
  for (const block of review.blocks) {
    const formattingSnapshots = active.formattingSnapshot.get(block.id) ?? [];

    if (
      block.editedTranslation !== block.translated &&
      requiresFormattingProjection(formattingSnapshots)
    ) {
      throw new ApplyReviewError("FORMATTING_EDIT_CONFLICT");
    }

    const source = active.sourceSnapshot.get(block.id);
    if (!active.references.has(block.id) || source === undefined) {
      throw new ApplyReviewError("MISSING_MAPPING");
    }
    if (block.source !== source) {
      throw new ApplyReviewError("STALE_REVIEW");
    }
  }

  let synced = false;
  const phase: { value: "preflight" | "mutation" | "sync" } = {
    value: "preflight",
  };
  try {
    await (dependencies.queryCurrentPage ?? editContent)(
      { contentType: "richtext", target: "current_page" },
      async (session) => {
        const current = session.contents.filter(
          (content) => !content.deleted && content.readPlaintext().trim(),
        );
        const expectedTexts = [...active.sourceSnapshot.values()];
        if (
          JSON.stringify(
            sortedTexts(current.map((item) => item.readPlaintext())),
          ) !== JSON.stringify(sortedTexts(expectedTexts))
        ) {
          throw new ApplyReviewError("STALE_REVIEW");
        }

        const sourceEntries = [...active.sourceSnapshot.entries()];
        const blockIndexById = new Map(
          sourceEntries.map(([id], index) => [id, index]),
        );

        const mapped = review.blocks.map((block) => {
          const source = active.sourceSnapshot.get(block.id);
          const index = blockIndexById.get(block.id);

          if (source === undefined || index === undefined) {
            throw new ApplyReviewError("MISSING_MAPPING");
          }

          const reference = current[index];
          if (!reference || reference.readPlaintext() !== source) {
            throw new ApplyReviewError("MISSING_MAPPING");
          }

          return { block, reference, source };
        });

        phase.value = "mutation";
        for (const { block, reference, source } of mapped) {
          // Omitting formatting lets Canva retain the inherited base styling.
          reference.replaceText(
            { index: 0, length: source.length },
            block.editedTranslation,
          );

          applyProjectedFormatting(
            block,
            reference,
            active.formattingSnapshot.get(block.id) ?? [],
          );
        }
        phase.value = "sync";
        await session.sync();
        synced = true;
      },
    );
  } catch (cause) {
    if (cause instanceof ApplyReviewError) throw cause;
    if (
      cause instanceof Error &&
      /permission|scope|forbidden/iu.test(cause.message)
    ) {
      throw new ApplyReviewError("PERMISSION_REQUIRED");
    }
    throw new ApplyReviewError(
      phase.value === "sync" ? "SYNC_FAILED" : "MUTATION_FAILED",
    );
  }

  if (!synced) {
    throw new ApplyReviewError("SYNC_FAILED");
  }
  active.applied = true;
  return { appliedBlocks: review.blocks.length, layoutReviewRecommended: true };
};
