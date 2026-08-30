import type {
  WholeDocumentPage,
  WholeDocumentTextBlock,
} from "./whole_document_inventory";

export type WholeDocumentPageClassification =
  | "empty"
  | "content"
  | "template_candidate";

export type ClassifiedWholeDocumentPage = {
  pageId: string;
  fingerprint: string;
  classification: WholeDocumentPageClassification;
  textBlockCount: number;
};

const normalizeFingerprintText = (text: string): string =>
  text.normalize("NFKC").replace(/\s+/gu, " ").trim();

const hash = (value: string): string => {
  let first = 2166136261;
  let second = 2246822519;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489917);
  }

  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
};

export const pageContentFingerprint = (
  blocks: readonly WholeDocumentTextBlock[],
): string => {
  const serialized = blocks
    .map(({ sourceText }) => normalizeFingerprintText(sourceText))
    .filter(Boolean)
    .join("\n");

  return `page-content-v1-${hash(serialized)}`;
};

const STATIC_TEXT_HINTS = [
  "malzemeler",
  "kısaltmalar",
  "terimler",
  "abbreviations",
  "materials",
  "terminology",
  "instagram",
  "etsy",
  "copyright",
];

const looksLikeTemplatePage = (
  blocks: readonly WholeDocumentTextBlock[],
): boolean => {
  if (blocks.length === 0) return false;

  const normalized = blocks
    .map(({ sourceText }) =>
      normalizeFingerprintText(sourceText).toLocaleLowerCase("tr"),
    )
    .join(" ");

  return STATIC_TEXT_HINTS.some((hint) => normalized.includes(hint));
};

export const classifyWholeDocumentPage = (
  page: WholeDocumentPage,
): ClassifiedWholeDocumentPage => {
  const fingerprint = pageContentFingerprint(page.blocks);

  if (page.blocks.length === 0) {
    return {
      pageId: page.pageId,
      fingerprint,
      classification: "empty",
      textBlockCount: 0,
    };
  }

  return {
    pageId: page.pageId,
    fingerprint,
    classification:
      page.discoveryIndex === 0 || looksLikeTemplatePage(page.blocks)
        ? "template_candidate"
        : "content",
    textBlockCount: page.blocks.length,
  };
};
