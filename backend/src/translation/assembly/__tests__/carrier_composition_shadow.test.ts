/**
 * Corpus shadow coverage for the combined carrier (Stage 1, Task 6).
 *
 * For every frame-bearing corpus block: frames are protected first (ids from
 * 0), immutable content second (ids after the frame ids), the combined
 * carrier is echoed back as if by a provider, checked in one pass against all
 * of its placeholders, frame placeholders are substituted, and the unchanged
 * `restoreImmutablePattern` finishes. The result is a deliberate shadow
 * artifact (Turkish text with canonical frame text and restored notation); it
 * is never compared with stored translations.
 */
import { describe, expect, it } from "vitest";
import { loadCorpus } from "../../__tests__/corpus/load_corpus.js";
import {
  protectImmutablePattern,
  reservedPlaceholdersIn,
  restoreImmutablePattern,
} from "../../notation/immutable.js";
import { parseFrames } from "../../parser/frame_parser.js";
import { renderUnits } from "../../renderer/frame_renderer.js";
import {
  carrierPlaceholderErrors,
  protectFrames,
  restoreFrames,
  substituteFramesAfterIntegrity,
} from "../frame_protection.js";

const cases = loadCorpus().cases;

const blocks = cases.flatMap(({ caseId, value }) =>
  value.request.blocks.map((block) => ({
    label: `${caseId} ${block.id}`,
    lane: value.lane,
    /** One of the measured Stage 0 hazard cases R1-R4. */
    measured: value.labels.hazards.length > 0,
    targetLanguage: value.request.targetLanguage,
    text: block.text,
  })),
);

const frameBearing = blocks.filter(({ text }) => renderUnits(parseFrames(text), "en").length > 0);

describe("combined carrier shadow: frame-bearing corpus blocks", () => {
  it(`[diagnostic] ${frameBearing.length} frame-bearing block(s) composed (not frozen)`, () => {
    expect(frameBearing.length).toBeGreaterThan(0);
  });

  it.each(frameBearing.map(({ label, text }) => [label, text] as const))(
    "%s: protect frames, protect immutable, echo, check, substitute, restore",
    (_label, text) => {
      const parse = parseFrames(text);
      const frames = protectFrames(parse, renderUnits(parse, "en"), 0);
      const immutable = protectImmutablePattern(frames.text, frames.tokens.length);
      const carrier = immutable.text;
      const framePlaceholders = frames.tokens.map(({ placeholder }) => placeholder);

      // Every frame placeholder survives immutable protection, once, in order.
      expect(reservedPlaceholdersIn(carrier).filter((p) => framePlaceholders.includes(p))).toEqual(
        framePlaceholders,
      );
      const echo = carrier;

      // One check over the union, in carrier order.
      expect(carrierPlaceholderErrors(echo, carrier)).toEqual([]);
      // The frame-only restore still refuses this carrier (strict by design)
      // whenever the immutable layer protected anything.
      if (immutable.tokens.length > 0) expect(restoreFrames(echo, frames).valid).toBe(false);

      const step = substituteFramesAfterIntegrity(echo, frames, carrier);
      expect(step.valid).toBe(true);
      expect(reservedPlaceholdersIn(step.text)).toEqual(immutable.tokens.map(({ placeholder }) => placeholder));
      step.pieces.forEach((piece, index) => {
        expect(step.text.slice(piece.targetStart, piece.targetEnd)).toBe(frames.tokens[index]!.meaning);
      });

      const final = restoreImmutablePattern(step.text, immutable, "en");
      expect(final.valid).toBe(true);
      expect(final.errors).toEqual([]);
      expect(reservedPlaceholdersIn(final.text)).toEqual([]);

      // Frame meanings are present, in source order.
      let cursor = 0;
      for (const { meaning } of frames.tokens) {
        const at = final.text.indexOf(meaning, cursor);
        expect(at).toBeGreaterThanOrEqual(cursor);
        cursor = at + meaning.length;
      }
      // Independent check: restoring frames on their own carrier, then protecting
      // and restoring immutable content separately, gives the same text.
      const framesOnly = restoreFrames(frames.text, frames).text;
      const separate = protectImmutablePattern(framesOnly);
      expect(final.text).toBe(restoreImmutablePattern(separate.text, separate, "en").text);
      // Deterministic.
      expect(substituteFramesAfterIntegrity(echo, frames, carrier)).toEqual(step);
    },
  );
});

describe("combined carrier shadow: blocks without frame units stay identity", () => {
  const withoutUnits = blocks.filter(({ targetLanguage, measured }) => targetLanguage === "es" || measured);

  it.each(withoutUnits.map(({ label, text, targetLanguage }) => [label, text, targetLanguage] as const))(
    "%s: no frame tokens, frame layer changes nothing",
    (_label, text, targetLanguage) => {
      const parse = parseFrames(text);
      const frames = protectFrames(parse, renderUnits(parse, targetLanguage), 0);
      expect(frames).toEqual({ source: text, text, tokens: [] });
      const immutable = protectImmutablePattern(frames.text, frames.tokens.length);
      expect(immutable).toEqual(protectImmutablePattern(text));
      const step = substituteFramesAfterIntegrity(immutable.text, frames, immutable.text);
      expect(step).toEqual({ text: immutable.text, valid: true, errors: [], pieces: [] });
    },
  );

  it("covers all four measured hazard cases (R1-R4)", () => {
    expect(cases.filter(({ value }) => value.labels.hazards.length > 0)).toHaveLength(4);
  });
});
