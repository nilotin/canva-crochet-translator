/**
 * Frame placement provenance (next stage, Task 4: SHADOW ONLY).
 *
 * Two provenance layers stay separate and are composed here:
 *  - SEMANTIC: a unit's `RenderPiece`s map source sub-spans to ranges of the
 *    unit's own text (renderer);
 *  - PLACEMENT: restoration's `FramePiece`s say where each whole unit landed
 *    in the restored output (frame protection).
 * `placeRenderedUnits` composes them into `PlacedPiece`s: exact source spans
 * and UTF-16 target ranges in the restored output. A unit without semantic
 * pieces (every Stage 1 `RenderUnit`) becomes one whole-unit piece.
 *
 * Placement coordinates are valid ONLY for the exact string they were computed
 * on. A marker restored in front of the body is a constant shift
 * (`shiftPlacedPieces`) plus an identity piece for that exact prefix
 * (`prefixIdentityPiece`). Anything that may rewrite the text afterwards, such
 * as legacy style normalization, invalidates every piece: a later caller must
 * drop them unless the rewritten text equals the text they were placed on.
 * Nothing here normalizes, re-parses or guesses; any inconsistency makes the
 * result invalid.
 *
 * No production module imports this. `toProjectionPieces` only converts to the
 * existing projection piece shape; it applies no formatting policy.
 *
 * Import rules: types only, from the parser IR, the renderer and frame
 * protection. No natural-language, translator, projection, provider or
 * validator code.
 */
import type { SourceSpan } from "../parser/frame_ir.js";
import type { RenderPiece } from "../renderer/frame_renderer.js";
import type { RestoredFrames } from "./frame_protection.js";

export type PlacedPiece = {
  readonly sourceSpan: SourceSpan;
  /** UTF-16 offsets in the output string the placement was computed on. */
  readonly targetStart: number;
  readonly targetEnd: number;
};

/** `RenderUnit` or `CourseCountRenderUnit`; no `pieces` means one whole-unit piece. */
export type PlaceableUnit = {
  readonly sourceSpan: SourceSpan;
  readonly text: string;
  readonly pieces?: readonly RenderPiece[];
};

export type PlacementResult = {
  readonly valid: boolean;
  readonly errors: readonly string[];
  /** Empty when invalid. */
  readonly pieces: readonly PlacedPiece[];
};

export class PlacementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlacementError";
  }
}

const invalid = (errors: readonly string[]): PlacementResult => ({ valid: false, errors, pieces: [] });

/** Problems with one unit's semantic pieces; empty when they partition its source span and text. */
const semanticPieceErrors = (unit: PlaceableUnit, pieces: readonly RenderPiece[], unitIndex: number): string[] => {
  const label = `Unit ${unitIndex}`;
  if (pieces.length === 0) return [`${label} has an empty piece list.`];
  const errors: string[] = [];
  const { start, end, raw } = unit.sourceSpan;
  for (const [pieceIndex, piece] of pieces.entries()) {
    const source = piece.sourceSpan;
    if (source.start < start || source.end > end || source.end <= source.start) {
      errors.push(`${label} piece ${pieceIndex} source ${source.start}..${source.end} lies outside the unit source span ${start}..${end}.`);
    } else if (raw.slice(source.start - start, source.end - start) !== source.raw) {
      errors.push(`${label} piece ${pieceIndex} source raw text is not the unit source slice.`);
    }
    if (piece.targetStart < 0 || piece.targetEnd > unit.text.length || piece.targetEnd <= piece.targetStart) {
      errors.push(`${label} piece ${pieceIndex} target ${piece.targetStart}..${piece.targetEnd} lies outside the unit text (0..${unit.text.length}).`);
    }
  }
  if (errors.length > 0) return errors;

  const bySource = [...pieces].sort((left, right) => left.sourceSpan.start - right.sourceSpan.start);
  let sourceCursor = start;
  for (const piece of bySource) {
    if (piece.sourceSpan.start < sourceCursor) errors.push(`${label} source pieces overlap at ${piece.sourceSpan.start}.`);
    if (piece.sourceSpan.start > sourceCursor) errors.push(`${label} source pieces leave a gap at ${sourceCursor}..${piece.sourceSpan.start}.`);
    sourceCursor = Math.max(sourceCursor, piece.sourceSpan.end);
  }
  if (sourceCursor !== end) errors.push(`${label} source pieces leave a gap at ${sourceCursor}..${end}.`);

  const byTarget = [...pieces].sort((left, right) => left.targetStart - right.targetStart);
  let targetCursor = 0;
  for (const piece of byTarget) {
    if (piece.targetStart < targetCursor) errors.push(`${label} target pieces overlap at ${piece.targetStart}.`);
    if (piece.targetStart > targetCursor) errors.push(`${label} target pieces leave a gap at ${targetCursor}..${piece.targetStart}.`);
    targetCursor = Math.max(targetCursor, piece.targetEnd);
  }
  if (targetCursor !== unit.text.length) {
    errors.push(`${label} target pieces leave a gap at ${targetCursor}..${unit.text.length}.`);
  }
  return errors;
};

/**
 * Places each unit's pieces into `restored.text`. `units` must be the units
 * that were protected, in the same order: restoration emits exactly one
 * placement per unit, in token (source) order, so the correspondence is
 * positional and each placement's source span must equal its unit's span.
 * Pure; returns an invalid result (no pieces) on any inconsistency.
 */
export const placeRenderedUnits = (
  restored: RestoredFrames,
  units: readonly PlaceableUnit[],
): PlacementResult => {
  if (!restored.valid) return invalid(["Restoration is invalid; nothing can be placed."]);
  if (restored.pieces.length !== units.length) {
    return invalid([`Expected ${units.length} placement(s), got ${restored.pieces.length}.`]);
  }

  const errors: string[] = [];
  const placed: PlacedPiece[] = [];
  for (const [unitIndex, unit] of units.entries()) {
    const placement = restored.pieces[unitIndex]!;
    const label = `Unit ${unitIndex}`;
    if (placement.sourceStart !== unit.sourceSpan.start || placement.sourceEnd !== unit.sourceSpan.end) {
      errors.push(
        `${label} placement source ${placement.sourceStart}..${placement.sourceEnd} is not the unit span ${unit.sourceSpan.start}..${unit.sourceSpan.end}.`,
      );
      continue;
    }
    if (
      !Number.isSafeInteger(placement.targetStart) ||
      !Number.isSafeInteger(placement.targetEnd) ||
      placement.targetStart < 0 ||
      placement.targetEnd < placement.targetStart ||
      placement.targetEnd > restored.text.length
    ) {
      errors.push(`${label} placement ${placement.targetStart}..${placement.targetEnd} is malformed.`);
      continue;
    }
    if (restored.text.slice(placement.targetStart, placement.targetEnd) !== unit.text) {
      errors.push(`${label} text does not match the restored text at ${placement.targetStart}..${placement.targetEnd}.`);
      continue;
    }
    const semantic: readonly RenderPiece[] = unit.pieces ?? [
      { sourceSpan: unit.sourceSpan, targetStart: 0, targetEnd: unit.text.length },
    ];
    const pieceErrors = semanticPieceErrors(unit, semantic, unitIndex);
    if (pieceErrors.length > 0) {
      errors.push(...pieceErrors);
      continue;
    }
    for (const piece of semantic) {
      placed.push({
        sourceSpan: piece.sourceSpan,
        targetStart: placement.targetStart + piece.targetStart,
        targetEnd: placement.targetStart + piece.targetEnd,
      });
    }
  }

  const byTarget = [...placed].sort((left, right) => left.targetStart - right.targetStart);
  for (let index = 1; index < byTarget.length; index += 1) {
    if (byTarget[index]!.targetStart < byTarget[index - 1]!.targetEnd) {
      errors.push(`Placed pieces overlap at ${byTarget[index]!.targetStart}.`);
    }
  }
  return errors.length > 0 ? invalid(errors) : { valid: true, errors: [], pieces: placed };
};

/**
 * Shifts every target range by `offset` (for text restored in front, such as
 * an instruction marker). Source spans are unchanged. Pure. Throws
 * `PlacementError` for a negative or non-integer offset: nothing is ever
 * removed from in front of a placed output.
 */
export const shiftPlacedPieces = (pieces: readonly PlacedPiece[], offset: number): readonly PlacedPiece[] => {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new PlacementError(`Shift offset must be a non-negative integer, got ${offset}.`);
  }
  return pieces.map((piece) => ({
    sourceSpan: piece.sourceSpan,
    targetStart: piece.targetStart + offset,
    targetEnd: piece.targetEnd + offset,
  }));
};

/**
 * Identity provenance for an already-known exact prefix (a restored
 * instruction marker, or text copied unchanged): source [0, prefixEnd) ->
 * target [0, prefixEnd). Undefined unless `output` starts with exactly that
 * source prefix. It does not parse marker syntax.
 */
export const prefixIdentityPiece = (
  source: string,
  prefixEnd: number,
  output: string,
): PlacedPiece | undefined => {
  if (!Number.isSafeInteger(prefixEnd) || prefixEnd <= 0 || prefixEnd > source.length) return undefined;
  const prefix = source.slice(0, prefixEnd);
  if (!output.startsWith(prefix)) return undefined;
  return { sourceSpan: { start: 0, end: prefixEnd, raw: prefix }, targetStart: 0, targetEnd: prefixEnd };
};

/** Structural adapter to the existing projection piece shape. No projection policy. */
export const toProjectionPieces = (
  pieces: readonly PlacedPiece[],
): readonly { sourceStart: number; sourceEnd: number; targetStart: number; targetEnd: number }[] =>
  pieces.map((piece) => ({
    sourceStart: piece.sourceSpan.start,
    sourceEnd: piece.sourceSpan.end,
    targetStart: piece.targetStart,
    targetEnd: piece.targetEnd,
  }));
