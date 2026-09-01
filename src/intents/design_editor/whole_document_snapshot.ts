import type {
  WholeDocumentPage,
  WholeDocumentTextBlock,
} from "./whole_document_inventory";

const hash = (value: string): string => {
  let first = 2166136261;
  let second = 2246822519;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489917);
  }

  return `${(first >>> 0).toString(16).padStart(8, "0")}${(
    second >>> 0
  )
    .toString(16)
    .padStart(8, "0")}`;
};

export const digestWholeDocumentBlocks = (
  blocks: readonly WholeDocumentTextBlock[],
): string => {
  const serialized = blocks
    .map(({ sourceText }) => `${sourceText.length}:${sourceText}`)
    .join("|");

  return `whole-document-snapshot-v1-${hash(serialized)}`;
};

export const digestWholeDocumentPage = (
  page: WholeDocumentPage,
): string => digestWholeDocumentBlocks(page.blocks);
