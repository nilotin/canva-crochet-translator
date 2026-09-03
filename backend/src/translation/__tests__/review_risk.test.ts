import { describe, expect, it } from "vitest";
import { findHighRiskInstructionConcepts } from "../review_risk.js";

describe("findHighRiskInstructionConcepts", () => {
  it("does not double-count the ordinary next-row-up idiom \"üst sıra\"", () => {
    expect(findHighRiskInstructionConcepts("bir üst sıraya geçiyoruz")).toEqual([
      "üst",
    ]);
  });

  it("does not double-count the ordinary previous-row-down idiom \"alt sıra\"", () => {
    expect(findHighRiskInstructionConcepts("bir alt sıraya geçiyoruz")).toEqual([
      "alt",
    ]);
  });

  it("still counts sıra when it is not adjacent to üst/alt (the eye-relative row pattern)", () => {
    expect(
      findHighRiskInstructionConcepts("gözden 4 sıra üzerinden işliyoruz"),
    ).toEqual(["göz", "sıra"]);
  });

  it("still counts a genuine combination of two distinct spatial axes", () => {
    expect(
      findHighRiskInstructionConcepts("iç kısmın üst tarafından başlıyoruz"),
    ).toEqual(["üst", "iç"]);
  });

  it("still counts sıra when it appears again away from the üst/alt idiom", () => {
    expect(
      findHighRiskInstructionConcepts(
        "bir üst sıraya geçiyoruz, sonraki sırada devam ediyoruz",
      ),
    ).toEqual(["üst", "sıra"]);
  });
});
