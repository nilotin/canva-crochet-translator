import {
  isDeterministicGlossary,
  translateGlossaryDeterministically,
} from "../generic_glossary_translation";

describe("generic deterministic glossary translation", () => {
  it("translates any supported subset without requiring a fixed full glossary", () => {
    const source =
      "✦ ydcv: ydc arttırma\n" +
      "✦ zn: zincir\n" +
      "✦ x: sık iğne";

    expect(translateGlossaryDeterministically(source, "en")).toBe(
      "✦ ydc-inc: ydc increase\n" +
        "✦ ch: chain\n" +
        "✦ sc: single crochet",
    );
  });

  it("preserves source entry order", () => {
    const source =
      "✦ dc: ikili trabzan\n" +
      "✦ sh: sihirli halka\n" +
      "✦ v: arttırma";

    expect(translateGlossaryDeterministically(source, "en")).toBe(
      "✦ dc: double crochet\n" +
        "✦ mr: magic ring\n" +
        "✦ inc: increase",
    );
  });

  it("normalizes whitespace inside multiline glossary meanings", () => {
    const source =
      "✦ ydc: ipi tığa dolamadan 2\n" +
      "defada çıkarma (yalancı\n" +
      "trabzan)";

    expect(translateGlossaryDeterministically(source, "en")).toBe(
      "✦ ydc: mock double crochet; without yarning over, pull through in 2 steps",
    );
  });

  it("returns undefined for an unknown abbreviation instead of guessing", () => {
    const source = "✦ xyz: bilinmeyen teknik";

    expect(translateGlossaryDeterministically(source, "en")).toBeUndefined();
    expect(isDeterministicGlossary(source)).toBe(false);
  });

  it("returns undefined for an unknown meaning of a known abbreviation", () => {
    const source = "✦ x: tamamen farklı bir açıklama";

    expect(translateGlossaryDeterministically(source, "en")).toBeUndefined();
  });

  it("supports Spanish through the same generic rules", () => {
    const source =
      "✦ zn: zincir\n" +
      "✦ sh: sihirli halka\n" +
      "✦ x: sık iğne";

    expect(translateGlossaryDeterministically(source, "es")).toBe(
      "✦ cad: cadena\n" +
        "✦ am: anillo mágico\n" +
        "✦ pb: punto bajo",
    );
  });
});
