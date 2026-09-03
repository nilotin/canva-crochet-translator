// Development-only explicit trigger for exporting deterministic
// template-candidate source snapshots from the live Canva document.
//
// This is the missing "live entry point" for captureTemplateCandidateSnapshot()
// (whole_document_classification.ts): that function is pure and safe, but
// nothing in the running app previously called it. This module is the
// explicit, developer-invoked wiring for obtaining Page 1 / Page 2 /
// Page 9 (or whichever pages classify as template_candidate) snapshots
// so they can be fed to
// backend/src/translation/deterministic_templates/generate_template.ts
// by hand, after a human writes/approves EN/ES translations.
//
// Safety:
//   - captureTemplateCandidateSnapshotExport() throws outside development
//     (mirrors the isDevelopment convention already used by
//     source_design_context.ts and whole_document_workflow.ts), so it
//     can never run in a production build even if something were to call
//     it. There is no production UI for this at all -- see app.tsx's
//     dev-only button, which does not render outside development either.
//   - Nothing in this module is reachable from Check/Translate/Apply --
//     whole_document_workflow.ts (which those flows use) does not import
//     it, and it is invoked only by the dev-only button's onClick.
//   - It reuses readWholeDocumentInventory() and
//     captureTemplateCandidateSnapshot() rather than re-reading pages or
//     recomputing fingerprints -- there is exactly one page-reading
//     implementation and one fingerprint implementation in this app, and
//     this module does not duplicate either.
//   - It never logs source text, never calls the backend, and never
//     writes to `.data` itself. It only returns/serializes a JSON
//     payload; a human copies that payload and runs the CLI by hand.
import {
  readWholeDocumentInventory,
  type WholeDocumentInventory,
} from "./whole_document_inventory";
import {
  captureTemplateCandidateSnapshot,
  type TemplateCandidateSourceSnapshot,
  type TemplateSourceBlockSnapshot,
} from "./whole_document_classification";

// Exactly the fields generate:deterministic-template's --snapshot input
// needs (see backend/src/translation/deterministic_templates/generation.ts's
// TemplateSourceSnapshot), plus sourceBlockCount as a human-readable
// cross-check. Nothing else -- no registry contents, no translations.
export type TemplateCandidateSnapshotExportRow = {
  pageNumber: number;
  kind: TemplateCandidateSourceSnapshot["kind"];
  fingerprint: string;
  sourceBlockCount: number;
  blocks: TemplateSourceBlockSnapshot[];
};

// Pure mapping step, split out from the capture trigger below so it can
// be tested without readWholeDocumentInventory or a Canva runtime at
// all. Re-sorts by `order` defensively (captureTemplateCandidateSnapshot
// already preserves page order, but this is the boundary the CLI's
// input contract depends on, so it is asserted here too rather than
// trusted implicitly).
export const buildTemplateCandidateSnapshotExport = (
  snapshots: readonly TemplateCandidateSourceSnapshot[],
): TemplateCandidateSnapshotExportRow[] =>
  snapshots.map((snapshot) => ({
    pageNumber: snapshot.pageNumber,
    kind: snapshot.kind,
    fingerprint: snapshot.fingerprint,
    sourceBlockCount: snapshot.blocks.length,
    blocks: [...snapshot.blocks].sort((left, right) => left.order - right.order),
  }));

export class TemplateSnapshotExportUnavailableError extends Error {
  constructor() {
    super(
      "captureTemplateCandidateSnapshotExport is a development-only tool " +
        "and is not available in a production build.",
    );
    this.name = "TemplateSnapshotExportUnavailableError";
  }
}

type CaptureDependencies = {
  readInventory: () => Promise<WholeDocumentInventory>;
  isDevelopment: boolean;
};

// The explicit, developer-invoked trigger. Nothing in Check/Translate/
// Apply calls this -- it must be invoked deliberately, either via the
// dev-only button in app.tsx or by hand from a development console.
export const captureTemplateCandidateSnapshotExport = async (
  overrides: Partial<CaptureDependencies> = {},
): Promise<TemplateCandidateSnapshotExportRow[]> => {
  const isDevelopment =
    overrides.isDevelopment ?? process.env.NODE_ENV !== "production";

  if (!isDevelopment) {
    throw new TemplateSnapshotExportUnavailableError();
  }

  const readInventory = overrides.readInventory ?? readWholeDocumentInventory;

  const inventory = await readInventory();
  const snapshots = captureTemplateCandidateSnapshot(inventory.pages);

  return buildTemplateCandidateSnapshotExport(snapshots);
};

// Convenience serializer for a dev-only button/console trigger to feed
// straight into a clipboard-copy or file-download call. Kept separate
// from captureTemplateCandidateSnapshotExport so tests can assert on the
// structured rows without also parsing JSON, and so a caller who already
// has rows (e.g. re-serializing after a manual edit) does not need to
// re-run the capture.
export const serializeTemplateCandidateSnapshotExport = (
  rows: readonly TemplateCandidateSnapshotExportRow[],
): string => JSON.stringify(rows, null, 2);
