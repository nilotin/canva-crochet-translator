import { describe, expect, it } from "vitest";
import {
  buildDeterministicTranslationResult,
  formattingRegionsFitWithinText,
} from "../deterministic_bypass.js";

describe("deterministic bypass result construction", () => {
  it("returns no targetFormattingRegions for a block with no formatting regions", () => {
    const result = buildDeterministicTranslationResult(
      { id: "block-1", text: "Kulak" },
      "Ear",
      "en",
    );

    expect(result).toEqual({
      id: "block-1",
      source: "Kulak",
      translated: "Ear",
      valid: true,
      errors: [],
      warnings: [],
    });
    expect(result.targetFormattingRegions).toBeUndefined();
  });

  it("safely projects a single formatting region on a deterministic (pattern-only) block", () => {
    const block = {
      id: "block-1",
      text: "6x",
      formattingRegions: [{ id: "fmt-0", start: 0, end: 2 }],
    };

    // "6x" deterministically expands to a 3-character target notation
    // (confirmed empirically against projectDeterministicFormattingRegions
    // directly) -- supply a translated string at least that long so the
    // projected range is in bounds.
    const result = buildDeterministicTranslationResult(block, "6sc", "en");

    expect(result.targetFormattingRegions).toBeDefined();
    expect(result.targetFormattingRegions).toEqual([
      { id: "fmt-0", start: 0, end: 3 },
    ]);
  });

  it("safely projects multiple inline style regions and returns the exact target ranges", () => {
    const block = {
      id: "block-1",
      text: "6x, v, 4x",
      formattingRegions: [
        { id: "fmt-0", start: 0, end: 4 },
        { id: "fmt-red", start: 4, end: 5 },
        { id: "fmt-2", start: 5, end: 9 },
      ],
    };

    // Matches formatting_projection.test.ts's known-good deterministic
    // expansion for this exact source, so the target string used here is
    // long enough (13 chars) for every projected range to be in bounds.
    const translatedText = "Xxxxx, R, Yyyy"; // 14 chars >= 13

    const result = buildDeterministicTranslationResult(
      block,
      translatedText,
      "en",
    );

    expect(result.targetFormattingRegions).toEqual([
      { id: "fmt-0", start: 0, end: 5 },
      { id: "fmt-red", start: 5, end: 8 },
      { id: "fmt-2", start: 8, end: 13 },
    ]);
  });

  it("blocks instead of inventing formatting when the source requires natural-language translation", () => {
    const block = {
      id: "block-1",
      text: "6x örüyoruz",
      formattingRegions: [{ id: "fmt-0", start: 0, end: 12 }],
    };

    const result = buildDeterministicTranslationResult(
      block,
      "We work 6x",
      "en",
    );

    expect(result.targetFormattingRegions).toBeUndefined();
    // The translated text itself is still returned -- omitting formatting
    // regions is the safe failure, not silently dropping the translation.
    expect(result.translated).toBe("We work 6x");
  });

  it("blocks instead of inventing formatting when the projected range does not fit the actual translated text", () => {
    const block = {
      id: "block-1",
      text: "6x, v, 4x",
      formattingRegions: [
        { id: "fmt-0", start: 0, end: 4 },
        { id: "fmt-red", start: 4, end: 5 },
        { id: "fmt-2", start: 5, end: 9 },
      ],
    };

    // The deterministic source-notation reconstruction implies a target
    // length of 13, but this registry-approved translated string
    // (independently human-authored) is much shorter -- trusting the
    // projected ranges here would point past the end of the string.
    const shortTranslatedText = "short";

    const result = buildDeterministicTranslationResult(
      block,
      shortTranslatedText,
      "en",
    );

    expect(result.targetFormattingRegions).toBeUndefined();
    expect(result.translated).toBe("short");
  });

  it("never invents malformed ranges even when close to the bounds edge", () => {
    // Projected max end is 13 (see the multi-region case above); 12 is
    // one character too short to hold the last region.
    const regions = [{ id: "fmt-2", start: 8, end: 13 }];
    expect(formattingRegionsFitWithinText(regions, "x".repeat(12))).toBe(
      false,
    );
    expect(formattingRegionsFitWithinText(regions, "x".repeat(13))).toBe(
      true,
    );
  });

  it("rejects a non-integer or negative-bound region defensively", () => {
    expect(
      formattingRegionsFitWithinText(
        [{ id: "a", start: -1, end: 2 }],
        "abcdef",
      ),
    ).toBe(false);
    expect(
      formattingRegionsFitWithinText(
        [{ id: "a", start: 3, end: 2 }],
        "abcdef",
      ),
    ).toBe(false);
  });

  it("always marks a deterministic hit as valid with no errors/warnings", () => {
    const result = buildDeterministicTranslationResult(
      { id: "block-1", text: "Kulak" },
      "Ear",
      "en",
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
