/**
 * Frame placeholder protection and restoration (Stage 1, Task 5: SHADOW ONLY).
 *
 * The provider must eventually see only Opaque/free prose, but every block
 * that contains a frame is still mostly prose. So rendered frames are hidden
 * behind reserved placeholders inside the text sent to the provider, and put
 * back afterwards:
 *
 *   protectFrames(parse, units)   source -> carrier text + frame tokens
 *   (provider translates the carrier; NOT done here)
 *   restoreFrames(output, frames) output -> restored text + provenance pieces
 *
 * When the carrier also holds another layer's placeholders (immutable
 * protection runs on the frame carrier with `startIndex = tokens.length`),
 * `carrierPlaceholderErrors` checks the output against the union of all
 * carrier placeholders, and `substituteFramesAfterIntegrity` replaces only the
 * frame placeholders, leaving the rest for the unchanged
 * `restoreImmutablePattern`. `restoreFrames` stays strict (frames only).
 *
 * No provider is called and no production module imports this yet.
 *
 * Reuse, not a second grammar:
 *  - placeholders are the canonical `reservedPlaceholder(index)` of the
 *    immutable-protection layer, numbered from `startIndex` so both layers can
 *    share one carrier with disjoint ids;
 *  - restoration integrity is the canonical `placeholderIntegrityErrors`
 *    (MISSING, DUPLICATE, UNEXPECTED, MUTATED, REORDERED) with its exact codes,
 *    messages and ordering;
 *  - provenance pieces have the existing projection piece shape
 *    (`sourceStart/sourceEnd/targetStart/targetEnd`).
 *
 * Each token carries its canonical meaning (`unit.text`) as data only, for a
 * later prompt integration. Casing, punctuation and sentence joins are not
 * handled here.
 *
 * Import rules: `../notation/immutable.js` (placeholder helpers), and types
 * only from the parser IR, the renderer, `../notation/types.js` and
 * `../mixed_segment.js`. No translator, prompt, provider, formatting or
 * validator code.
 */
import {
  containsReservedPlaceholder,
  placeholderIntegrityErrors,
  reservedPlaceholder,
  reservedPlaceholdersIn,
} from "../notation/immutable.js";
import type { PlaceholderIntegrityDiagnostic } from "../notation/types.js";
import type { MixedSegmentProjectionPiece } from "../mixed_segment.js";
import type { FrameParse } from "../parser/frame_ir.js";
import type { RenderUnit } from "../renderer/frame_renderer.js";

export type FrameToken = {
  readonly placeholder: string;
  readonly unit: RenderUnit;
  /** Canonical rendered text the placeholder stands for (`unit.text`). */
  readonly meaning: string;
};

export type ProtectedFrames = {
  /** The original source (`parse.source`). */
  readonly source: string;
  /** The carrier: source with every unit span replaced by its placeholder. */
  readonly text: string;
  /** One token per render unit, in source order. */
  readonly tokens: readonly FrameToken[];
};

/** The existing projection piece shape, without the mixed-token kind. */
export type FramePiece = Pick<
  MixedSegmentProjectionPiece,
  "sourceStart" | "sourceEnd" | "targetStart" | "targetEnd"
>;

export type RestoredFrames = {
  readonly text: string;
  readonly valid: boolean;
  readonly errors: readonly PlaceholderIntegrityDiagnostic[];
  /** One piece per restored unit; empty when restoration is invalid. */
  readonly pieces: readonly FramePiece[];
};

export class FrameProtectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameProtectionError";
  }
}

/**
 * Throws unless every unit covers whole frames of `parse`, exactly: its span
 * starts where a frame starts and ends where a frame ends, and everything in
 * between is either a frame or the whitespace joining a linked pair.
 */
const assertUnitCoversFrames = (parse: FrameParse, unit: RenderUnit, index: number): void => {
  const { nodes } = parse;
  const first = nodes.findIndex(
    (node) => node.kind === "frame" && node.span.start === unit.sourceSpan.start,
  );
  const last = nodes.findIndex(
    (node, nodeIndex) =>
      nodeIndex >= first && node.kind === "frame" && node.span.end === unit.sourceSpan.end,
  );
  if (first < 0 || last < 0) {
    throw new FrameProtectionError(
      `Render unit ${index} (${unit.sourceSpan.start}..${unit.sourceSpan.end}) does not cover whole parsed frames.`,
    );
  }
  for (const node of nodes.slice(first, last + 1)) {
    if (node.kind === "opaque" && node.span.raw.trim() !== "") {
      throw new FrameProtectionError(
        `Render unit ${index} (${unit.sourceSpan.start}..${unit.sourceSpan.end}) covers Opaque text.`,
      );
    }
  }
};

const validateUnits = (parse: FrameParse, units: readonly RenderUnit[], startIndex: number): void => {
  const { source } = parse;
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
    throw new FrameProtectionError(`startIndex must be a non-negative integer, got ${startIndex}.`);
  }
  if (units.length > 0 && containsReservedPlaceholder(source)) {
    throw new FrameProtectionError(
      "The source already contains reserved placeholder syntax; frame placeholders would be ambiguous.",
    );
  }
  let cursor = 0;
  for (const [index, unit] of units.entries()) {
    const { start, end, raw } = unit.sourceSpan;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > source.length) {
      throw new FrameProtectionError(`Render unit ${index} has an invalid span ${start}..${end}.`);
    }
    if (source.slice(start, end) !== raw) {
      throw new FrameProtectionError(`Render unit ${index} raw text is not the source slice ${start}..${end}.`);
    }
    if (start < cursor) {
      throw new FrameProtectionError(`Render unit ${index} is out of order or overlaps the previous unit.`);
    }
    assertUnitCoversFrames(parse, unit, index);
    cursor = end;
  }
};

/**
 * Replaces each render unit's exact source span with one reserved
 * placeholder, numbered from `startIndex` in source order. All other text is
 * kept code unit for code unit. Malformed units throw `FrameProtectionError`;
 * nothing is repaired.
 */
export const protectFrames = (
  parse: FrameParse,
  units: readonly RenderUnit[],
  startIndex = 0,
): ProtectedFrames => {
  validateUnits(parse, units, startIndex);
  const { source } = parse;
  const tokens: FrameToken[] = units.map((unit, index) => ({
    placeholder: reservedPlaceholder(startIndex + index),
    unit,
    meaning: unit.text,
  }));
  let text = "";
  let cursor = 0;
  for (const token of tokens) {
    text += source.slice(cursor, token.unit.sourceSpan.start) + token.placeholder;
    cursor = token.unit.sourceSpan.end;
  }
  text += source.slice(cursor);
  return { source, text, tokens };
};

/**
 * Replaces each frame placeholder, in token order, with its canonical
 * meaning, and records one piece per unit. Callers have already proven
 * integrity, so each placeholder occurs exactly once and in order. Text that
 * is not a frame placeholder (provider text, other layers' placeholders) is
 * copied unchanged.
 */
const substituteFrames = (translated: string, frames: ProtectedFrames): RestoredFrames => {
  let text = "";
  let cursor = 0;
  const pieces: FramePiece[] = [];
  for (const { placeholder, unit, meaning } of frames.tokens) {
    const at = translated.indexOf(placeholder, cursor);
    text += translated.slice(cursor, at);
    pieces.push({
      sourceStart: unit.sourceSpan.start,
      sourceEnd: unit.sourceSpan.end,
      targetStart: text.length,
      targetEnd: text.length + meaning.length,
    });
    text += meaning;
    cursor = at + placeholder.length;
  }
  text += translated.slice(cursor);
  return { text, valid: true, errors: [], pieces };
};

/**
 * Checks placeholder integrity with the canonical rules, then replaces each
 * frame placeholder with its canonical meaning. On success it emits one
 * provenance piece per unit: the unit's exact source span and the UTF-16
 * range its text occupies in the restored output. Any integrity error makes
 * the result invalid, returns the output unchanged and emits no pieces.
 *
 * This checks the FRAME placeholders only: any other reserved placeholder is
 * UNEXPECTED. For a carrier that also holds another layer's placeholders, use
 * `substituteFramesAfterIntegrity`.
 */
export const restoreFrames = (
  translated: string,
  frames: ProtectedFrames,
): RestoredFrames => {
  const errors = placeholderIntegrityErrors(
    translated,
    frames.tokens.map(({ placeholder }) => placeholder),
  );
  if (errors.length > 0) return { text: translated, valid: false, errors, pieces: [] };
  return substituteFrames(translated, frames);
};

// ---------------------------------------------------------------------------
// Combined carriers (frame placeholders + another layer's placeholders)
// ---------------------------------------------------------------------------

/**
 * Integrity of provider output against EVERY reserved placeholder of the
 * carrier that was sent, whichever layer created it. The expected list is the
 * carrier's placeholders in their textual order: frame and immutable
 * placeholders interleave in the text, so their numeric or per-layer order is
 * not the order the output must reproduce.
 */
export const carrierPlaceholderErrors = (
  output: string,
  carrier: string,
): PlaceholderIntegrityDiagnostic[] =>
  placeholderIntegrityErrors(output, reservedPlaceholdersIn(carrier));

/**
 * Combined-carrier flow, frame step. First checks `output` against every
 * placeholder of `carrier` (`carrierPlaceholderErrors`); on any error the
 * result is invalid, the output is returned unchanged and nothing is
 * substituted. Otherwise only the frame placeholders are replaced by their
 * canonical meanings; every other placeholder is left for its own layer's
 * restore (for immutable content, the unchanged `restoreImmutablePattern`).
 *
 * The pieces locate each frame in THIS intermediate text. A later layer's
 * restore can change lengths before a frame, so these offsets are not final
 * output offsets; mapping them through that restore is not done here.
 *
 * Throws `FrameProtectionError` if `carrier` does not contain each frame
 * placeholder exactly once, in token order: that carrier was not built from
 * these frames.
 */
export const substituteFramesAfterIntegrity = (
  output: string,
  frames: ProtectedFrames,
  carrier: string,
): RestoredFrames => {
  const inCarrier = reservedPlaceholdersIn(carrier);
  const framePlaceholders = frames.tokens.map(({ placeholder }) => placeholder);
  const frameOrderInCarrier = inCarrier.filter((placeholder) => framePlaceholders.includes(placeholder));
  if (frameOrderInCarrier.join("\n") !== framePlaceholders.join("\n")) {
    throw new FrameProtectionError(
      "The carrier does not contain each frame placeholder exactly once, in order.",
    );
  }
  const errors = carrierPlaceholderErrors(output, carrier);
  if (errors.length > 0) return { text: output, valid: false, errors, pieces: [] };
  return substituteFrames(output, frames);
};
