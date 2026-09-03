import { describe, expect, it } from "vitest";
import {
  isPatternOnlyProtectedText,
  protectImmutablePattern,
  restoreImmutablePattern,
} from "../immutable.js";

describe("immutable pattern protection", () => {
  it("preserves decimal lexical representation", () => {
    const protectedSource = protectImmutablePattern("2.00 no tığ");
    expect(protectedSource.tokens[0]).toMatchObject({
      kind: "number",
      source: "2.00",
    });
    expect(
      restoreImmutablePattern(protectedSource.text, protectedSource, "en").text,
    ).toBe("2.00 no tığ");
  });

  it("protects and converts a complete pattern skeleton", () => {
    const source = "(11x, 1e)*6 = 72x";
    const protectedSource = protectImmutablePattern(source);
    expect(isPatternOnlyProtectedText(protectedSource)).toBe(true);
    expect(
      restoreImmutablePattern(protectedSource.text, protectedSource, "en"),
    ).toMatchObject({
      valid: true,
      text: "(11sc, 1dec)*6 = 72sc",
    });
  });

  it("preserves both numeric values and range punctuation", () => {
    const protectedSource = protectImmutablePattern("12-23");
    expect(
      restoreImmutablePattern(protectedSource.text, protectedSource, "en").text,
    ).toBe("12-23");
  });

  it("blocks a corrupted numeric placeholder", () => {
    const protectedSource = protectImmutablePattern("20x örüyoruz");
    const translated = protectedSource.text.replace("__XQAAAAQX__", "");
    expect(
      restoreImmutablePattern(translated, protectedSource, "en"),
    ).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "MISSING_PROTECTED_NOTATION" }),
      ]),
    });
  });

  it("blocks a missing structural placeholder", () => {
    const protectedSource = protectImmutablePattern("(x)");
    const structural = protectedSource.tokens.find(
      ({ kind }) => kind === "structure",
    );
    expect(structural).toBeDefined();
    const translated = protectedSource.text.replace(
      structural?.placeholder ?? "",
      "",
    );
    expect(
      restoreImmutablePattern(translated, protectedSource, "en").valid,
    ).toBe(false);
  });
});

describe("materials immutable protection", () => {
  it("protects alphanumeric product codes as a whole while leaving prose punctuation translatable", () => {
    const protectedSource = protectImmutablePattern(
      "Catania TR263 (kol, gövde) 2.5mm",
      0,
      "materials",
    );

    expect(protectedSource.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "TR263" }),
        expect.objectContaining({ kind: "number", source: "2.5" }),
      ]),
    );

    expect(protectedSource.tokens).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "(" }),
        expect.objectContaining({ source: ")" }),
      ]),
    );

    expect(protectedSource.text).toContain("(kol, gövde)");
    expect(protectedSource.text).not.toContain("TR263");
    expect(protectedSource.text).not.toContain("2.5");

    expect(
      restoreImmutablePattern(
        protectedSource.text,
        protectedSource,
        "en",
      ),
    ).toMatchObject({
      valid: true,
      text: "Catania TR263 (kol, gövde) 2.5mm",
    });
  });
});
