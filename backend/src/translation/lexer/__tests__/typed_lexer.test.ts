import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCorpus } from "../../__tests__/corpus/load_corpus.js";
import {
  isGlossaryAbbreviation,
  lexInvariantIssues,
  lexSource,
  reconstructSource,
  type LexToken,
} from "../typed_lexer.js";

const pairs = (source: string): [LexToken["kind"], string][] =>
  lexSource(source).map(({ kind, raw }) => [kind, raw]);

const exact = (source: string): LexToken[] => {
  const tokens = lexSource(source);
  expect(lexInvariantIssues(source, tokens)).toEqual([]);
  return tokens;
};

const reproSource = (hazard: string): string => {
  const repro = loadCorpus().cases.find(
    ({ value }) => value.lane === "repro" && value.labels.hazards.includes(hazard),
  );
  const text = repro?.value.request.blocks[0]?.text;
  if (text === undefined) throw new Error(`No repro for hazard ${hazard}.`);
  return text;
};

describe("typed lexer: exact source coverage", () => {
  it.each([
    "",
    "26) 20x, 6v, 10x, 6v, 24x = 78x",
    "✦ Bu sıradan sonra kol ve \ngövdeye teli takabilirsiniz.\n4) (7x, 1e)*6 = 48x",
    "a  \t b\u00a0c\u202fd\r\ne\n\nf\u2028g",
    "Emoji 🧶 ve 🪡 ile 6x",
    "Lone \ud800 surrogate and \udc00 low",
    "Decomposed i\u0307 and precomposed é",
    "__XQAAAAQX__ placeholder-shaped text",
  ])("reconstructs %j exactly with valid, contiguous spans", (source) => {
    const tokens = exact(source);
    expect(reconstructSource(tokens)).toBe(source);
    for (const token of tokens) {
      expect(token.raw).toBe(source.slice(token.start, token.end));
    }
  });

  it("uses UTF-16 offsets and never splits a surrogate pair", () => {
    const source = "6x 🧶 v";
    const tokens = exact(source);
    const yarn = tokens.find(({ raw }) => raw === "🧶");
    expect(yarn).toMatchObject({ kind: "other", start: 3, end: 5 });
    expect(tokens.at(-1)).toMatchObject({ kind: "abbreviation", start: 6, end: 7 });
  });

  it("keeps a lone surrogate as its own one-unit token", () => {
    expect(pairs("a\ud800b")).toEqual([
      ["word", "a"],
      ["other", "\ud800"],
      ["word", "b"],
    ]);
  });

  it("keeps combining marks inside the word and never normalizes", () => {
    expect(pairs("Di\u0307ğer")).toEqual([["word", "Di\u0307ğer"]]);
    const decomposed = "Cafe\u0301";
    expect(pairs(decomposed)).toEqual([["word", decomposed]]);
    expect(decomposed).not.toBe(decomposed.normalize("NFC"));
  });

  it("is deterministic and does not depend on earlier calls", () => {
    const source = "1) (6x, v) x 6. FLO örüyoruz.\n2) 24x";
    const first = lexSource(source);
    lexSource("Sihirli halka içine 6x");
    expect(lexSource(source)).toEqual(first);
  });

  it("reports gaps, overlaps and bad raw text", () => {
    const source = "6x ile";
    const tokens = lexSource(source);
    expect(lexInvariantIssues(source, tokens.slice(1))).not.toEqual([]);
    expect(lexInvariantIssues(source, [...tokens, tokens[0]!])).not.toEqual([]);
    expect(
      lexInvariantIssues(source, [{ ...tokens[0]!, raw: "7" } as LexToken, ...tokens.slice(1)]),
    ).not.toEqual([]);
  });
});

describe("typed lexer: crochet notation forms (lexical only)", () => {
  it("splits compact counts into number + abbreviation, adjacent with no gap", () => {
    const tokens = exact("20x 6v 1e 18hdc");
    expect(tokens.map(({ kind, raw }) => [kind, raw])).toEqual([
      ["number", "20"],
      ["abbreviation", "x"],
      ["whitespace", " "],
      ["number", "6"],
      ["abbreviation", "v"],
      ["whitespace", " "],
      ["number", "1"],
      ["abbreviation", "e"],
      ["whitespace", " "],
      ["number", "18"],
      ["abbreviation", "hdc"],
    ]);
    expect(tokens[0]?.end).toBe(tokens[1]?.start);
  });

  it("lexes a row prefix, compact stitches and an equals total", () => {
    expect(pairs("26) 20x, 6v, 10x = 36x")).toEqual([
      ["number", "26"],
      ["bracket", ")"],
      ["whitespace", " "],
      ["number", "20"],
      ["abbreviation", "x"],
      ["punctuation", ","],
      ["whitespace", " "],
      ["number", "6"],
      ["abbreviation", "v"],
      ["punctuation", ","],
      ["whitespace", " "],
      ["number", "10"],
      ["abbreviation", "x"],
      ["whitespace", " "],
      ["operator", "="],
      ["whitespace", " "],
      ["number", "36"],
      ["abbreviation", "x"],
    ]);
  });

  it("lexes a range prefix as number, dash, number without deciding it is a range", () => {
    expect(pairs("12-23) 12 sıra 66x")).toEqual([
      ["number", "12"],
      ["dash", "-"],
      ["number", "23"],
      ["bracket", ")"],
      ["whitespace", " "],
      ["number", "12"],
      ["whitespace", " "],
      ["word", "sıra"],
      ["whitespace", " "],
      ["number", "66"],
      ["abbreviation", "x"],
    ]);
  });

  it("lexes repetition groups and leaves x-as-multiplier to the parser", () => {
    expect(pairs("(7x, 1e)*6 = 48x")).toEqual([
      ["bracket", "("],
      ["number", "7"],
      ["abbreviation", "x"],
      ["punctuation", ","],
      ["whitespace", " "],
      ["number", "1"],
      ["abbreviation", "e"],
      ["bracket", ")"],
      ["operator", "*"],
      ["number", "6"],
      ["whitespace", " "],
      ["operator", "="],
      ["whitespace", " "],
      ["number", "48"],
      ["abbreviation", "x"],
    ]);
    // The same lexical form, whatever its role: stitch or multiplier.
    expect(pairs("(6x, v) x 6.")).toEqual([
      ["bracket", "("],
      ["number", "6"],
      ["abbreviation", "x"],
      ["punctuation", ","],
      ["whitespace", " "],
      ["abbreviation", "v"],
      ["bracket", ")"],
      ["whitespace", " "],
      ["abbreviation", "x"],
      ["whitespace", " "],
      ["number", "6"],
      ["punctuation", "."],
    ]);
  });

  it("lexes FLO/BLO in any casing and keeps the Turkish suffix as a separate word", () => {
    expect(pairs("6. sıranın BLO’sundan")).toEqual([
      ["number", "6"],
      ["punctuation", "."],
      ["whitespace", " "],
      ["word", "sıranın"],
      ["whitespace", " "],
      ["abbreviation", "BLO"],
      ["punctuation", "’"],
      ["word", "sundan"],
    ]);
    expect(pairs("Blo’dan Flo flo’ lar")).toEqual([
      ["abbreviation", "Blo"],
      ["punctuation", "’"],
      ["word", "dan"],
      ["whitespace", " "],
      ["abbreviation", "Flo"],
      ["whitespace", " "],
      ["abbreviation", "flo"],
      ["punctuation", "’"],
      ["whitespace", " "],
      ["word", "lar"],
    ]);
    // U+02BC is a letter in Unicode, but lexically it is an apostrophe.
    expect(pairs("BLO\u02bcsundan")).toEqual([
      ["abbreviation", "BLO"],
      ["punctuation", "\u02bc"],
      ["word", "sundan"],
    ]);
  });

  it("lexes chain counts: the word zincir and the abbreviation zn", () => {
    expect(pairs("1 zincir çekip, 3 zn")).toEqual([
      ["number", "1"],
      ["whitespace", " "],
      ["word", "zincir"],
      ["whitespace", " "],
      ["word", "çekip"],
      ["punctuation", ","],
      ["whitespace", " "],
      ["number", "3"],
      ["whitespace", " "],
      ["abbreviation", "zn"],
    ]);
  });

  it("recognizes only whole letter runs that are glossary forms", () => {
    expect(pairs("xenon xxxx x")).toEqual([
      ["word", "xenon"],
      ["whitespace", " "],
      ["word", "xxxx"],
      ["whitespace", " "],
      ["abbreviation", "x"],
    ]);
    expect(isGlossaryAbbreviation("CC")).toBe(true);
    expect(isGlossaryAbbreviation("cc")).toBe(true);
    expect(isGlossaryAbbreviation("sh")).toBe(true);
    expect(isGlossaryAbbreviation("zincir")).toBe(false);
  });

  it("treats M as case-sensitive: M is notation, m is a word (also a length unit)", () => {
    expect(pairs("3M 2 m")).toEqual([
      ["number", "3"],
      ["abbreviation", "M"],
      ["whitespace", " "],
      ["number", "2"],
      ["whitespace", " "],
      ["word", "m"],
    ]);
  });
});

describe("typed lexer: numbers, measurements and materials (lexical only)", () => {
  it("keeps decimals whole and leaves units to the parser", () => {
    expect(pairs("2.20 mm tığ, 55cm, 2,5 cm, 2.5mm")).toEqual([
      ["number", "2.20"],
      ["whitespace", " "],
      ["word", "mm"],
      ["whitespace", " "],
      ["word", "tığ"],
      ["punctuation", ","],
      ["whitespace", " "],
      ["number", "55"],
      ["word", "cm"],
      ["punctuation", ","],
      ["whitespace", " "],
      ["number", "2,5"],
      ["whitespace", " "],
      ["word", "cm"],
      ["punctuation", ","],
      ["whitespace", " "],
      ["number", "2.5"],
      ["word", "mm"],
    ]);
  });

  it("does not treat a trailing period or comma as a decimal part", () => {
    expect(pairs("6. 7, 8.")).toEqual([
      ["number", "6"],
      ["punctuation", "."],
      ["whitespace", " "],
      ["number", "7"],
      ["punctuation", ","],
      ["whitespace", " "],
      ["number", "8"],
      ["punctuation", "."],
    ]);
  });

  it("lexes a product code as letters then digits", () => {
    expect(pairs("2 adet Catania TR263")).toEqual([
      ["number", "2"],
      ["whitespace", " "],
      ["word", "adet"],
      ["whitespace", " "],
      ["word", "Catania"],
      ["whitespace", " "],
      ["abbreviation", "TR"],
      ["number", "263"],
    ]);
  });
});

describe("typed lexer: punctuation, whitespace and markers", () => {
  it("keeps every whitespace run and line break exactly", () => {
    expect(pairs("a  \t b\u00a0c\r\nd\n\nf")).toEqual([
      ["word", "a"],
      ["whitespace", "  \t "],
      ["word", "b"],
      ["whitespace", "\u00a0"],
      ["word", "c"],
      ["line_break", "\r\n"],
      ["word", "d"],
      ["line_break", "\n"],
      ["line_break", "\n"],
      ["word", "f"],
    ]);
  });

  it("lexes Unicode list markers and dashes as single tokens", () => {
    expect(pairs("✦ Kulak\n• Kaş – göz—burun")).toEqual([
      ["marker", "✦"],
      ["whitespace", " "],
      ["word", "Kulak"],
      ["line_break", "\n"],
      ["marker", "•"],
      ["whitespace", " "],
      ["word", "Kaş"],
      ["whitespace", " "],
      ["dash", "–"],
      ["whitespace", " "],
      ["word", "göz"],
      ["dash", "—"],
      ["word", "burun"],
    ]);
  });

  it("lexes brackets, quotes and other punctuation one character at a time", () => {
    expect(pairs("(düğme iliği); “not”: ok!")).toEqual([
      ["bracket", "("],
      ["word", "düğme"],
      ["whitespace", " "],
      ["word", "iliği"],
      ["bracket", ")"],
      ["punctuation", ";"],
      ["whitespace", " "],
      ["punctuation", "“"],
      ["word", "not"],
      ["punctuation", "”"],
      ["punctuation", ":"],
      ["whitespace", " "],
      ["word", "ok"],
      ["punctuation", "!"],
    ]);
  });
});

describe("typed lexer: real pattern sentences", () => {
  it("lexes mixed prose and notation, leaving prose as plain word tokens", () => {
    expect(pairs("1) 28x örüyoruz, 1 zincir çekip dönüyoruz.")).toEqual([
      ["number", "1"],
      ["bracket", ")"],
      ["whitespace", " "],
      ["number", "28"],
      ["abbreviation", "x"],
      ["whitespace", " "],
      ["word", "örüyoruz"],
      ["punctuation", ","],
      ["whitespace", " "],
      ["number", "1"],
      ["whitespace", " "],
      ["word", "zincir"],
      ["whitespace", " "],
      ["word", "çekip"],
      ["whitespace", " "],
      ["word", "dönüyoruz"],
      ["punctuation", "."],
    ]);
  });

  it("lexes the magic-ring instructions", () => {
    expect(pairs("Sihirli halka içine 6x")).toEqual([
      ["word", "Sihirli"],
      ["whitespace", " "],
      ["word", "halka"],
      ["whitespace", " "],
      ["word", "içine"],
      ["whitespace", " "],
      ["number", "6"],
      ["abbreviation", "x"],
    ]);
    expect(pairs("1. 6x ile sh oluşturuyoruz.")).toEqual([
      ["number", "1"],
      ["punctuation", "."],
      ["whitespace", " "],
      ["number", "6"],
      ["abbreviation", "x"],
      ["whitespace", " "],
      ["word", "ile"],
      ["whitespace", " "],
      ["abbreviation", "sh"],
      ["whitespace", " "],
      ["word", "oluşturuyoruz"],
      ["punctuation", "."],
    ]);
  });

  it("lexes the eye-placement round", () => {
    const source =
      "24) 15x, 2 zincir 2x atla, 9x, 2 zincir 2x atla, 38x (zincirlerle oluşturduğumuz boşluklara daha sonra gözleri takacağız)";
    const tokens = exact(source);
    expect(tokens.slice(0, 6).map(({ kind, raw }) => [kind, raw])).toEqual([
      ["number", "24"],
      ["bracket", ")"],
      ["whitespace", " "],
      ["number", "15"],
      ["abbreviation", "x"],
      ["punctuation", ","],
    ]);
    const parenthetical = tokens.slice(tokens.findIndex(({ raw }) => raw === "("));
    expect(parenthetical.map(({ kind }) => kind)).toEqual([
      "bracket",
      ...Array.from({ length: 6 }, () => ["word", "whitespace"]).flat(),
      "word",
      "bracket",
    ]);
    expect(parenthetical.filter(({ kind }) => kind === "word").map(({ raw }) => raw)).toEqual([
      "zincirlerle",
      "oluşturduğumuz",
      "boşluklara",
      "daha",
      "sonra",
      "gözleri",
      "takacağız",
    ]);
  });
});

describe("typed lexer: ordinal repros R1 and R2 (tokenized, NOT fixed)", () => {
  // The lexer only exposes the characters. Whether "7." is a list marker or an
  // ordinal is a frame-parser decision; replay of R1/R2 is unaffected because
  // no production module uses this lexer.
  it("R1: a block-leading ordinal is number + period, not an instruction marker", () => {
    const source = reproSource("ordinal-at-block-start");
    expect(source).toBe("7. sık iğneye ipimizi sabitliyoruz.");
    expect(pairs(source)).toEqual([
      ["number", "7"],
      ["punctuation", "."],
      ["whitespace", " "],
      ["word", "sık"],
      ["whitespace", " "],
      ["word", "iğneye"],
      ["whitespace", " "],
      ["word", "ipimizi"],
      ["whitespace", " "],
      ["word", "sabitliyoruz"],
      ["punctuation", "."],
    ]);
  });

  it("R2: the mid-block ordinal keeps its line break and period as separate tokens", () => {
    const source = reproSource("ordinal-mid-block");
    const tokens = exact(source);
    const seven = tokens.findIndex(({ kind, raw }) => kind === "number" && raw === "7");
    expect(tokens.slice(seven - 2, seven + 3).map(({ kind, raw }) => [kind, raw])).toEqual([
      ["punctuation", "."],
      ["line_break", "\n"],
      ["number", "7"],
      ["punctuation", "."],
      ["whitespace", " "],
    ]);
    expect(tokens.filter(({ kind }) => kind === "line_break")).toHaveLength(2);
  });
});

describe("typed lexer: module hygiene", () => {
  const code = readFileSync(
    fileURLToPath(new URL("../typed_lexer.ts", import.meta.url)),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("imports only the glossary data", () => {
    const imports = [...code.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map(
      (match) => match[1],
    );
    expect(imports).toEqual(["../glossary.js"]);
  });

  it("has no environment, clock, randomness or locale-dependent access", () => {
    expect(code).not.toMatch(/process\.|Date\.now|new Date\(|Math\.random|performance\.now/);
    expect(code).not.toMatch(/localeCompare|Intl\.|toLocale(?:Lower|Upper)Case/);
    expect(code).not.toMatch(/\.normalize\(/);
  });
});
