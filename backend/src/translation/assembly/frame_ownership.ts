/**
 * Frame / normalizer ownership probe (Stage 1, Task 7: SHADOW ONLY,
 * measurement only).
 *
 * In production the legacy normalizer (`normalizeSourceNaturalLanguageDetailed`)
 * runs on each segment BEFORE notation protection and the provider, and it
 * often rewrites clauses that the frame parser also recognizes. Before any
 * frame can be taken out of legacy ownership, we need to know whether that
 * changes what the normalizer produces.
 *
 * For each render unit this module asks: if exactly this unit's source span
 * were hidden behind a reserved placeholder before normalization, would the
 * legacy path behave the same?
 *
 *  - SEPARABLE: the normalized text, after restoring the unit's canonical
 *    meaning into the placeholder and rendering notation the same way on both
 *    sides, is identical ignoring letter case only, AND `fullyResolved` is
 *    identical.
 *  - ENTANGLED otherwise, with reasons:
 *      normalized-text-differs   the comparable texts differ (including when
 *                                the normalizer consumed or altered the
 *                                placeholder);
 *      resolution-lost           the legacy path is fully resolved and the
 *                                probe is not (provider exposure would grow);
 *      resolution-gained         the probe is fully resolved and the legacy
 *                                path is not.
 *
 * "Separable" is a migration-eligibility signal only. Nothing here routes,
 * translates or changes production behavior, and no production module imports
 * it.
 *
 * Translator-equivalent preprocessing, reused from production (no copied
 * rules): `segmentTranslationBlock`, then `extractLeadingInstruction` on the
 * segment, then the normalizer on the body with the whole block as source
 * context and the body's block offset. Modeling limits: the pattern content
 * kind only, `fullyResolved` only (the translator's separate atomic-span
 * bypass is not probed), and blocks are taken as given (the translator's
 * formatting-unit split of blocks with formatting regions is not modeled).
 *
 * Import rules: production helpers listed below and types from the renderer;
 * no translator, prompt, provider, formatting or validator code.
 */
import { extractLeadingInstruction } from "../instruction_marker.js";
import { normalizeSourceNaturalLanguageDetailed } from "../natural_language/normalizer.js";
import {
  containsReservedPlaceholder,
  protectImmutablePattern,
  reservedPlaceholder,
  reservedPlaceholdersIn,
  restoreImmutablePattern,
} from "../notation/immutable.js";
import type { RenderUnit } from "../renderer/frame_renderer.js";
import { segmentTranslationBlock } from "../segmentation.js";
import type { TargetLanguage } from "../types.js";

export type FrameOwnershipReason =
  | "normalized-text-differs"
  | "resolution-lost"
  | "resolution-gained";

export type FrameOwnershipResult = {
  readonly unit: RenderUnit;
  /** Index of the `segmentTranslationBlock` segment that contains the unit. */
  readonly segmentIndex: number;
  readonly ownership: "separable" | "entangled";
  /** Empty exactly when the unit is separable. */
  readonly reasons: readonly FrameOwnershipReason[];
};

export class FrameOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameOwnershipError";
  }
}

/** Notation rendered the way restoration renders it, so both sides compare alike. */
const renderNotation = (text: string, targetLanguage: TargetLanguage): string => {
  const protectedText = protectImmutablePattern(text);
  return restoreImmutablePattern(protectedText.text, protectedText, targetLanguage).text;
};

const normalizeBody = (
  body: string,
  targetLanguage: TargetLanguage,
  context: string,
  bodyStart: number,
) => normalizeSourceNaturalLanguageDetailed(body, targetLanguage, "pattern", context, bodyStart);

/**
 * Classifies each render unit independently, in the given order. Only the one
 * unit's span is replaced per probe. Throws `FrameOwnershipError` when a safe
 * probe is impossible: the block already contains reserved placeholder syntax,
 * a unit's raw text is not its block slice, or a unit does not lie wholly
 * inside one segment body (after the leading instruction marker).
 */
export const classifyFrameOwnership = (
  block: string,
  units: readonly RenderUnit[],
  targetLanguage: TargetLanguage,
): FrameOwnershipResult[] => {
  if (units.length === 0) return [];
  if (containsReservedPlaceholder(block)) {
    throw new FrameOwnershipError(
      "The block already contains reserved placeholder syntax; the ownership probe would be ambiguous.",
    );
  }
  const segments = segmentTranslationBlock(block);
  const placeholder = reservedPlaceholder(0);

  return units.map((unit, index) => {
    const { start, end, raw } = unit.sourceSpan;
    if (start < 0 || end <= start || end > block.length || block.slice(start, end) !== raw) {
      throw new FrameOwnershipError(`Render unit ${index} is not an exact slice of the block.`);
    }
    const segment = segments.find((candidate) => candidate.start <= start && end <= candidate.end);
    if (segment === undefined) {
      throw new FrameOwnershipError(`Render unit ${index} (${start}..${end}) does not lie inside one segment.`);
    }
    const instruction = extractLeadingInstruction(segment.text);
    const body = instruction?.body ?? segment.text;
    const bodyStart = segment.start + (segment.text.length - body.length);
    if (start < bodyStart) {
      throw new FrameOwnershipError(
        `Render unit ${index} (${start}..${end}) overlaps the segment's leading instruction marker.`,
      );
    }

    const legacy = normalizeBody(body, targetLanguage, block, bodyStart);

    const probeBody = body.slice(0, start - bodyStart) + placeholder + body.slice(end - bodyStart);
    const probeContext = block.slice(0, start) + placeholder + block.slice(end);
    const probe = normalizeBody(probeBody, targetLanguage, probeContext, bodyStart);

    const reasons: FrameOwnershipReason[] = [];
    const placeholderKept = reservedPlaceholdersIn(probe.text).join("\n") === placeholder;
    const comparableProbe = placeholderKept ? probe.text.replace(placeholder, unit.text) : undefined;
    if (
      comparableProbe === undefined ||
      renderNotation(comparableProbe, targetLanguage).toLowerCase() !==
        renderNotation(legacy.text, targetLanguage).toLowerCase()
    ) {
      reasons.push("normalized-text-differs");
    }
    if (legacy.fullyResolved && !probe.fullyResolved) reasons.push("resolution-lost");
    if (!legacy.fullyResolved && probe.fullyResolved) reasons.push("resolution-gained");

    return {
      unit,
      segmentIndex: segment.index,
      ownership: reasons.length === 0 ? "separable" : "entangled",
      reasons,
    };
  });
};
