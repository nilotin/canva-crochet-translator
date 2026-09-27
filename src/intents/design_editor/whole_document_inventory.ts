import {
  openDesign,
  type DesignEditing,
  type RichtextFormatting,
} from "@canva/design";
import { computeReadingOrder, type ReadingOrderBox } from "./reading_order";

export type WholeDocumentFormattingRegion = {
  index: number;
  length: number;
  text: string;
  formatting: Partial<RichtextFormatting>;
};

export type WholeDocumentTextBlock = {
  id: string;
  sourceText: string;
  // Raw SDK iteration index; apply, freshness and template logic rely on it.
  order: number;
  // Semantic page-local reading order (reading_order.ts). Present on every
  // block of a page only when that page's layout makes it unambiguous;
  // otherwise absent on every block. Never used to reorder anything here.
  readingOrder?: number;
  formattingRegions: WholeDocumentFormattingRegion[];
};

export type WholeDocumentPage = {
  pageId: string;
  discoveryIndex: number;
  locked: boolean;
  blocks: WholeDocumentTextBlock[];
};

export type SkippedWholeDocumentPage = {
  discoveryIndex: number;
  reason: string;
};

export type WholeDocumentInventory = {
  pages: WholeDocumentPage[];
  skippedPages: SkippedWholeDocumentPage[];
};

type Dependencies = {
  openDesign: typeof openDesign;
};

export const snapshotFormatting = (
  range: DesignEditing.TextElement["text"],
): WholeDocumentFormattingRegion[] => {
  let index = 0;

  return range.readTextRegions().map((region) => {
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

type Geometry = Omit<ReadingOrderBox, "originalIndex">;

const GROUP_BOUNDS_TOLERANCE = 1;

// Reads only the numeric position fields; anything missing stays undefined
// and makes the page's reading order untrusted.
const geometryOf = (element: unknown): Geometry => {
  const { top, left, width, height, rotation } = element as Partial<
    Record<keyof Geometry, unknown>
  >;
  const numberOrUndefined = (value: unknown) =>
    typeof value === "number" ? value : undefined;

  return {
    top: numberOrUndefined(top),
    left: numberOrUndefined(left),
    width: numberOrUndefined(width),
    height: numberOrUndefined(height),
    rotation: numberOrUndefined(rotation),
  };
};

// A group child's box on the page: its offsets are taken relative to the
// group, and the result must lie inside the group's own box. If it does not
// (or anything is missing), the child has no usable geometry, so a wrong
// coordinate assumption can only make the page untrusted, never misordered.
const groupChildGeometry = (group: Geometry, child: Geometry): Geometry => {
  const values = [group.top, group.left, group.width, group.height];
  const offsets = [child.top, child.left, child.width, child.height];

  if (
    values.some((value) => value === undefined) ||
    offsets.some((value) => value === undefined)
  ) {
    return {};
  }

  const top = group.top! + child.top!;
  const left = group.left! + child.left!;
  const fits =
    top >= group.top! - GROUP_BOUNDS_TOLERANCE &&
    left >= group.left! - GROUP_BOUNDS_TOLERANCE &&
    top + child.height! <=
      group.top! + group.height! + GROUP_BOUNDS_TOLERANCE &&
    left + child.width! <=
      group.left! + group.width! + GROUP_BOUNDS_TOLERANCE;

  if (!fits) return {};

  return {
    top,
    left,
    width: child.width,
    height: child.height,
    rotation:
      (group.rotation ?? 0) !== 0 ? group.rotation : child.rotation,
  };
};

export type TextRangeEntry = {
  range: DesignEditing.TextElement["text"];
  geometry: Geometry;
};

// Text ranges in SDK iteration order (top-level text, then each group's
// text children in place), with each range's page geometry.
export const collectTextRangeEntries = (
  elements: readonly DesignEditing.AbsoluteElement[],
): TextRangeEntry[] => {
  const entries: TextRangeEntry[] = [];

  for (const element of elements) {
    if (element.type === "text") {
      entries.push({ range: element.text, geometry: geometryOf(element) });
      continue;
    }

    if (element.type !== "group") continue;

    const group = geometryOf(element);

    for (const child of element.contents.toArray()) {
      if (child.type === "text") {
        entries.push({
          range: child.text,
          geometry: groupChildGeometry(group, geometryOf(child)),
        });
      }
    }
  }

  return entries;
};

export const collectTextRanges = (
  elements: readonly DesignEditing.AbsoluteElement[],
): DesignEditing.TextElement["text"][] =>
  collectTextRangeEntries(elements).map(({ range }) => range);

// Adds `readingOrder` to every block when the page's layout is unambiguous;
// otherwise returns the blocks unchanged.
const withReadingOrder = (
  blocks: WholeDocumentTextBlock[],
  geometryByOrder: readonly Geometry[],
): WholeDocumentTextBlock[] => {
  const result = computeReadingOrder(
    blocks.map(({ order }) => ({
      originalIndex: order,
      ...geometryByOrder[order],
    })),
  );

  if (!result.trusted) return blocks;

  return blocks.map((block, index) => ({
    ...block,
    readingOrder: result.readingOrder[index],
  }));
};

export const readWholeDocumentInventory = async (
  overrides: Partial<Dependencies> = {},
): Promise<WholeDocumentInventory> => {
  const open = overrides.openDesign ?? openDesign;

  const pages: WholeDocumentPage[] = [];
  const skippedPages: SkippedWholeDocumentPage[] = [];

  await open({ type: "all_pages" }, async (session) => {
    const pageRefs = session.pageRefs.toArray();

    for (const [discoveryIndex, pageRef] of pageRefs.entries()) {
      const response = await session.helpers.openPage(
        pageRef,
        async ({ page }) => {
          if (page.type !== "absolute") return;

          const entries = collectTextRangeEntries(page.elements.toArray());

          const blocks = entries.flatMap(({ range }, order) => {
            const sourceText = range.readPlaintext();

            if (!sourceText.trim()) return [];

            return [
              {
                id: `page-${page.id}-block-${order + 1}`,
                sourceText,
                order,
                formattingRegions: snapshotFormatting(range),
              },
            ];
          });

          pages.push({
            pageId: page.id,
            discoveryIndex,
            locked: page.locked,
            blocks: withReadingOrder(
              blocks,
              entries.map(({ geometry }) => geometry),
            ),
          });
        },
      );

      if (response.status === "skipped") {
        skippedPages.push({
          discoveryIndex,
          reason: response.reason,
        });
      }
    }

    // Intentionally read-only: do not call session.sync().
  });

  return { pages, skippedPages };
};
