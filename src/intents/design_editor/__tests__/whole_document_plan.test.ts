import { buildWholeDocumentPlan } from "../whole_document_plan";
import type {
  WholeDocumentPage,
  WholeDocumentTextBlock,
} from "../whole_document_inventory";

const block = (sourceText: string): WholeDocumentTextBlock => ({
  id: "block",
  sourceText,
  order: 0,
  formattingRegions: [],
});

const page = (
  pageId: string,
  sourceText: string | undefined,
  options: { locked?: boolean; discoveryIndex?: number } = {},
): WholeDocumentPage => ({
  pageId,
  discoveryIndex: options.discoveryIndex ?? 1,
  locked: options.locked ?? false,
  blocks: sourceText === undefined ? [] : [block(sourceText)],
});

describe("whole document plan", () => {
  it("marks ordinary content pages as eligible", () => {
    const plan = buildWholeDocumentPlan([page("page-1", "6x örüyoruz")]);

    expect(plan.entries[0]).toMatchObject({
      pageId: "page-1",
      status: "eligible",
      classification: "content",
    });

    expect(plan.counts.eligible).toBe(1);
  });

  it("skips already applied pages by default", () => {
    const plan = buildWholeDocumentPlan([page("page-1", "6x örüyoruz")], {
      appliedPageIds: new Set(["page-1"]),
    });

    expect(plan.entries[0]?.status).toBe("applied");
    expect(plan.counts.applied).toBe(1);
    expect(plan.counts.eligible).toBe(0);
  });

  it("respects manual page exclusions", () => {
    const plan = buildWholeDocumentPlan([page("page-1", "Kulak")], {
      excludedPageIds: new Set(["page-1"]),
    });

    expect(plan.entries[0]?.status).toBe("excluded");
  });

  it("does not mark locked or empty pages eligible", () => {
    const plan = buildWholeDocumentPlan([
      page("locked", "Kulak", { locked: true }),
      page("empty", undefined),
    ]);

    expect(plan.entries.map(({ status }) => status)).toEqual([
      "locked",
      "empty",
    ]);
  });

  it("keeps template candidates out of ordinary eligible translation", () => {
    const plan = buildWholeDocumentPlan([
      page("page-1", "Malzemeler ve kısaltmalar"),
    ]);

    expect(plan.entries[0]).toMatchObject({
      status: "template_candidate",
      classification: "template_candidate",
    });
    expect(plan.counts.eligible).toBe(0);
    expect(plan.counts.template_candidate).toBe(1);
  });

  it("uses deterministic precedence for applied and exclusions", () => {
    const plan = buildWholeDocumentPlan([page("page-1", "Malzemeler")], {
      appliedPageIds: new Set(["page-1"]),
      excludedPageIds: new Set(["page-1"]),
    });

    expect(plan.entries[0]?.status).toBe("applied");
  });
});
