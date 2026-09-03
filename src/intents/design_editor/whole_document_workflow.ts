import { loadPersistedPageStateSummaries } from "./persisted_page_state";
import { readWholeDocumentInventory } from "./whole_document_inventory";
import {
  buildWholeDocumentPlan,
  type WholeDocumentPlan,
} from "./whole_document_plan";
import {
  diagnoseTemplateCandidates,
  formatTemplateCandidateDiagnostics,
  type TemplateCandidateDiagnostic,
} from "./whole_document_classification";

type Dependencies = {
  readInventory: typeof readWholeDocumentInventory;
  loadSummaries: typeof loadPersistedPageStateSummaries;
  // Development-only template-candidate diagnostics (see
  // whole_document_classification.ts's diagnoseTemplateCandidates for the
  // safety contract: diagnostic metadata only, never used to trust a
  // client-provided template kind). Mirrors the isDevelopment/logger
  // pattern already used by source_design_context.ts.
  isDevelopment: boolean;
  logger: Pick<Console, "debug">;
};

export type WholeDocumentWorkflowResult = {
  plan: WholeDocumentPlan;
  skippedCanvaPages: number;
  // Count of persisted "applied" page states whose identity could not be
  // reconciled against this document's absolute Canva page IDs (see
  // absolutePageIdFromIdentity below). These pages are correctly excluded
  // from appliedPageIds -- and will therefore still show up as eligible in
  // the remaining-pages plan -- but that exclusion happens silently unless
  // a caller reads this count. Surfacing it here keeps the limitation
  // explicit and testable instead of an invisible drop.
  unreconciledAppliedPageIdentities: number;
  // Populated only when isDevelopment is true (see Dependencies above).
  // Development-safe: page number, guessed template kind, canonical
  // fingerprint, and block count for every template_candidate page --
  // never source text, translations, or registry contents. Also logged
  // via logger.debug in the same form so it can be inspected without
  // reading this field explicitly.
  templateCandidateDiagnostics?: TemplateCandidateDiagnostic[];
};

// `getCurrentPageIdentity` (page_identity.ts) persists a page's applied
// review under a "page:<id>" identity only when Canva's page metadata is
// both `type: "absolute"` AND carries a populated `id`. Per the Canva
// SDK's own typing, `AbsolutePageMetadata.id` is optional -- a page can be
// genuinely absolute (and therefore appear in this document's whole-page
// inventory under a real pageId) while `getCurrentPageMetadata()` still
// omits `id` for it. When that happens, the applied review is persisted
// under a content-derived "fingerprint:<hash>" identity instead.
//
// That fingerprint uses a different hash (and a different input: page
// metadata + visible text) than anything in the whole-document inventory,
// so there is no way to safely map it back to one specific absolute page
// ID -- content can also change after the page was applied, so even an
// exact text match would not be trustworthy. Guessing here risks the
// worse failure mode (silently reconciling to the *wrong* page), so this
// function deliberately never attempts it: a "fingerprint:"-identified
// applied page is left out of appliedPageIds and will be treated as still
// needing review, exactly like a page that was never reviewed.
const absolutePageIdFromIdentity = (
  pageIdentity: string,
): string | undefined => {
  if (!pageIdentity.startsWith("page:")) return undefined;

  const pageId = pageIdentity.slice("page:".length);
  return pageId || undefined;
};

export const buildRemainingPagesWorkflow = async (
  excludedPageIds: ReadonlySet<string> = new Set(),
  overrides: Partial<Dependencies> = {},
): Promise<WholeDocumentWorkflowResult> => {
  const readInventory = overrides.readInventory ?? readWholeDocumentInventory;

  const loadSummaries =
    overrides.loadSummaries ?? loadPersistedPageStateSummaries;

  const isDevelopment =
    overrides.isDevelopment ?? process.env.NODE_ENV !== "production";

  const logger = overrides.logger ?? console;

  const [inventory, summaries] = await Promise.all([
    readInventory(),
    loadSummaries(),
  ]);

  const appliedPageIds = new Set<string>();
  let unreconciledAppliedPageIdentities = 0;

  for (const summary of summaries) {
    if (summary.status !== "applied") continue;

    const pageId = absolutePageIdFromIdentity(summary.pageIdentity);
    if (pageId) {
      appliedPageIds.add(pageId);
    } else {
      unreconciledAppliedPageIdentities += 1;
    }
  }

  // Development-only, safe-metadata-only diagnostic: for every page this
  // run classified as a template_candidate, record its page number,
  // best-guess kind, canonical fingerprint, and block count. This never
  // influences the plan or the deterministic-template bypass decision --
  // it exists purely so a human can compare these fingerprints against
  // JsonDeterministicTemplateRegistry.listTemplateSummaries() and decide
  // how to regenerate the private registry (a separate, explicit step).
  let templateCandidateDiagnostics: TemplateCandidateDiagnostic[] | undefined;

  if (isDevelopment) {
    templateCandidateDiagnostics = diagnoseTemplateCandidates(inventory.pages);

    if (templateCandidateDiagnostics.length > 0) {
      logger.debug(
        "Template-candidate diagnostics (development only; compare against " +
          "listTemplateSummaries() before regenerating the registry):\n" +
          formatTemplateCandidateDiagnostics(templateCandidateDiagnostics),
      );
    }
  }

  return {
    plan: buildWholeDocumentPlan(inventory.pages, {
      appliedPageIds,
      excludedPageIds,
    }),
    skippedCanvaPages: inventory.skippedPages.length,
    unreconciledAppliedPageIdentities,
    ...(templateCandidateDiagnostics === undefined
      ? {}
      : { templateCandidateDiagnostics }),
  };
};
