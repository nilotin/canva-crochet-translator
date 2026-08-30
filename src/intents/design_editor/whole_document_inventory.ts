import {
  openDesign,
  type DesignEditing,
  type RichtextFormatting,
} from "@canva/design";

export type WholeDocumentFormattingRegion = {
  index: number;
  length: number;
  text: string;
  formatting: Partial<RichtextFormatting>;
};

export type WholeDocumentTextBlock = {
  id: string;
  sourceText: string;
  order: number;
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

const snapshotFormatting = (
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

const collectTextRanges = (
  elements: readonly DesignEditing.AbsoluteElement[],
): DesignEditing.TextElement["text"][] => {
  const ranges: DesignEditing.TextElement["text"][] = [];

  for (const element of elements) {
    if (element.type === "text") {
      ranges.push(element.text);
      continue;
    }

    if (element.type !== "group") continue;

    for (const child of element.contents.toArray()) {
      if (child.type === "text") {
        ranges.push(child.text);
      }
    }
  }

  return ranges;
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

          const ranges = collectTextRanges(page.elements.toArray());

          const blocks = ranges.flatMap((range, order) => {
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
            blocks,
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
