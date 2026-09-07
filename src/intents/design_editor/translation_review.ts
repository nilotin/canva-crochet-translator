import {
  editContent,
  getCurrentPageMetadata,
  getDesignToken,
  type InlineFormatting,
  type RichtextContentRange,
  type RichtextFormatting,
  type TextRegion,
} from "@canva/design";
import { auth } from "@canva/user";
import type { TargetLanguage } from "./copy_designs";
import type { DesignRole } from "./target_context";
import type { PageIdentity } from "./page_identity";
import { normalizePageReviewSeverity } from "./review_severity";
import { formattingRegionSignature } from "./formatting_freshness";
import {
  buildStaticTemplateTranslationResponse,
  recognizePage2Hybrid,
} from "./static_template_translation";
import {
  readWholeDocumentInventory,
  type WholeDocumentInventory,
} from "./whole_document_inventory";

import {
  remapFormattingRegions,
  FormattingRemapError,
  type FormattingEditReason,
} from "./formatting_remap";

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
  sourceFormattingSignature?: string;
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
  getPageMetadata: typeof getCurrentPageMetadata;
  readInventory: typeof readWholeDocumentInventory;
  getDesignToken: typeof getDesignToken;
  getUserToken: typeof auth.getCanvaUserToken;
  fetch: typeof fetch;
  backendHost: string;
};

type CurrentPageTemplateContext = {
  page: WholeDocumentInventory["pages"][number];
  documentContext: {
    totalPages: number;
    firstPage?: WholeDocumentInventory["pages"][number];
  };
};

const readAbsolutePageId = async (
  getPageMetadata: typeof getCurrentPageMetadata,
): Promise<string | undefined> => {
  try {
    const metadata = await getPageMetadata();
    return metadata.type === "absolute" ? metadata.id : undefined;
  } catch {
    return undefined;
  }
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

type ParagraphFormatting = Pick<
  RichtextFormatting,
  | "fontRef"
  | "fontSize"
  | "letterSpacingEm"
  | "lineHeightEm"
  | "textAlign"
  | "listLevel"
  | "listMarker"
>;

const paragraphFormattingFromSnapshot = (
  formatting: Partial<RichtextFormatting>,
): ParagraphFormatting => {
  const result: ParagraphFormatting = {};
  if (formatting.fontRef !== undefined) result.fontRef = formatting.fontRef;
  if (formatting.fontSize !== undefined) result.fontSize = formatting.fontSize;
  if (formatting.letterSpacingEm !== undefined)
    result.letterSpacingEm = formatting.letterSpacingEm;
  if (formatting.lineHeightEm !== undefined)
    result.lineHeightEm = formatting.lineHeightEm;
  if (formatting.textAlign !== undefined)
    result.textAlign = formatting.textAlign;
  if (formatting.listLevel !== undefined)
    result.listLevel = formatting.listLevel;
  if (formatting.listMarker !== undefined)
    result.listMarker = formatting.listMarker;
  return result;
};

export const requiresFormattingProjection = (
  snapshots: readonly FormattingRegionSnapshot[],
): boolean =>
  new Set(
    snapshots.map(({ formatting }) =>
      JSON.stringify([
        inlineFormattingKey(formatting),
        paragraphFormattingFromSnapshot(formatting),
      ]),
    ),
  ).size > 1;

const hasCompleteFormattingProjection = (
  snapshots: readonly FormattingRegionSnapshot[],
  targetRegions:
    | readonly { id: string; start: number; end: number }[]
    | undefined,
  targetLength: number,
): boolean => {
  if (!requiresFormattingProjection(snapshots)) return true;
  if (!targetRegions || targetRegions.length !== snapshots.length) return false;

  let end = 0;
  for (const [index, region] of targetRegions.entries()) {
    if (
      region.id !== `fmt-${index}` ||
      !Number.isInteger(region.start) ||
      !Number.isInteger(region.end) ||
      region.start !== end ||
      region.end <= region.start ||
      region.end > targetLength
    ) {
      return false;
    }
    end = region.end;
  }
  return end === targetLength;
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
      item.translated.length,
    );

    const formattingErrors = formattingProjectionMissing
      ? [
          {
            code: "FORMATTING_MAPPING_REQUIRED",
            message:
              "This text block uses multiple text styles, but the translated formatting regions could not be mapped safely.",
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
      sourceFormattingSignature: formattingRegionSignature(snapshots),
      targetFormattingRegions: item.targetFormattingRegions,
    } satisfies ReviewBlock;
  });

  return normalizePageReviewSeverity({
    blocks: reviewBlocks,
    reviewStatus: "ready",
  });
};

const currentPageTemplateContext = async (
  blocks: readonly CanvaTranslationBlock[],
  formattingSnapshots: ReadonlyMap<string, FormattingRegionSnapshot[]>,
  dependencies: Pick<Dependencies, "getPageMetadata" | "readInventory">,
  expectedPageId: string | undefined,
): Promise<CurrentPageTemplateContext | undefined> => {
  if (!expectedPageId) return undefined;

  try {
    const inventory = await dependencies.readInventory();
    const currentPageId = await readAbsolutePageId(dependencies.getPageMetadata);

    if (currentPageId !== expectedPageId) {
      return undefined;
    }

    const inventoryPage = inventory.pages.find(
      ({ pageId }) => pageId === expectedPageId,
    );
    if (!inventoryPage) return undefined;

    const orderedCurrentBlocks = [...blocks].sort(
      (left, right) => left.order - right.order,
    );

    return {
      page: {
        ...inventoryPage,
        blocks: orderedCurrentBlocks.map(({ localId, sourceText, order }) => ({
          id: localId,
          sourceText,
          order,
          formattingRegions: formattingSnapshots.get(localId) ?? [],
        })),
      },
      documentContext: {
        totalPages: inventory.pages.length + inventory.skippedPages.length,
        firstPage: inventory.pages.find(({ discoveryIndex }) => discoveryIndex === 0),
      },
    };
  } catch {
    return undefined;
  }
};

const requestCurrentPageTranslation = async (
  dependencies: Dependencies,
  language: TargetLanguage,
  blocks: readonly CanvaTranslationBlock[],
  formattingSnapshots: ReadonlyMap<string, FormattingRegionSnapshot[]>,
  contentKind?: "materials",
): Promise<TranslationResponse> => {
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
        ...(contentKind ? { contentKind } : {}),
        blocks: blocks.map(({ localId, sourceText }) => ({
          id: localId,
          text: sourceText,
          formattingRegions: formattingSnapshots
            .get(localId)
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
  return (await response.json()) as TranslationResponse;
};

export const translateCurrentPage = async (
  language: TargetLanguage,
  contextId: string,
  overrides: Partial<Dependencies> = {},
): Promise<PageReview> => {
  const dependencies: Dependencies = {
    queryCurrentPage: editContent,
    getPageMetadata: getCurrentPageMetadata,
    readInventory: readWholeDocumentInventory,
    getDesignToken,
    getUserToken: auth.getCanvaUserToken,
    fetch: (...input) => globalThis.fetch(...input),
    backendHost: typeof BACKEND_HOST === "string" ? BACKEND_HOST : "",
    ...overrides,
  };
  const initialPageId = await readAbsolutePageId(dependencies.getPageMetadata);
  const blocks = await readCurrentPageBlocks(
    dependencies.queryCurrentPage,
    contextId,
  );
  if (blocks.length === 0) return { blocks: [], reviewStatus: "ready" };

  const formattingSnapshots =
    activeReviewSessions.get(contextId)?.formattingSnapshot ?? new Map();
  const templateContext = await currentPageTemplateContext(
    blocks,
    formattingSnapshots,
    dependencies,
    initialPageId,
  );
  const page2Hybrid = templateContext
    ? recognizePage2Hybrid(templateContext.page, blocks, language)
    : undefined;
  const staticResult =
    templateContext && !page2Hybrid
      ? buildStaticTemplateTranslationResponse(
          templateContext.page,
          blocks,
          language,
          templateContext.documentContext,
        )
      : undefined;

  let result: TranslationResponse;
  if (page2Hybrid) {
    const materialsBlock = blocks.find(
      ({ localId }) => localId === page2Hybrid.materialsBlockId,
    );
    if (!materialsBlock) {
      throw new Error("Recognized Page 2 skeleton is missing its materials block.");
    }

    const materialsResult = await requestCurrentPageTranslation(
      dependencies,
      language,
      [materialsBlock],
      formattingSnapshots,
      "materials",
    );
    const materialsTranslation = materialsResult.translations.find(
      ({ id }) => id === materialsBlock.localId,
    );
    if (!materialsTranslation || materialsResult.translations.length !== 1) {
      throw new Error("Materials translation response was malformed.");
    }

    result = {
      translations: [
        ...page2Hybrid.deterministicTranslations,
        materialsTranslation,
      ],
    };
  } else if (staticResult) {
    result = staticResult;
  } else {
    result = await requestCurrentPageTranslation(
      dependencies,
      language,
      blocks,
      formattingSnapshots,
    );
  }

  return buildPageReview(
    blocks,
    formattingSnapshots,
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
    ) && reviewFormattingMatchesSession(review, contextId)
  );
};

export const reviewFormattingMatchesSession = (
  review: PageReview,
  contextId: string,
): boolean => {
  const active = activeReviewSessions.get(contextId);
  if (!active) return false;

  return review.blocks.every((block) => {
    const snapshot = active.formattingSnapshot.get(block.id);
    return (
      snapshot !== undefined &&
      block.sourceFormattingSignature !== undefined &&
      block.sourceFormattingSignature === formattingRegionSignature(snapshot)
    );
  });
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
    public readonly details?: { blockId: string; reason: FormattingEditReason },
  ) {
    super(code);
    this.name = "ApplyReviewError";
  }
}

const sortedTexts = (texts: readonly string[]) => [...texts].sort();

const inlineFormattingFromSnapshot = (
  formatting: Partial<RichtextFormatting>,
) => {
  const result: InlineFormatting = {};

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

// Prepare before replaceText so unsupported paragraph mappings cannot mutate text.
export const planProjectedFormatting = (
  block: ReviewBlock,
  snapshots: readonly FormattingRegionSnapshot[],
) => {
  const manuallyEdited = block.editedTranslation !== block.translated;
  const conflict = (reason: FormattingEditReason): never => {
    throw new ApplyReviewError("FORMATTING_EDIT_CONFLICT", {
      blockId: block.id,
      reason,
    });
  };
  let targetRegions = block.targetFormattingRegions;
  if (manuallyEdited && !requiresFormattingProjection(snapshots)) {
    // Uniform formatting needs no boundary inference, including complete rewrites.
    targetRegions = snapshots.length
      ? [{ id: "fmt-0", start: 0, end: block.editedTranslation.length }]
      : [];
  } else if (manuallyEdited) {
    if (
      !hasCompleteFormattingProjection(
        snapshots,
        targetRegions,
        block.translated.length,
      )
    ) {
      conflict("INVALID_TEMPLATE");
    }
    try {
      targetRegions = remapFormattingRegions(
        block.translated,
        block.editedTranslation,
        targetRegions ?? [],
      );
    } catch (cause) {
      if (cause instanceof FormattingRemapError) conflict(cause.reason);
      throw cause;
    }
  }
  if (!targetRegions?.length && !manuallyEdited) {
    if (requiresFormattingProjection(snapshots)) {
      throw new ApplyReviewError("MISSING_MAPPING");
    }
    // A uniform source needs no linguistic mapping, even if its length changes.
    targetRegions = snapshots.length
      ? [{ id: "fmt-0", start: 0, end: block.editedTranslation.length }]
      : [];
  }

  targetRegions ??= [];
  const byId = new Map(
    snapshots.map((snapshot, index) => [`fmt-${index}`, snapshot]),
  );
  if (
    (!manuallyEdited &&
      !hasCompleteFormattingProjection(
        snapshots,
        targetRegions,
        block.editedTranslation.length,
      )) ||
    targetRegions.some(
      ({ id, start, end }) =>
        !byId.has(id) ||
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end < start ||
        end > block.editedTranslation.length,
    )
  ) {
    throw new ApplyReviewError("MISSING_MAPPING");
  }

  const regions = targetRegions.flatMap((region) => {
    const snapshot = byId.get(region.id);
    if (!snapshot || region.start === region.end) return [];
    return [
      {
        bounds: { index: region.start, length: region.end - region.start },
        inline: inlineFormattingFromSnapshot(snapshot.formatting),
        paragraph: paragraphFormattingFromSnapshot(snapshot.formatting),
      },
    ];
  });

  // formatParagraph expands to entire paragraphs. Group overlapping projected
  // runs first, rejecting rich-style differences that this API cannot preserve.
  let index = 0;
  const paragraphs = block.editedTranslation
    .split("\n")
    .flatMap((text, i, all) => {
      const length = text.length + (i < all.length - 1 ? 1 : 0);
      const bounds = { index, length };
      index += length;
      const overlapping = regions.filter(
        ({ bounds: region }) =>
          region.index < index && region.index + region.length > bounds.index,
      );
      if (
        new Set(overlapping.map(({ paragraph }) => JSON.stringify(paragraph)))
          .size > 1
      ) {
        if (manuallyEdited) conflict("PARAGRAPH_STYLE_CONFLICT");
        throw new ApplyReviewError("MISSING_MAPPING");
      }
      const formatting = overlapping[0]?.paragraph;
      return length && formatting && Object.keys(formatting).length
        ? [{ bounds, formatting }]
        : [];
    });

  return { paragraphs, regions };
};

export const prepareProjectedFormatting = (
  block: ReviewBlock,
  reference: Pick<RichtextContentRange, "formatText" | "formatParagraph">,
  snapshots: readonly FormattingRegionSnapshot[],
): (() => void) => {
  const { paragraphs, regions } = planProjectedFormatting(block, snapshots);
  return () => {
    for (const { bounds, formatting } of paragraphs) {
      reference.formatParagraph(bounds, formatting);
    }
    for (const { bounds, inline } of regions) {
      reference.formatText(bounds, inline);
    }
  };
};

export const applyProjectedFormatting = (
  block: ReviewBlock,
  reference: Pick<RichtextContentRange, "formatText" | "formatParagraph">,
  snapshots: readonly FormattingRegionSnapshot[],
) => prepareProjectedFormatting(block, reference, snapshots)();

export const applyPageReview = async (
  review: PageReview,
  expectedTarget: {
    contextId: string;
    language: TargetLanguage;
    pageIdentityKey?: string;
    pageIdentitySource?: PageIdentity["source"];
  },
  dependencies: {
    verifyTarget: () => Promise<DesignRole>;
    getPageIdentity?: () => Promise<PageIdentity>;
    getPageMetadata?: typeof getCurrentPageMetadata;
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
    const source = active.sourceSnapshot.get(block.id);
    if (!active.references.has(block.id) || source === undefined) {
      throw new ApplyReviewError("MISSING_MAPPING");
    }
    if (block.source !== source) {
      throw new ApplyReviewError("STALE_REVIEW");
    }
  }

  if (expectedTarget.pageIdentityKey) {
    // Content fingerprints are useful for passive page detection and persistence,
    // but cannot distinguish two genuinely identical pages. Mutation therefore
    // requires Canva's stable page ID and fails closed when it is unavailable.
    if (expectedTarget.pageIdentitySource !== "canva_page_id") {
      throw new ApplyReviewError("STALE_REVIEW");
    }

    if (!dependencies.getPageIdentity) {
      throw new ApplyReviewError("STALE_REVIEW");
    }

    const currentPageIdentity = await dependencies
      .getPageIdentity()
      .catch(() => undefined);

    if (
      !currentPageIdentity ||
      currentPageIdentity.source !== "canva_page_id" ||
      currentPageIdentity.key !== expectedTarget.pageIdentityKey
    ) {
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
        if (expectedTarget.pageIdentityKey) {
          const metadata = await (
            dependencies.getPageMetadata ?? getCurrentPageMetadata
          )().catch(() => undefined);

          const sessionPageKey =
            metadata?.type === "absolute" && metadata.id
              ? `page:${metadata.id}`
              : undefined;

          if (sessionPageKey !== expectedTarget.pageIdentityKey) {
            throw new ApplyReviewError("STALE_REVIEW");
          }
        }

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

          const capturedFormatting =
            active.formattingSnapshot.get(block.id) ?? [];
          const capturedSignature = formattingRegionSignature(capturedFormatting);
          const liveSignature = formattingRegionSignature(
            snapshotFormattingRegions(reference.readTextRegions()),
          );
          if (
            block.sourceFormattingSignature !== capturedSignature ||
            liveSignature !== capturedSignature
          ) {
            throw new ApplyReviewError("STALE_REVIEW");
          }

          const applyFormatting = prepareProjectedFormatting(
            block,
            reference,
            capturedFormatting,
          );
          return { block, reference, source, applyFormatting };
        });

        phase.value = "mutation";
        for (const { block, reference, source, applyFormatting } of mapped) {
          // Restore the captured styles explicitly after replacing the text.
          reference.replaceText(
            { index: 0, length: source.length },
            block.editedTranslation,
          );

          applyFormatting();
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
