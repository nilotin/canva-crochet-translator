import { describe, expect, it } from "vitest";
import {
  extractLeadingInstruction,
  getLeadingInstructionMarker,
  restoreLeadingInstruction,
} from "../instruction_marker.js";

describe("leading instruction markers", () => {
  it("does not treat a decimal as an instruction marker", () => {
    expect(
      getLeadingInstructionMarker("2.00 no tığ ile örüyoruz."),
    ).toBeUndefined();
  });

  it.each(["2) 8x, 1v", "2. 8x, 1v"])(
    "extracts and restores the standalone marker in %s",
    (source) => {
      const instruction = extractLeadingInstruction(source);
      expect(instruction?.marker).toBe(source.slice(0, 2));
      expect(
        restoreLeadingInstruction(instruction, instruction?.body ?? ""),
      ).toBe(source);
    },
  );

  it("preserves marker whitespace exactly", () => {
    const instruction = extractLeadingInstruction("  26)   20x, 6v");
    expect(restoreLeadingInstruction(instruction, "20sc, 6inc")).toBe(
      "  26)   20sc, 6inc",
    );
  });
});
