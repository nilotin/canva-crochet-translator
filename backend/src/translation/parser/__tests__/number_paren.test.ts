import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lexSource } from "../../lexer/typed_lexer.js";
import {
  NumberParenError,
  classifyNumberParen,
  classifyNumberParens,
  isNumberParen,
  type NumberParenDecision,
} from "../number_paren.js";

const only = (source: string): NumberParenDecision => {
  const found = classifyNumberParens(source);
  expect(found).toHaveLength(1);
  return found[0]!;
};

/** [raw, kind, reason] for every occurrence in `source`. */
const decisions = (source: string): [string, string, string][] =>
  classifyNumberParens(source).map(({ span, kind, reason }): [string, string, string] => [span.raw, kind, reason]);

describe("classifyNumberParen: single markers", () => {
  it.each([
    ["1) 6x", "1)", 1],
    ["12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.", "12)", 12],
    ["13) 5 sıra 16x", "13)", 13],
    ["0) 6x", "0)", 0],
    ["01) 6x", "01)", 1],
    ["12)", "12)", 12],
    ["12)\n6x", "12)", 12],
  ] as const)("%j", (source, raw, value) => {
    expect(only(source)).toEqual({
      kind: "instruction_marker",
      reason: "leading-line",
      first: value,
      last: value,
      span: { start: 0, end: raw.length, raw },
      index: 0,
    });
  });
});

describe("classifyNumberParen: range markers", () => {
  it("widens a range to the whole marker and exposes first and last", () => {
    expect(only("2-25) 24 sıra 20x")).toEqual({
      kind: "instruction_marker",
      reason: "leading-line",
      first: 2,
      last: 25,
      span: { start: 0, end: 5, raw: "2-25)" },
      index: 2,
    });
  });

  it("does not check range ordering", () => {
    expect(only("25-2) 6x")).toMatchObject({ kind: "instruction_marker", first: 25, last: 2 });
    expect(only("7-7) 6x")).toMatchObject({ kind: "instruction_marker", first: 7, last: 7 });
  });

  it("applies the leading and right-attachment rules to the whole range", () => {
    expect(only("Sonra 2-25) 6x")).toMatchObject({ kind: "ordinary", reason: "not-leading", span: { raw: "2-25)" } });
    expect(only("2-25)x")).toMatchObject({ kind: "ordinary", reason: "attached-right", span: { raw: "2-25)" } });
  });

  it.each([
    ["12 - 13) 6x", "spaces around the dash"],
    ["12- 13) 6x", "space after the dash"],
    ["12–13) 6x", "en dash"],
    ["12—13) 6x", "em dash"],
  ])("%j is not a range (%s): only the second number is an occurrence, and it is not leading", (source) => {
    expect(only(source)).toMatchObject({ kind: "ordinary", reason: "not-leading", span: { raw: "13)" } });
  });
});

describe("classifyNumberParen: leading-line position", () => {
  it.each([
    ["leading spaces", "  12) 6x", 2],
    ["a leading tab", "\t12) 6x", 1],
    ["a leading line break", "\n12) 6x", 1],
    ["blank lines before it", "\n\n  12) 6x", 4],
    ["a CRLF line break", "Başlık\r\n12) 6x", 8],
  ] as const)("admits %s", (_label, source, start) => {
    expect(only(source)).toMatchObject({ kind: "instruction_marker", span: { start, raw: "12)" } });
  });

  it("classifies several markers on separate lines", () => {
    expect(decisions("1) 6x\n2) 12x\n  3-5) 18x")).toEqual([
      ["1)", "instruction_marker", "leading-line"],
      ["2)", "instruction_marker", "leading-line"],
      ["3-5)", "instruction_marker", "leading-line"],
    ]);
  });

  it.each([
    ["(12) 6x", "a parenthesized number"],
    ["abc 12) 6x", "prose before it"],
    ["x 6. FLO 12) örüyoruz", "notation before it"],
    ["- 12) 6x", "a dash bullet before it"],
    ["-12) 6x", "a sign"],
    ["İpimizi (catania 110) ile başlıyoruz.", "a parenthesized number in prose"],
  ])("rejects %j (%s)", (source) => {
    expect(only(source)).toMatchObject({ kind: "ordinary", reason: "not-leading" });
  });
});

describe("classifyNumberParen: right attachment", () => {
  it.each([
    ["12)abc", "12)"],
    ["12))", "12)"],
    ["1)Sıra sonunda 1 zincir çekip dönüyoruz.", "1)"],
    ["12),", "12)"],
  ])("%j is ordinary", (source, raw) => {
    expect(only(source)).toMatchObject({ kind: "ordinary", reason: "attached-right", span: { raw } });
  });
});

describe("classifyNumberParen: numbers", () => {
  it("classifies an unsafe integer as ordinary", () => {
    expect(only("99999999999999999) 6x")).toMatchObject({
      kind: "ordinary",
      reason: "unsafe-number",
      span: { raw: "99999999999999999)" },
    });
    expect(only("1-99999999999999999) 6x")).toMatchObject({ kind: "ordinary", reason: "unsafe-number" });
    expect(only("99999999999999999-2) 6x")).toMatchObject({
      kind: "ordinary",
      reason: "unsafe-number",
      span: { raw: "99999999999999999-2)" },
    });
  });

  it.each([
    ["1.5) 6x", "a decimal"],
    ["1,5) 6x", "a decimal with a comma"],
    ["12 ) 6x", "a space before the bracket"],
    ["12] 6x", "another bracket"],
    ["Hiç sayı yok.", "no number"],
  ])("finds no occurrence in %j (%s)", (source) => {
    expect(classifyNumberParens(source)).toEqual([]);
  });
});

describe("classifyNumberParen: spans", () => {
  it("gives exact source slices", () => {
    const source = "Başlık\n  2-25) 24 sıra 20x\n26) 20x";
    for (const decision of classifyNumberParens(source)) {
      expect(source.slice(decision.span.start, decision.span.end)).toBe(decision.span.raw);
    }
    expect(decisions(source).map(([raw]) => raw)).toEqual(["2-25)", "26)"]);
  });

  it("uses UTF-16 offsets after astral characters", () => {
    const source = "🧶🧶\n12) 6x";
    expect(only(source).span).toEqual({ start: 5, end: 8, raw: "12)" });
  });

  it("reports the index of the number before the bracket", () => {
    const source = "2-25) 6x";
    const tokens = lexSource(source);
    const decision = only(source);
    expect(tokens[decision.index]?.raw).toBe("25");
    expect(classifyNumberParen(tokens, decision.index, source)).toEqual(decision);
  });
});

describe("classifyNumberParen: occurrences and errors", () => {
  it("accepts only an integer number immediately followed by a ')' bracket", () => {
    const tokens = lexSource("12) 1.5) 12 ) 2-25)");
    expect(
      tokens.flatMap((token, index) => (isNumberParen(tokens, index) ? [token.raw] : [])),
    ).toEqual(["12", "25"]);
  });

  it("throws for any other token index", () => {
    const source = "2-25) 6x";
    const tokens = lexSource(source);
    for (const index of [-1, 0, 1, 3, 4, tokens.length]) {
      expect(() => classifyNumberParen(tokens, index, source)).toThrow(NumberParenError);
    }
  });

  it("throws when the tokens do not belong to the source", () => {
    expect(() => classifyNumberParen(lexSource("12) 6x"), 0, "13) 6x")).toThrow(NumberParenError);
    expect(() => classifyNumberParen(lexSource("2-25) 6x"), 2, "3-25) 6x")).toThrow(NumberParenError);
  });
});

describe("classifyNumberParen: purity", () => {
  const source = "1) 6x\nSonra (catania 110) ile\n2-25) 24 sıra 20x";

  it("is deterministic", () => {
    expect(classifyNumberParens(source)).toEqual(classifyNumberParens(source));
  });

  it("does not mutate its tokens", () => {
    const tokens = lexSource(source);
    const snapshot = structuredClone(tokens);
    for (const [index] of tokens.entries()) {
      if (isNumberParen(tokens, index)) classifyNumberParen(tokens, index, source);
    }
    expect(tokens).toEqual(snapshot);
  });
});

describe("number_paren: module contract", () => {
  const code = readFileSync(fileURLToPath(new URL("../number_paren.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("imports only the lexer and the IR types", () => {
    const imports = [...code.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((match) => match[1]);
    expect(imports.sort()).toEqual(["../lexer/typed_lexer.js", "./frame_ir.js"]);
    expect(code).not.toMatch(/instruction_marker\.js|segmentation|normalizer|translator|validator|provider|prompt/);
  });

  it("has no clause regexes: only the single-token digit check", () => {
    expect(code).not.toMatch(/matchAll|\.match\(|\.exec\(|\.replace\(|\.search\(|new RegExp/);
    expect(new Set([...code.matchAll(/(\w+)\.test\(/g)].map((match) => match[1]))).toEqual(new Set(["DIGITS_ONLY"]));
    expect(code).toMatch(/const DIGITS_ONLY = \/\^\[0-9\]\+\$\/;/);
  });

  it("uses no clock, randomness, environment or locale-dependent API", () => {
    expect(code).not.toMatch(/process\.|Date\.now|new Date\(|Math\.random|performance\.now/);
    expect(code).not.toMatch(/localeCompare|Intl\.|toLocale(?:Lower|Upper)Case/);
  });
});
