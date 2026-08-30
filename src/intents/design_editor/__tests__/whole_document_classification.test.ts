import {
  classifyWholeDocumentPage,
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
