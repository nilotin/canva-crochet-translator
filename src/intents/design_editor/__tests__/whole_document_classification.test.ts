import {
  captureTemplateCandidateSnapshot,
  classifyWholeDocumentPage,
  diagnoseTemplateCandidates,
  formatTemplateCandidateDiagnostics,
  guessTemplateCandidateKind,
  pageContentFingerprint,
} from "../whole_document_classification";
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

describe("whole document classification", () => {
  it("creates the same fingerprint for whitespace-equivalent text", () => {
    expect(
      pageContentFingerprint([block("Malzemeler   ve\n kısaltmalar")]),
    ).toBe(pageContentFingerprint([block("Malzemeler ve kısaltmalar")]));
  });

  it("changes the fingerprint when page text changes", () => {
    expect(pageContentFingerprint([block("Kulak")])).not.toBe(
      pageContentFingerprint([block("Kaş")]),
    );
  });

  it("classifies empty pages", () => {
    expect(classifyWholeDocumentPage(page("page-1", []))).toMatchObject({
      classification: "empty",
      textBlockCount: 0,
    });
  });

  it("always marks a non-empty front cover as a template candidate", () => {
    expect(
      classifyWholeDocumentPage(page("front-cover", [block("Sample Doll")], 0)),
    ).toMatchObject({
      classification: "template_candidate",
      textBlockCount: 1,
    });
  });

  it("marks terminology/material pages as template candidates", () => {
    expect(
      classifyWholeDocumentPage(
        page("page-2", [
          block("Malzemeler"),
          block("Kısaltmalar ve terimler", 1),
        ]),
      ),
    ).toMatchObject({
      classification: "template_candidate",
      textBlockCount: 2,
    });
  });

  it("also classifies singular malzeme wording as a template candidate", () => {
    expect(
      classifyWholeDocumentPage(
        page("page-2-singular", [block("Gerekli Malzeme")]),
      ),
    ).toMatchObject({
      classification: "template_candidate",
      textBlockCount: 1,
    });
  });

  it("leaves ordinary pattern pages as content", () => {
    expect(
      classifyWholeDocumentPage(
        page("page-3", [block("Kulak"), block("6x örüyoruz", 1)]),
      ),
    ).toMatchObject({
      classification: "content",
    });
  });
});

describe("template-candidate diagnostics (development-only)", () => {
  it("guesses front_cover for the first page regardless of its text", () => {
    expect(guessTemplateCandidateKind(page("front-cover", [block("Sample Doll")], 0))).toBe(
      "front_cover",
    );
  });

  it("guesses materials_reference for a materials/abbreviations page", () => {
    expect(
      guessTemplateCandidateKind(
        page("page-2", [block("Malzemeler"), block("Kısaltmalar ve terimler", 1)], 3),
      ),
    ).toBe("materials_reference");
  });

  it("guesses closing for a social/copyright page", () => {
    expect(
      guessTemplateCandidateKind(
        page("page-9", [block("Instagram: @example  |  Etsy: example-shop")], 9),
      ),
    ).toBe("closing");
  });

  it("guesses materials_reference for singular \"malzeme\" wording, not just the plural", () => {
    // Regression for a real E2E finding: Page 2 of the live document was
    // titled with singular "Malzeme" wording and also carried a generic
    // footer containing "Etsy"/"copyright" (present on multiple pages).
    // The old plural-only "malzemeler" hint missed the singular title, so
    // the kind guess fell through to the closing-hint check below and
    // reported "closing" for what is actually the materials_reference
    // page.
    expect(
      guessTemplateCandidateKind(
        page(
          "page-2",
          [
            block("Gerekli Malzeme"),
            block("İpler ve Kanca", 1),
            block("Etsy: example-shop | Copyright example", 2),
          ],
          1,
        ),
      ),
    ).toBe("materials_reference");
  });

  it("falls back to unknown for a template candidate that matches no hint", () => {
    // discoveryIndex !== 0 and no hint text -- classifyWholeDocumentPage
    // would only call this a template_candidate via the discoveryIndex-0
    // rule, so this exercises the heuristic's own fallback directly.
    expect(
      guessTemplateCandidateKind(page("page-5", [block("Some unrelated text")], 5)),
    ).toBe("unknown");
  });

  it("collects only template_candidate pages, with page numbers and no source text", () => {
    const pages = [
      page("front-cover", [block("Sample Doll")], 0),
      page("page-2", [block("Kulak"), block("6x örüyoruz", 1)], 1),
      page("page-3", [block("Malzemeler"), block("Kısaltmalar", 1)], 2),
    ];

    const diagnostics = diagnoseTemplateCandidates(pages);

    expect(diagnostics).toEqual([
      {
        pageNumber: 1,
        kind: "front_cover",
        fingerprint: pageContentFingerprint(pages[0]!.blocks),
        textBlockCount: 1,
      },
      {
        pageNumber: 3,
        kind: "materials_reference",
        fingerprint: pageContentFingerprint(pages[2]!.blocks),
        textBlockCount: 2,
      },
    ]);

    // Never source text, translations, or anything beyond the four safe
    // fields -- assert the exact key set on every row.
    for (const diagnostic of diagnostics) {
      expect(Object.keys(diagnostic).sort()).toEqual([
        "fingerprint",
        "kind",
        "pageNumber",
        "textBlockCount",
      ]);
    }
  });

  it("returns nothing when no page is a template candidate", () => {
    const pages = [page("page-3", [block("Kulak"), block("6x örüyoruz", 1)], 1)];
    expect(diagnoseTemplateCandidates(pages)).toEqual([]);
  });

  it("formats diagnostics as the human-readable comparison table", () => {
    const pages = [page("front-cover", [block("Sample Doll")], 0)];
    const [diagnostic] = diagnoseTemplateCandidates(pages);

    expect(formatTemplateCandidateDiagnostics([diagnostic!])).toBe(
      `Page 1 | ${"front_cover".padEnd(20)} | ${diagnostic!.fingerprint} | blocks: 1`,
    );
  });
});

describe("captureTemplateCandidateSnapshot (development-only source capture)", () => {
  it("includes only template_candidate pages, with fingerprint/pageNumber/kind/blocks", () => {
    const pages = [
      page("front-cover", [block("Sample Doll")], 0),
      page("page-2", [block("Kulak"), block("6x örüyoruz", 1)], 1),
      page("page-3", [block("Malzemeler"), block("Kısaltmalar", 1)], 2),
    ];

    const snapshots = captureTemplateCandidateSnapshot(pages);

    expect(snapshots).toEqual([
      {
        fingerprint: pageContentFingerprint(pages[0]!.blocks),
        pageNumber: 1,
        kind: "front_cover",
        blocks: [{ id: "block-0", order: 0, sourceText: "Sample Doll", formattingRegions: [] }],
      },
      {
        fingerprint: pageContentFingerprint(pages[2]!.blocks),
        pageNumber: 3,
        kind: "materials_reference",
        blocks: [
          { id: "block-0", order: 0, sourceText: "Malzemeler", formattingRegions: [] },
          { id: "block-1", order: 1, sourceText: "Kısaltmalar", formattingRegions: [] },
        ],
      },
    ]);
  });

  it("unlike diagnoseTemplateCandidates, includes the raw source text of every block", () => {
    const pages = [page("front-cover", [block("Sample Doll")], 0)];

    const [snapshot] = captureTemplateCandidateSnapshot(pages);

    expect(snapshot!.blocks).toEqual([
      { id: "block-0", order: 0, sourceText: "Sample Doll", formattingRegions: [] },
    ]);
    expect(Object.keys(snapshot!).sort()).toEqual([
      "blocks",
      "fingerprint",
      "kind",
      "pageNumber",
    ]);
  });

  it("returns nothing when no page is a template candidate", () => {
    const pages = [page("page-3", [block("Kulak"), block("6x örüyoruz", 1)], 1)];
    expect(captureTemplateCandidateSnapshot(pages)).toEqual([]);
  });

  it("is a pure function with no side effects (never logs)", () => {
    const pages = [page("front-cover", [block("Sample Doll")], 0)];
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    captureTemplateCandidateSnapshot(pages);

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
