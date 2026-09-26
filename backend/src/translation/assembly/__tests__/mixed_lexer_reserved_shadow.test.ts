/**
 * Shadow model of the future mixed-path flow for SEPARABLE frames (Stage 1,
 * Task 8). Nothing here touches the translator; production still calls
 * `lexMixedSegment` without reserved placeholders.
 *
 *   segment -> separable frame -> frame placeholder -> legacy normalizer on the
 *   rest -> lexMixedSegment(..., { reservedPlaceholders: [placeholder] })
 *
 * Only the two frames the ownership probe currently classifies as separable
 * are used.
 */
import { describe, expect, it } from "vitest";
import { loadCorpus } from "../../__tests__/corpus/load_corpus.js";
import { extractLeadingInstruction } from "../../instruction_marker.js";
import { lexMixedSegment, reconstructMixedSource } from "../../mixed_segment.js";
import { normalizeSourceNaturalLanguageDetailed } from "../../natural_language/normalizer.js";
import { reservedPlaceholdersIn } from "../../notation/immutable.js";
import { parseFrames } from "../../parser/frame_parser.js";
import { renderUnits } from "../../renderer/frame_renderer.js";
import { segmentTranslationBlock } from "../../segmentation.js";
import { classifyFrameOwnership } from "../frame_ownership.js";
import { protectFrames } from "../frame_protection.js";

const blockOf = (prefix: string): string => {
  const found = loadCorpus().cases.find(({ caseId }) => caseId.startsWith(prefix));
  const text = found?.value.request.blocks[0]?.text;
  if (text === undefined) throw new Error(`No corpus case ${prefix}.`);
  return text;
};

/** Legacy and frame-placeholder versions of the segment that holds the frame. */
const model = (block: string, frameRaw: string) => {
  const parse = parseFrames(block);
  const units = renderUnits(parse, "en");
  const unit = units.find(({ sourceSpan }) => sourceSpan.raw === frameRaw);
  if (unit === undefined) throw new Error(`No render unit ${frameRaw}.`);
  const [ownership] = classifyFrameOwnership(block, [unit], "en");
  const [token] = protectFrames(parse, [unit]).tokens;
  const placeholder = token!.placeholder;

  const segment = segmentTranslationBlock(block).find(
    ({ start, end }) => start <= unit.sourceSpan.start && unit.sourceSpan.end <= end,
  )!;
  const body = extractLeadingInstruction(segment.text)?.body ?? segment.text;
  const bodyStart = segment.start + (segment.text.length - body.length);
  const { start, end } = unit.sourceSpan;

  const legacyText = normalizeSourceNaturalLanguageDetailed(body, "en", "pattern", block, bodyStart).text;
  const carrierBody = body.slice(0, start - bodyStart) + placeholder + body.slice(end - bodyStart);
  const carrierContext = block.slice(0, start) + placeholder + block.slice(end);
  const carrierText = normalizeSourceNaturalLanguageDetailed(
    carrierBody,
    "en",
    "pattern",
    carrierContext,
    bodyStart,
  ).text;

  return {
    ownership,
    placeholder,
    frameRaw,
    carrierText,
    legacy: lexMixedSegment(legacyText, "en", "segment"),
    lexed: lexMixedSegment(carrierText, "en", "segment", { reservedPlaceholders: [placeholder] }),
  };
};

describe.each([
  ["h-127de8dd49", "20x örüyoruz"],
  ["h-2c5ac91027", "28x örüyoruz"],
])("mixed lexer with a reserved frame placeholder: %s", (prefix, frameRaw) => {
  const result = model(blockOf(prefix), frameRaw);

  it("uses a frame the ownership probe classifies as separable", () => {
    expect(result.ownership?.ownership).toBe("separable");
  });

  it("lexes validly with the placeholder as exactly one reserved_placeholder token", () => {
    expect(result.lexed.valid).toBe(true);
    expect(result.lexed.errors).toEqual([]);
    expect(result.lexed.classification).toBe("mixed");
    expect(
      result.lexed.tokens.filter(({ kind }) => kind === "reserved_placeholder").map(({ sourceText }) => sourceText),
    ).toEqual([result.placeholder]);
  });

  it("covers the carrier exactly and reconstructs it", () => {
    let cursor = 0;
    for (const token of result.lexed.tokens) {
      expect(token.start).toBe(cursor);
      expect(result.carrierText.slice(token.start, token.end)).toBe(token.sourceText);
      cursor = token.end;
    }
    expect(cursor).toBe(result.carrierText.length);
    expect(reconstructMixedSource(result.lexed.tokens)).toBe(result.carrierText);
  });

  it("sends the provider neither frame text nor placeholder syntax", () => {
    for (const span of result.lexed.spans) {
      expect(reservedPlaceholdersIn(span.text)).toEqual([]);
      expect(span.text).not.toContain(result.frameRaw);
      expect(span.text).not.toMatch(/örüyoruz/u);
    }
  });
});

describe("mixed lexer with a reserved frame placeholder: provider-span improvement", () => {
  it("h-127de8dd49: the span no longer ends with a dangling 'Work'", () => {
    const { legacy, lexed } = model(blockOf("h-127de8dd49"), "20x örüyoruz");
    const spans = (result: typeof lexed) => result.spans.map(({ text }) => text);
    expect(spans(legacy)).toContain("attach the yarn from the back of the armhole. Work");
    expect(spans(lexed)).toContain("attach the yarn from the back of the armhole.");
    expect(spans(lexed).some((text) => /\bWork$/u.test(text))).toBe(false);
  });

  it("h-2c5ac91027: the standalone 'Work' span disappears", () => {
    const { legacy, lexed } = model(blockOf("h-2c5ac91027"), "28x örüyoruz");
    expect(legacy.spans.map(({ text }) => text)).toContain("Work");
    expect(lexed.spans.map(({ text }) => text)).not.toContain("Work");
  });
});
