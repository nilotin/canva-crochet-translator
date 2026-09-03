// Builds TranslationResult objects for a deterministic-template registry
// hit (an exact fingerprint match -- see
// deterministic_templates/registry.ts and app.ts's
// /api/canva/translate route). This module never calls a
// TranslationProvider/LLM: it only assembles a result from a
// human-approved, statically registered translation string.
//
// Structural consistency with the normal (provider-driven) path in
// translator.ts is the point: same TranslationResult shape (id, source,
// translated, valid, errors, warnings, targetFormattingRegions), so the
// frontend review pipeline treats a deterministic hit exactly like any
// other translated block.
import { projectDeterministicFormattingRegions } from "./formatting_projection.js";
import type {
  TargetFormattingRegion,
  TargetLanguage,
  TranslationBlock,
  TranslationResult,
} from "./types.js";

// projectDeterministicFormattingRegions computes target ranges purely
// from the SOURCE block's own notation/pattern structure (see
// formatting_projection.ts) -- it has no knowledge of the actual
// registry-approved translated string. A deterministic template's
// translated text is independently human-authored, not derived from the
// source by that same notation-substitution process, so a projected
// range that is numerically "in bounds" for the source reconstruction is
// not automatically valid for the *actual* translated string. This is
// the extra safety gate the normal pipeline doesn't need (there, the
// projection is only ever used for text produced by the same
// process/limits it was derived from).
//
// Exported for direct unit testing of the bounds contract.
export const formattingRegionsFitWithinText = (
  regions: readonly TargetFormattingRegion[],
  text: string,
): boolean =>
  regions.every(
    (region) =>
      Number.isInteger(region.start) &&
      Number.isInteger(region.end) &&
      region.start >= 0 &&
      region.end >= region.start &&
      region.end <= text.length,
  );

// Attempts to safely compute targetFormattingRegions for a deterministic
// translation. Returns undefined whenever safety cannot be established --
// never a fabricated or malformed range.
//
// Leaving targetFormattingRegions undefined on a block that still has
// source formattingRegions is not a silent loss of safety: the existing
// frontend contract (translation_review.ts's requiresFormattingProjection
// + FORMATTING_MAPPING_REQUIRED, a hard blocker in review_severity.ts's
// INTEGRITY_BLOCK_CODES) already treats that combination as an explicit,
// tested "needs review / blocked" case. Reusing that existing contract
// instead of inventing a second blocking mechanism here is deliberate:
// it is the "equivalent safe failure" this feature is required to
// produce when projection cannot be trusted.
// NOTE: this deliberately does not accept a hand-supplied/registry
// "approved" set of target formatting ranges. An earlier attempt added
// that (an optional approvedFormattingRegions parameter here, plus
// matching registry/generation support) so a human could pin exact
// target character offsets per template record. It was removed: it is
// exactly the "random source character offsets applied to a
// differently-sized translated string" failure mode this feature exists
// to avoid, it had no test coverage, and computed projection below is
// already safe on its own -- it blocks (returns undefined) rather than
// guessing whenever it cannot prove the ranges fit the actual translated
// text.
const safeDeterministicFormattingRegions = (
  block: Pick<TranslationBlock, "id" | "text" | "formattingRegions">,
  translatedText: string,
  targetLanguage: TargetLanguage,
): TargetFormattingRegion[] | undefined => {
  if (!block.formattingRegions?.length) return undefined;

  const projected = projectDeterministicFormattingRegions(
    block as TranslationBlock,
    targetLanguage,
  );

  if (!projected) return undefined;
  if (!formattingRegionsFitWithinText(projected, translatedText)) return undefined;

  return projected;
};

// Assembles one TranslationResult for a deterministic-template hit.
//
// The translated text itself is trusted as-is: it is a statically
// registered, human-approved string (see deterministic_templates/
// generation.ts), not model output, so it is not re-run through the
// LLM-output validator (which exists to catch *translation* mistakes,
// not to second-guess an already-approved static string). valid is
// therefore always true and errors/warnings are always empty here --
// the only thing this helper adds beyond the raw translated string is
// safe formatting projection.
export const buildDeterministicTranslationResult = (
  block: Pick<TranslationBlock, "id" | "text" | "formattingRegions">,
  translatedText: string,
  targetLanguage: TargetLanguage,
): TranslationResult => {
  const targetFormattingRegions = safeDeterministicFormattingRegions(
    block,
    translatedText,
    targetLanguage,
  );

  return {
    id: block.id,
    source: block.text,
    translated: translatedText,
    valid: true,
    errors: [],
    warnings: [],
    ...(targetFormattingRegions ? { targetFormattingRegions } : {}),
  };
};
