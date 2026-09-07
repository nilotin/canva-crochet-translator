import { describe, expect, it } from "vitest";
import { tokenizeSourceNotation } from "../notation/tokenizer.js";
import {
  MAX_SEGMENT_CHARS,
  MAX_SEGMENT_NOTATION_TOKENS,
  reconstructSegments,
  segmentTranslationBlock,
} from "../segmentation.js";

const longNumberedPattern = Array.from(
  { length: 18 },
  (_, index) => `${index + 1}) (6x, v) x 6. FLO örüyoruz.`,
).join("\n");

const reconstructSource = (source: string) => {
  const segments = segmentTranslationBlock(source);
  return {
    segments,
    reconstructed: reconstructSegments(
      segments,
      segments.map(({ text }) => text),
    ),
  };
};

describe("translation segmentation", () => {
  it("keeps a short block as one segment", () => {
    expect(segmentTranslationBlock("6x, v, 6x, CC")).toHaveLength(1);
  });

  it("splits long blocks at newlines and numbered instructions", () => {
    const segments = segmentTranslationBlock(longNumberedPattern);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.map(({ text }) => text)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/1\)/u),
        expect.stringMatching(/18\)/u),
      ]),
    );
    expect(
      reconstructSegments(
        segments,
        segments.map(({ text }) => text),
      ),
    ).toBe(longNumberedPattern);
  });

  it("preserves parentheses and notation expressions within segments", () => {
    const segments = segmentTranslationBlock(longNumberedPattern);
    for (const segment of segments) {
      const withoutInstructionMarker = segment.text.replace(/^\d+\)/u, "");
      expect((withoutInstructionMarker.match(/\(/gu) ?? []).length).toBe(
        (withoutInstructionMarker.match(/\)/gu) ?? []).length,
      );
      expect(segment.text).not.toMatch(/\(6x$/u);
    }
  });

  it("uses conservative character and notation limits for structural fixtures", () => {
    const segments = segmentTranslationBlock(longNumberedPattern);
    for (const segment of segments) {
      expect(segment.text.length).toBeLessThanOrEqual(MAX_SEGMENT_CHARS);
      expect(tokenizeSourceNotation(segment.text).length).toBeLessThanOrEqual(
        MAX_SEGMENT_NOTATION_TOKENS,
      );
    }
  });

  it("preserves exact line breaks and segment order during reconstruction", () => {
    const segments = segmentTranslationBlock(longNumberedPattern);
    const translated = segments.map((_, index) => `translated-${index + 1}`);
    const reconstructed = reconstructSegments(segments, translated);
    expect(reconstructed.match(/translated-\d+/gu)).toEqual(translated);
    expect((reconstructed.match(/\n/gu) ?? []).length).toBe(
      (longNumberedPattern.match(/\n/gu) ?? []).length,
    );
  });

  it("does not split a bare hook size across a newline", () => {
    const source = `${"a".repeat(480)}\n${"b".repeat(14)} 2.20\ntığ ile örüyoruz.`;
    const { segments, reconstructed } = reconstructSource(source);

    expect(segments.some(({ text }) => text.includes("2.20\ntığ"))).toBe(true);
    expect(reconstructed).toBe(source);
  });

  it("allows a segment boundary immediately after a complete hook-size span", () => {
    const source = `${"a".repeat(490)}2.20 tığ\n${"b".repeat(80)}`;
    const { segments, reconstructed } = reconstructSource(source);

    expect(segments).toHaveLength(2);
    expect(segments[0]?.text).toMatch(/2\.20 tığ$/u);
    expect(segments[1]?.text).toBe("b".repeat(80));
    expect(reconstructed).toBe(source);
  });

  it("does not protect an arbitrary bare decimal from normal segmentation", () => {
    const source = `${"a".repeat(495)}2.20\n${"b".repeat(80)}`;
    const { segments, reconstructed } = reconstructSource(source);

    expect(segments).toHaveLength(2);
    expect(segments[0]?.text).toMatch(/2\.20$/u);
    expect(segments[1]?.text).toBe("b".repeat(80));
    expect(reconstructed).toBe(source);
  });
});
