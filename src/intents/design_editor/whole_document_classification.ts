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
  "malzeme",
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

// ---------------------------------------------------------------------
// Development-only template-candidate diagnostics.
//
// This exists to answer one narrow question against the real Canva
// runtime: "which deterministic-template *kind* does each observed
// fingerprint actually correspond to?" -- so a human can compare it
// against JsonDeterministicTemplateRegistry.listTemplateSummaries() and
// decide how to regenerate the private registry. It is diagnostic
// metadata only.
//
// Safety: the "kind" guessed here is a coarse, best-effort heuristic
// computed purely from already-classified template_candidate pages. It
// is NEVER wired into the deterministic-template bypass decision, which
// remains solely an exact fingerprint match against the registry
// (backend/src/translation/deterministic_templates/registry.ts). Nothing
// in this module sends a client-provided "kind" anywhere the backend
// would trust it.
//
// What is returned is intentionally the smallest safe shape: a 1-based
// page number, the guessed kind, the canonical fingerprint, and a block
// count. Source text, translations, and registry contents are never
// included.
export type TemplateCandidateDiagnosticKind =
  | "front_cover"
  | "materials_reference"
  | "closing"
  | "unknown";

export type TemplateCandidateDiagnostic = {
  pageNumber: number;
  kind: TemplateCandidateDiagnosticKind;
  fingerprint: string;
  textBlockCount: number;
};

// "malzeme" (materials, singular stem) rather than just "malzemeler"
// (plural): real Turkish template pages have been observed titled
// "Malzeme Listesi" / "Gerekli Malzeme" (singular), which the plural-only
// form missed -- causing a real materials_reference page with a
// generic footer (containing e.g. "etsy"/"copyright") to fall through
// to the closing-hint check below and be mis-guessed as "closing". The
// stem match is a strict superset of the old plural-only match (any text
// containing "malzemeler" also contains "malzeme"), so this only adds
// coverage. This heuristic remains diagnostic-only -- see the module
// comment above.
const MATERIALS_REFERENCE_HINTS = [
  "malzeme",
  "kısaltmalar",
  "terimler",
  "abbreviations",
  "materials",
  "terminology",
];

const CROCHET_GLOSSARY_HINTS = [
  "zn:",
  "sh:",
  "x:",
  "v:",
  "hdc:",
  "dc:",
  "flo:",
  "blo:",
];

const CLOSING_HINTS = ["instagram", "etsy", "copyright"];

const normalizedPageText = (
  blocks: readonly WholeDocumentTextBlock[],
): string =>
  blocks
    .map(({ sourceText }) =>
      normalizeFingerprintText(sourceText).toLocaleLowerCase("tr"),
    )
    .join(" ");

// Purely diagnostic best-guess, in the same priority order as
// looksLikeTemplatePage/classifyWholeDocumentPage below: a first-page
// front cover, then a materials/abbreviations reference page, then a
// closing/social page, else "unknown" (still a real template_candidate,
// just not one this heuristic can characterize further).
export const guessTemplateCandidateKind = (
  page: WholeDocumentPage,
): TemplateCandidateDiagnosticKind => {
  if (page.discoveryIndex === 0) return "front_cover";

  const normalized = normalizedPageText(page.blocks);

  const glossaryHintCount = CROCHET_GLOSSARY_HINTS.filter((hint) =>
    normalized.includes(hint),
  ).length;

  if (
    MATERIALS_REFERENCE_HINTS.some((hint) => normalized.includes(hint)) ||
    glossaryHintCount >= 3
  ) {
    return "materials_reference";
  }

  if (CLOSING_HINTS.some((hint) => normalized.includes(hint))) {
    return "closing";
  }

  return "unknown";
};

// Development-safe diagnostic rows for every page classified as a
// template_candidate during bulk planning (buildWholeDocumentPlan /
// "Check remaining pages"). See the module comment above for the safety
// contract.
export const diagnoseTemplateCandidates = (
  pages: readonly WholeDocumentPage[],
): TemplateCandidateDiagnostic[] =>
  pages
    .filter(
      (page) => classifyWholeDocumentPage(page).classification === "template_candidate",
    )
    .map((page) => ({
      pageNumber: page.discoveryIndex + 1,
      kind: guessTemplateCandidateKind(page),
      fingerprint: pageContentFingerprint(page.blocks),
      textBlockCount: page.blocks.length,
    }));

// Formats diagnoseTemplateCandidates rows as the human-readable table
// used when comparing against listTemplateSummaries() output, e.g.:
//   Page 1 | front_cover         | page-content-v1-... | blocks: 3
export const formatTemplateCandidateDiagnostics = (
  diagnostics: readonly TemplateCandidateDiagnostic[],
): string =>
  diagnostics
    .map(
      ({ pageNumber, kind, fingerprint, textBlockCount }) =>
        `Page ${pageNumber} | ${kind.padEnd(20)} | ${fingerprint} | blocks: ${textBlockCount}`,
    )
    .join("\n");

// ---------------------------------------------------------------------
// Development-only source-snapshot capture (Task A: registry
// regeneration).
//
// Unlike diagnoseTemplateCandidates above (safe metadata only), this
// DOES include source text -- it is the deliberately separate, more
// sensitive capture step that produces the input a human uses to write
// approved EN/ES translations, and ultimately feeds
// backend/src/translation/deterministic_templates/generate_template.ts.
// Because of that:
//   - it is a plain exported function, never wired into automatic
//     console logging (diagnoseTemplateCandidates already fills that
//     role for the safe case);
//   - callers must invoke it explicitly and are responsible for keeping
//     the resulting snapshot out of any log/telemetry path;
//   - the registry itself never stores this snapshot's source text --
//     only a per-block hash of it (see generation.ts's
//     hashSourceBlockText), computed once this snapshot reaches the
//     backend CLI.
//
// The `kind` on each row is still only the diagnostic heuristic guess
// (guessTemplateCandidateKind) -- a human must confirm or correct it
// before it is handed to the generation CLI. Nothing downstream trusts
// this value as authoritative; the deterministic bypass itself is keyed
// solely by exact fingerprint.
export type TemplateSourceFormattingRegionSnapshot = {
  index: number;
  length: number;
  text: string;
};

export type TemplateSourceBlockSnapshot = {
  id: string;
  order: number;
  sourceText: string;
  formattingRegions: TemplateSourceFormattingRegionSnapshot[];
};

export type TemplateCandidateSourceSnapshot = {
  fingerprint: string;
  pageNumber: number;
  kind: TemplateCandidateDiagnosticKind;
  blocks: TemplateSourceBlockSnapshot[];
};

export const captureTemplateCandidateSnapshot = (
  pages: readonly WholeDocumentPage[],
): TemplateCandidateSourceSnapshot[] =>
  pages
    .filter(
      (page) => classifyWholeDocumentPage(page).classification === "template_candidate",
    )
    .map((page) => ({
      fingerprint: pageContentFingerprint(page.blocks),
      pageNumber: page.discoveryIndex + 1,
      kind: guessTemplateCandidateKind(page),
      blocks: page.blocks.map((block) => ({
        id: block.id,
        order: block.order,
        sourceText: block.sourceText,
        formattingRegions: block.formattingRegions.map(
          ({ index, length, text }) => ({
            index,
            length,
            text,
          }),
        ),
      })),
    }));

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
