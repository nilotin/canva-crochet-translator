import {
  digestWholeDocumentBlocks,
  digestWholeDocumentPage,
} from "../whole_document_snapshot";
import type { WholeDocumentTextBlock } from "../whole_document_inventory";

const block = (
  id: string,
  sourceText: string,
  order: number,
): WholeDocumentTextBlock => ({
  id,
  sourceText,
  order,
  formattingRegions: [],
});

describe("whole-document snapshot digest", () => {
  it("detects exact text changes including whitespace", () => {
    expect(
      digestWholeDocumentBlocks([block("a", "Hello\nworld", 0)]),
    ).not.toBe(
      digestWholeDocumentBlocks([block("a", "Hello world", 0)]),
    );
  });

  it("is sensitive to block order", () => {
    expect(
      digestWholeDocumentBlocks([
        block("a", "First", 0),
        block("b", "Second", 1),
      ]),
    ).not.toBe(
      digestWholeDocumentBlocks([
        block("b", "Second", 0),
        block("a", "First", 1),
      ]),
    );
  });

  it("does not depend on API-local block IDs", () => {
    expect(
      digestWholeDocumentBlocks([
        block("page-1-block-1", "First", 0),
        block("page-1-block-2", "Second", 1),
      ]),
    ).toBe(
      digestWholeDocumentBlocks([
        block("different-id-a", "First", 0),
        block("different-id-b", "Second", 1),
      ]),
    );
  });

  it("digests a whole page from its ordered blocks", () => {
    const blocks = [
      block("a", "First", 0),
      block("b", "Second", 1),
    ];

    expect(
      digestWholeDocumentPage({
        pageId: "page-1",
        discoveryIndex: 0,
        locked: false,
        blocks,
      }),
    ).toBe(digestWholeDocumentBlocks(blocks));
  });
});
