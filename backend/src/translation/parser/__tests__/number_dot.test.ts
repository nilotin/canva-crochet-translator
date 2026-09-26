import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lexSource } from "../../lexer/typed_lexer.js";
import {
  NumberDotError,
  classifyNumberDot,
  classifyNumberDots,
  isNumberDot,
  type NumberDotKind,
  type NumberDotReason,
} from "../number_dot.js";

/** [raw, kind, reason] for every `N.` in `source`. */
const decisions = (source: string): [string, NumberDotKind, NumberDotReason][] =>
  classifyNumberDots(source).map(({ span, kind, reason }): [string, NumberDotKind, NumberDotReason] => [
    span.raw,
    kind,
    reason,
  ]);

const only = (source: string) => {
  const found = classifyNumberDots(source);
  expect(found).toHaveLength(1);
  return found[0]!;
};

describe("classifyNumberDot: instruction_marker", () => {
  it.each([
    ["alone", "6."],
    ["before prose", "6. Bu kısmı ayrı örüyoruz."],
    ["after leading spaces", "  6. Bu kısmı ayrı örüyoruz."],
    ["after a leading line break", "\n6. Bu kısmı ayrı örüyoruz."],
    ["before a line break", "6.\nBu kısmı ayrı örüyoruz."],
    ["before a stitch count", "12. 6x örüyoruz."],
    ["with a multi-digit number", "53. Bu kısmı ayrı örüyoruz."],
  ])("%s", (_label, source) => {
    expect(only(source)).toMatchObject({ kind: "instruction_marker", reason: "leading-position" });
  });
});

describe("classifyNumberDot: row_round_label", () => {
  it.each([
    ["6. sıra", "6."],
    ["6. sıranın BLO’sundan örüyoruz.", "6."],
    ["11. sırada FLO’dan örüyoruz.", "11."],
    ["12. sıradan başlıyoruz.", "12."],
    ["6.sırada", "6."],
    ["6.\tsırada", "6."],
    ["12. Sıradan başlıyoruz.", "12."],
    ["Görselde görüldüğü gibi, 9. sırada Blo’dan örüyoruz.", "9."],
    ["20x örüyoruz. (26. sırada ilk kolda", "26."],
  ])("%j", (source, raw) => {
    expect(only(source)).toMatchObject({ kind: "row_round_label", reason: "row-word", span: { raw } });
  });

  it("takes precedence over the leading position", () => {
    expect(decisions("6. sıra")).toEqual([["6.", "row_round_label", "row-word"]]);
  });

  it("does not look across a line break or a non-space/tab whitespace run", () => {
    expect(only("6.\nsırada")).toMatchObject({ kind: "instruction_marker", reason: "leading-position" });
    // Row wording after a no-break space is not a label, but it blocks the marker.
    expect(only("6.\u00a0sırada")).toMatchObject({ kind: "ordinal_or_ordinary", reason: "row-stem" });
  });

  it("does not accept other inflections as labels", () => {
    expect(only("Sonra 6. sıraya geçiyoruz.")).toMatchObject({ kind: "ordinal_or_ordinary", reason: "not-leading" });
  });
});

describe("classifyNumberDot: ordinal_or_ordinary", () => {
  it.each([
    ["R1: a leading stitch ordinal", "7. sık iğneye ipimizi sabitliyoruz.", "ordinal-head"],
    ["a leading glossary stitch head", "3. x’e ipimizi sabitliyoruz.", "ordinal-head"],
    ["a leading chain noun", "3. zincir çekip dönüyoruz.", "ordinal-head"],
    ["a leading unlisted row inflection", "6. sıraya geçiyoruz.", "row-stem"],
    ["R2: a mid-block line-start ordinal", "atlıyoruz.\n7. sık iğneye ipimizi sabitliyoruz.", "not-leading"],
    ["a sentence number", "Toplam 3. Sonra dönüyoruz.", "not-leading"],
    ["a repeat count before a period", "(6x, v) x 6. FLO örüyoruz.", "not-leading"],
    ["glued to a letter on the left", "a6. sıra", "attached-left"],
    ["glued to a comma on the left", ",6. sıra", "attached-left"],
    ["glued on the right", "6.x örüyoruz", "attached-right"],
  ])("%s", (_label, source, reason) => {
    expect(classifyNumberDots(source).at(-1)).toMatchObject({ kind: "ordinal_or_ordinary", reason });
  });

  it("keeps a leading number a marker when its head is not in the first-slice lexicon", () => {
    // "zincire" (dative) is not a listed spelling; production claims it as a marker too.
    expect(only("3. zincire ipimizi sabitliyoruz.")).toMatchObject({
      kind: "instruction_marker",
      reason: "leading-position",
    });
  });

  it("uses the second word only for the two-word noun 'sık iğne'", () => {
    expect(only("7. sık iğne")).toMatchObject({ kind: "ordinal_or_ordinary", reason: "ordinal-head" });
    expect(only("7. sık sık dönüyoruz.")).toMatchObject({ kind: "instruction_marker" });
    expect(only("7. Sık iğne")).toMatchObject({ kind: "instruction_marker" });
    expect(only("7.\nsık iğne")).toMatchObject({ kind: "instruction_marker" });
  });

  it("classifies every occurrence in a block independently", () => {
    expect(decisions("1. Bu kısmı ayrı örüyoruz.\n2. sırada 3. ilmeğe geçiyoruz.")).toEqual([
      ["1.", "instruction_marker", "leading-position"],
      ["2.", "row_round_label", "row-word"],
      ["3.", "ordinal_or_ordinary", "not-leading"],
    ]);
  });
});

describe("classifyNumberDot: occurrence boundaries", () => {
  it.each([
    ["a decimal", "2.20 mm"],
    ["a decimal with a comma", "2,5 cm"],
    ["a decimal followed by a period", "Boy 2.5."],
    ["a bracket marker", "1) 28x örüyoruz."],
    ["a number with a space before the period", "6 . sıra"],
    ["no number", "Görselde görüldüğü gibi."],
  ])("finds nothing in %s", (_label, source) => {
    expect(classifyNumberDots(source)).toEqual([]);
  });

  it("accepts only an integer number immediately followed by a '.' token", () => {
    const tokens = lexSource("6. 2.5. 6 . 6,");
    expect(tokens.map((_token, index) => isNumberDot(tokens, index))).toEqual(
      tokens.map((token, index) => index === 0 && token.raw === "6"),
    );
  });

  it("throws for any other token index", () => {
    const source = "6. sıra";
    const tokens = lexSource(source);
    for (const index of [-1, 1, 2, 3, tokens.length]) {
      expect(() => classifyNumberDot(tokens, index, source)).toThrow(NumberDotError);
    }
  });

  it("throws when the tokens do not belong to the source", () => {
    const tokens = lexSource("6. sıra");
    expect(() => classifyNumberDot(tokens, 0, "7. sıra")).toThrow(NumberDotError);
  });
});

describe("classifyNumberDot: spans", () => {
  it("gives the exact number-and-period slice", () => {
    const source = "Toplam 12. Sonra";
    const [decision] = classifyNumberDots(source);
    expect(decision?.span).toEqual({ start: 7, end: 10, raw: "12." });
    expect(source.slice(decision!.span.start, decision!.span.end)).toBe(decision!.span.raw);
  });

  it("uses UTF-16 offsets after astral characters", () => {
    const source = "🧶 🧶\n6. sırada";
    const [decision] = classifyNumberDots(source);
    expect(decision?.span).toEqual({ start: 6, end: 8, raw: "6." });
    expect(decision?.kind).toBe("row_round_label");
    expect(source.slice(6, 8)).toBe("6.");
  });

  it("reports the number token index", () => {
    const source = "  6. Bu";
    const tokens = lexSource(source);
    const [decision] = classifyNumberDots(source);
    expect(tokens[decision!.index]?.raw).toBe("6");
    expect(classifyNumberDot(tokens, decision!.index, source)).toEqual(decision);
  });
});

describe("classifyNumberDot: purity", () => {
  const source = "1. Bu kısmı ayrı örüyoruz.\n2. sırada 3. ilmeğe geçiyoruz.";

  it("is deterministic", () => {
    expect(classifyNumberDots(source)).toEqual(classifyNumberDots(source));
  });

  it("does not mutate its tokens", () => {
    const tokens = lexSource(source);
    const snapshot = structuredClone(tokens);
    classifyNumberDot(tokens, 0, source);
    expect(tokens).toEqual(snapshot);
  });
});

describe("number_dot: module contract", () => {
  const code = readFileSync(fileURLToPath(new URL("../number_dot.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("imports only the lexer, the IR types and the parser lexicon", () => {
    const imports = [...code.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((match) => match[1]);
    expect(imports.sort()).toEqual(["../lexer/typed_lexer.js", "./frame_ir.js", "./frame_parser.js"]);
    expect(code).not.toMatch(/instruction_marker\.js|round_references|normalizer|translator|validator|provider|prompt/);
  });

  it("has no clause regexes: only single-token character-class checks", () => {
    expect(code).not.toMatch(/matchAll|\.match\(|\.exec\(|\.replace\(|\.search\(|new RegExp/);
    const tested = [...code.matchAll(/(\w+)\.test\(/g)].map((match) => match[1]);
    expect(new Set(tested)).toEqual(new Set(["DIGITS_ONLY", "SPACES_OR_TABS"]));
    expect(code).toMatch(/const DIGITS_ONLY = \/\^\[0-9\]\+\$\/;/);
    expect(code).toMatch(/const SPACES_OR_TABS = \/\^\[ \\t\]\+\$\/;/);
  });

  it("uses no clock, randomness, environment or locale-dependent API", () => {
    expect(code).not.toMatch(/process\.|Date\.now|new Date\(|Math\.random|performance\.now/);
    expect(code).not.toMatch(/localeCompare|Intl\.|toLocale(?:Lower|Upper)Case/);
  });
});
