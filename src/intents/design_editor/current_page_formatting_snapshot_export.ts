import {
  editContent,
  getCurrentPageMetadata,
  type PageMetadata,
} from "@canva/design";

import {
  snapshotFormattingRegions,
  type FormattingRegionSnapshot,
} from "./translation_review";

export type CurrentPageFormattingSnapshotBlock = {
  order: number;
  sourceText: string;
  formattingRegions: FormattingRegionSnapshot[];
};

export type CurrentPageFormattingSnapshotExport = {
  pageId?: string;
  blocks: CurrentPageFormattingSnapshotBlock[];
};

export class CurrentPageFormattingSnapshotExportUnavailableError extends Error {
  constructor() {
    super(
      "captureCurrentPageFormattingSnapshotExport is a development-only tool " +
        "and is not available in a production build.",
    );
    this.name = "CurrentPageFormattingSnapshotExportUnavailableError";
  }
}

type CaptureDependencies = {
  queryCurrentPage: typeof editContent;
  getMetadata: () => Promise<PageMetadata>;
  isDevelopment: boolean;
};

export const captureCurrentPageFormattingSnapshotExport = async (
  overrides: Partial<CaptureDependencies> = {},
): Promise<CurrentPageFormattingSnapshotExport> => {
  const isDevelopment =
    overrides.isDevelopment ?? process.env.NODE_ENV !== "production";

  if (!isDevelopment) {
    throw new CurrentPageFormattingSnapshotExportUnavailableError();
  }

  const queryCurrentPage = overrides.queryCurrentPage ?? editContent;
  const getMetadata = overrides.getMetadata ?? getCurrentPageMetadata;

  const metadata = await getMetadata();
  const blocks: CurrentPageFormattingSnapshotBlock[] = [];

  await queryCurrentPage(
    { contentType: "richtext", target: "current_page" },
    (session) => {
      session.contents.forEach((range, order) => {
        if (range.deleted) return;

        const sourceText = range.readPlaintext();
        if (!sourceText.trim()) return;

        blocks.push({
          order,
          sourceText,
          formattingRegions: snapshotFormattingRegions(
            range.readTextRegions(),
          ),
        });
      });
    },
  );

  return {
    ...(metadata.type === "absolute" && metadata.id
      ? { pageId: metadata.id }
      : {}),
    blocks,
  };
};

export const serializeCurrentPageFormattingSnapshotExport = (
  snapshot: CurrentPageFormattingSnapshotExport,
): string => JSON.stringify(snapshot, null, 2);
