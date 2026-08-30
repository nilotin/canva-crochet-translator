import { describe, expect, it } from "vitest";

import { buildFormattingTranslationUnits } from "../formatting_units.js";

describe("formatting translation units", () => {
  it("preserves meaningful Canva formatting boundaries", () => {
    const source = "✦ Kulak - açıklama\n✦ Kaş - açıklama";

    const units = buildFormattingTranslationUnits({
      id: "block",
      text: source,
      formattingRegions: [
        { id: "fmt-0", start: 0, end: 2 },
        { id: "fmt-1", start: 2, end: 7 },
        { id: "fmt-2", start: 7, end: 8 },
        { id: "fmt-3", start: 8, end: 19 },
        { id: "fmt-4", start: 19, end: 24 },
        { id: "fmt-5", start: 24, end: source.length },
      ],
    });

    expect(units?.map(({ id, text }) => ({ id, text }))).toEqual([
      { id: "fmt-0", text: "✦ " },
      { id: "fmt-1", text: "Kulak" },
      { id: "fmt-2", text: " " },
      { id: "fmt-3", text: "- açıklama\n" },
      { id: "fmt-4", text: "✦ Kaş" },
      { id: "fmt-5", text: " - açıklama" },
    ]);
  });

  it("refuses a formatting boundary inside a word", () => {
    expect(
      buildFormattingTranslationUnits({
        id: "block",
        text: "Kulak",
        formattingRegions: [
          { id: "fmt-0", start: 0, end: 2 },
          { id: "fmt-1", start: 2, end: 5 },
        ],
      }),
    ).toBeUndefined();
  });

  it("refuses gaps or overlaps in formatting coverage", () => {
    expect(
      buildFormattingTranslationUnits({
        id: "block",
        text: "abc def",
        formattingRegions: [
          { id: "fmt-0", start: 0, end: 3 },
          { id: "fmt-1", start: 4, end: 7 },
        ],
      }),
    ).toBeUndefined();
  });
});
