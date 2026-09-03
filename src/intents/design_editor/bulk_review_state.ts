import type { ReviewBlock } from "./translation_review";

export type PersistedBulkPageStatus = "ready" | "needs_review" | "blocked";

// Bumped whenever a change to translation behavior (not just review UI)
// means a previously persisted bulk review can no longer be trusted as
// "what today's pipeline would produce" -- restoreBulkReviewQueue
// (whole_document_queue.ts) only restores a cached review when its
// pipelineRevision matches this exact string, so bumping it forces every
// page to be re-translated by the current logic instead of silently
// reusing a stale cached result (including a stale review that was
// itself produced by a real LLM call before a page became eligible for
// the static/deterministic bypass -- see static_template_translation.ts).
// v5: fixed the Page 1/2/9 static-template bypass to match reliably
// (see static_template_translation.ts's normalizeForStaticMatch).
export const TRANSLATION_PIPELINE_REVISION = "translation-pipeline-v6";

export type PersistedBulkPageReview = {
  pageId: string;
  fingerprint: string;

  pipelineRevision?: string;
  status: PersistedBulkPageStatus;
  // Explicit human sign-off on a "needs_review" page's warnings. Never
  // implied by status alone, and must be re-earned after any edit to the
  // review's blocks (see bulk_review_persistence.saveBulkReview callers).
  //
  // This is distinct from, and always checked before, the warning-family
  // preference mechanism below: acknowledged === true always counts as
  // acknowledged regardless of preferences.
  acknowledged?: boolean;
  blocks: ReviewBlock[];
};

export const bulkPageIdentity = (pageId: string): string => `page:${pageId}`;

export const isBulkReviewFresh = (
  review: PersistedBulkPageReview,
  currentFingerprint: string,
): boolean =>
  review.fingerprint === currentFingerprint &&
  review.pipelineRevision === TRANSLATION_PIPELINE_REVISION;

// Warning-family "always accept this warning type" preferences.
//
// This is a product UX improvement on top of acknowledgement, not a
// second acknowledgement mechanism: a warning code becomes eligible here
// only when it is a routine, low-risk "needs_review" warning whose
// meaning does not depend on the specific translated text. Mirrors the
// backend allowlist in
// backend/src/canva/warning_preferences/store.ts -- keep both in sync.
//
// MANUAL_REVIEW_RECOMMENDED is the existing warning code for generic
// spatial/directional concept-combination reviews (e.g. "iç" + "sıra",
// "iç" + "dış" -- see findHighRiskInstructionConcepts in
// backend/src/translation/validator.ts). It is reused rather than adding
// a parallel code.
//
// Deliberately excluded:
//   - SUSPICIOUSLY_SHORT_TRANSLATION, UNUSUALLY_LARGE_EXPANSION,
//     POSSIBLE_GLOSSARY_MISMATCH, TARGET_LANGUAGE_FLUENCY_REVIEW: each
//     depends on the specific translated text produced for that block,
//     not on a routine, content-independent concept combination.
//   - SEMANTIC_ANCHOR_MISSING: critical placement-loss (front/above/
//     below and similar). It is also a hard ValidationCode escalated by
//     criticalPlacement in semantic_anchors.ts -- never eligible, even
//     in its soft warning form.
//   - Any code that can appear via INTEGRITY_BLOCK_CODES
//     (review_severity.ts): those are hard blockers by construction and
//     cannot be preference-whitelisted by this feature under any
//     circumstance.
export const AUTO_ACKNOWLEDGEABLE_WARNING_CODES: ReadonlySet<string> =
  new Set(["MANUAL_REVIEW_RECOMMENDED"]);

export const isWarningCodeEligibleForAutoAcknowledge = (
  code: string,
): boolean => AUTO_ACKNOWLEDGEABLE_WARNING_CODES.has(code);

// All warning codes present anywhere on the page (across every block).
// Used both to decide Apply eligibility and to know which warnings are
// candidates for the "Always accept this warning type" action.
export const reviewWarningCodes = (
  review: Pick<PersistedBulkPageReview, "blocks">,
): Set<string> => {
  const codes = new Set<string>();
  for (const block of review.blocks) {
    for (const warning of block.warnings) {
      codes.add(warning.code);
    }
  }
  return codes;
};

// The single source of truth for "does this review count as acknowledged
// for Apply eligibility," shared by bulk_apply.ts's preflight (the
// authoritative safety gate) and app.tsx's UI eligibility list, so the
// two can never drift.
//
// - Explicit page-level acknowledgement always wins, exactly as before
//   this feature existed.
// - Otherwise, the review counts as effectively acknowledged only if
//   *every* block is free of errors and *every* warning on the page has
//   a code that is both eligible for auto-acknowledge and present in the
//   caller's approved set. A single warning outside that set (including
//   one that simply isn't eligible at all) keeps the page needs_review --
//   approving one warning family never acknowledges the whole page.
// - This function is pure and re-derives its answer from the review's
//   *current* warnings every time it is called. Nothing is cached, so an
//   edited review (which resets acknowledged to false) is automatically
//   re-evaluated against its current warnings rather than reusing a
//   stale answer.
export const isEffectivelyAcknowledged = (
  review: Pick<PersistedBulkPageReview, "acknowledged" | "blocks">,
  autoAcknowledgedWarningCodes: ReadonlySet<string>,
): boolean => {
  if (review.acknowledged === true) return true;
  if (autoAcknowledgedWarningCodes.size === 0) return false;

  return review.blocks.every((block) => {
    if (block.errors.length > 0) return false;

    return block.warnings.every(
      (warning) =>
        isWarningCodeEligibleForAutoAcknowledge(warning.code) &&
        autoAcknowledgedWarningCodes.has(warning.code),
    );
  });
};
