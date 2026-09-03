import {
  buildTemplateCandidateSnapshotExport,
  captureTemplateCandidateSnapshotExport,
  serializeTemplateCandidateSnapshotExport,
  TemplateSnapshotExportUnavailableError,
} from "../template_snapshot_export";
import { pageContentFingerprint } from "../whole_document_classification";
import type {
  WholeDocumentPage,
  WholeDocumentTextBlock,
} from "../whole_document_inventory";

const block = (sourceText: string, order = 0): WholeDocumentTextBlock => ({
  id: `block-${order}`,
  sourceText,
  order,
  formattingRegions: [],
});

const page = (
  pageId: string,
  blocks: WholeDocumentTextBlock[],
  discoveryIndex = 1,
): WholeDocumentPage => ({
  pageId,
  discoveryIndex,
  locked: false,
  blocks,
});

describe("captureTemplateCandidateSnapshotExport (development-only live entry point)", () => {
  it("is not available in production: it throws and never reads the document", async () => {
    const readInventory = jest.fn();

    await expect(
      captureTemplateCandidateSnapshotExport({
        isDevelopment: false,
        readInventory,
      }),
    ).rejects.toThrow(TemplateSnapshotExportUnavailableError);

    expect(readInventory).not.toHaveBeenCalled();
  });

  it("does nothing until explicitly invoked -- calling readInventory requires an explicit call", async () => {
    const readInventory = jest.fn().mockResolvedValue({
      pages: [page("front-cover", [block("Sample Doll")], 0)],
      skippedPages: [],
    });

    // Merely constructing/holding a reference to the function does not
    // read the document; only calling it does.
    const trigger = () =>
      captureTemplateCandidateSnapshotExport({
        isDevelopment: true,
        readInventory,
      });

    expect(readInventory).not.toHaveBeenCalled();

    await trigger();

    expect(readInventory).toHaveBeenCalledTimes(1);
  });

  it("exports only template_candidate pages, using the canonical page fingerprint", async () => {
    const templatePage = page("front-cover", [block("Sample Doll")], 0);
    const contentPage = page(
      "page-2",
      [block("Kulak"), block("6x örüyoruz", 1)],
      1,
    );

    const readInventory = jest.fn().mockResolvedValue({
      pages: [templatePage, contentPage],
      skippedPages: [],
    });

    const rows = await captureTemplateCandidateSnapshotExport({
      isDevelopment: true,
      readInventory,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.pageNumber).toBe(1);
    expect(rows[0]!.kind).toBe("front_cover");
    // Must be the exact same fingerprint the running app computes and
    // looks the deterministic registry up by -- not a re-derived or
    // approximated value.
    expect(rows[0]!.fingerprint).toBe(
      pageContentFingerprint(templatePage.blocks),
    );
    expect(rows[0]!.sourceBlockCount).toBe(1);
  });

  it("preserves source block order even when the underlying page lists blocks out of order", async () => {
    const outOfOrderPage = page(
      "page-3",
      [
        { id: "b2", sourceText: "İkinci blok", order: 2, formattingRegions: [] },
        { id: "b1", sourceText: "Malzemeler Birinci blok", order: 1, formattingRegions: [] },
      ],
      2,
    );

    const readInventory = jest.fn().mockResolvedValue({
      pages: [outOfOrderPage],
      skippedPages: [],
    });

    const rows = await captureTemplateCandidateSnapshotExport({
      isDevelopment: true,
      readInventory,
    });

    expect(rows[0]!.blocks.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(rows[0]!.blocks.map((b) => b.order)).toEqual([1, 2]);
    expect(rows[0]!.blocks.map((b) => b.sourceText)).toEqual([
      "Malzemeler Birinci blok",
      "İkinci blok",
    ]);
  });

  it("returns an empty array when nothing on the page classifies as a template candidate", async () => {
    const readInventory = jest.fn().mockResolvedValue({
      pages: [page("page-2", [block("Kulak"), block("6x örüyoruz", 1)], 1)],
      skippedPages: [],
    });

    const rows = await captureTemplateCandidateSnapshotExport({
      isDevelopment: true,
      readInventory,
    });

    expect(rows).toEqual([]);
  });
});

describe("buildTemplateCandidateSnapshotExport (pure)", () => {
  it("re-sorts blocks by order defensively, regardless of input order", () => {
    const rows = buildTemplateCandidateSnapshotExport([
      {
        fingerprint: "page-content-v1-abc",
        pageNumber: 1,
        kind: "front_cover",
        blocks: [
          { id: "b2", order: 2, sourceText: "İkinci blok", formattingRegions: [] },
          { id: "b1", order: 1, sourceText: "Birinci blok", formattingRegions: [] },
        ],
      },
    ]);

    expect(rows[0]!.blocks.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(rows[0]!.sourceBlockCount).toBe(2);
  });

  it("carries fingerprint/pageNumber/kind through unchanged", () => {
    const rows = buildTemplateCandidateSnapshotExport([
      {
        fingerprint: "page-content-v1-xyz",
        pageNumber: 9,
        kind: "closing",
        blocks: [{ id: "b1", order: 0, sourceText: "Teşekkürler", formattingRegions: [] }],
      },
    ]);

    expect(rows).toEqual([
      {
        fingerprint: "page-content-v1-xyz",
        pageNumber: 9,
        kind: "closing",
        sourceBlockCount: 1,
        blocks: [{ id: "b1", order: 0, sourceText: "Teşekkürler", formattingRegions: [] }],
      },
    ]);
  });
});

describe("serializeTemplateCandidateSnapshotExport", () => {
  it("produces JSON containing exactly the exported fields", () => {
    const json = serializeTemplateCandidateSnapshotExport([
      {
        fingerprint: "page-content-v1-abc",
        pageNumber: 1,
        kind: "front_cover",
        sourceBlockCount: 1,
        blocks: [{ id: "b1", order: 0, sourceText: "Sample Doll", formattingRegions: [] }],
      },
    ]);

    const parsed = JSON.parse(json);
    expect(parsed).toEqual([
      {
        fingerprint: "page-content-v1-abc",
        pageNumber: 1,
        kind: "front_cover",
        sourceBlockCount: 1,
        blocks: [{ id: "b1", order: 0, sourceText: "Sample Doll", formattingRegions: [] }],
      },
    ]);
  });
});
