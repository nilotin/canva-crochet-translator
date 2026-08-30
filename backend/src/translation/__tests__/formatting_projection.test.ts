import { describe, expect, it } from "vitest";
import { projectDeterministicFormattingRegions } from "../formatting_projection.js";

describe("formatting projection", () => {
  it("projects formatting across deterministic notation expansion", () => {
    const projected = projectDeterministicFormattingRegions(
      {
        id: "block-1",
        text: "6x, v, 4x",
        formattingRegions: [
          { id: "fmt-0", start: 0, end: 4 },
          { id: "fmt-red", start: 4, end: 5 },
          { id: "fmt-2", start: 5, end: 9 },
        ],
      },
      "en",
    );

    expect(projected).toEqual([
      { id: "fmt-0", start: 0, end: 5 },
      { id: "fmt-red", start: 5, end: 8 },
      { id: "fmt-2", start: 8, end: 13 },
    ]);
  });

  it("does not guess projection when natural-language translation is involved", () => {
    const projected = projectDeterministicFormattingRegions(
      {
        id: "block-1",
        text: "6x örüyoruz",
        formattingRegions: [{ id: "fmt-0", start: 0, end: 12 }],
      },
      "en",
    );

    expect(projected).toBeUndefined();
  });
});
