import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROJECT_NOTATION } from "../../glossary.js";
import type { FrameParse, ParseNode } from "../../parser/frame_ir.js";
import { STITCH_COUNT_CONCEPTS, parseFrames } from "../../parser/frame_parser.js";
import { renderUnits } from "../frame_renderer.js";

const render = (source: string) => renderUnits(parseFrames(source), "en");

const texts = (source: string) => render(source).map(({ text }) => text);

const englishAbbreviation = (concept: string) =>
  PROJECT_NOTATION.find((entry) => entry.concept === concept)?.en?.abbreviation;

describe("frame renderer: stitch_count", () => {
  it("renders one canonical lowercase unit with its exact source span", () => {
    expect(render("İpimizi sabitliyoruz. 20x örüyoruz. Başlangıç")).toEqual([
      {
        kind: "stitch_count",
        sourceSpan: { start: 22, end: 34, raw: "20x örüyoruz" },
        text: "work 20sc",
      },
    ]);
  });

  it.each([
    ["18hdc örüyoruz", "work 18hdc"],
    ["3dc örüyoruz", "work 3dc"],
    ["2tr örüyoruz", "work 2tr"],
    ["4esc örüyoruz", "work 4esc"],
  ])("renders %j as %j", (source, text) => {
    expect(texts(source)).toEqual([text]);
  });

  it("reads every stitch abbreviation from the glossary's English entry", () => {
    for (const concept of STITCH_COUNT_CONCEPTS) {
      const form = PROJECT_NOTATION.find((entry) => entry.concept === concept)?.tr.abbreviation;
      expect(texts(`7${form} örüyoruz`)).toEqual([`work 7${englishAbbreviation(concept)}`]);
    }
  });
});

describe("frame renderer: linked chain -> turn pair", () => {
  it("renders the pair as ONE unit covering chain, whitespace and turn", () => {
    expect(render("örebilirsiniz. 1 zincir çekip dönüyoruz.")).toEqual([
      {
        kind: "chain_turn",
        sourceSpan: { start: 15, end: 39, raw: "1 zincir çekip dönüyoruz" },
        text: "ch 1 and turn",
      },
    ]);
  });

  it.each([
    ["20 zincir çekip dönüyoruz,", "ch 20 and turn"],
    ["3 zn çekip dönüyoruz.", "ch 3 and turn"],
    ["1  zincir\tçekip  dönüyoruz", "ch 1 and turn"],
  ])("renders %j as %j", (source, text) => {
    expect(texts(source)).toEqual([text]);
  });

  it("reads the chain abbreviation from the glossary", () => {
    expect(texts("5 zincir çekip dönüyoruz")).toEqual([`${englishAbbreviation("chain")} 5 and turn`]);
  });

  it("renders stitch_count and the pair in source order", () => {
    const units = render("28x örüyoruz.\n1 zincir çekip dönüyoruz.");
    expect(units.map(({ kind, text, sourceSpan }) => [kind, text, sourceSpan.raw])).toEqual([
      ["stitch_count", "work 28sc", "28x örüyoruz"],
      ["chain_turn", "ch 1 and turn", "1 zincir çekip dönüyoruz"],
    ]);
  });

  it("uses UTF-16 offsets for source spans", () => {
    const [unit] = render("🧶.\n1 zincir çekip dönüyoruz");
    expect(unit?.sourceSpan).toEqual({ start: 4, end: 28, raw: "1 zincir çekip dönüyoruz" });
  });
});

describe("frame renderer: never renders chain or turn on its own", () => {
  const source = "1 zincir çekip dönüyoruz.";
  const pair = parseFrames(source);
  const [chain, separator, turn, tail] = pair.nodes as [ParseNode, ParseNode, ParseNode, ParseNode];
  const withNodes = (nodes: ParseNode[]): FrameParse => ({ source, nodes });

  it("renders nothing for a chain without its linked turn", () => {
    expect(
      renderUnits(
        withNodes([chain, { kind: "opaque", span: { start: 14, end: 25, raw: " dönüyoruz." } }]),
        "en",
      ),
    ).toEqual([]);
  });

  it("renders nothing for a turn without its chain", () => {
    expect(
      renderUnits(
        withNodes([{ kind: "opaque", span: { start: 0, end: 15, raw: "1 zincir çekip " } }, turn, tail]),
        "en",
      ),
    ).toEqual([]);
  });

  it("renders nothing when the separator is not whitespace-only", () => {
    const text = "1 zincir çekip.dönüyoruz.";
    expect(
      renderUnits(
        {
          source: text,
          nodes: [chain, { kind: "opaque", span: { start: 14, end: 15, raw: "." } }, turn, tail],
        },
        "en",
      ),
    ).toEqual([]);
    expect(separator).toEqual({ kind: "opaque", span: { start: 14, end: 15, raw: " " } });
  });

  it.each(["1 zincir çekip.", "dönüyoruz.", "3 zincir çekiyoruz.", "34 zincir çekip geriye dönüyoruz."])(
    "renders nothing for %j",
    (text) => {
      expect(render(text)).toEqual([]);
    },
  );
});

describe("frame renderer: course_end_turn is not rendered yet", () => {
  it.each([
    "Bütün sıra sonlarında 1 zincir çekip dönüyoruz.",
    "Sıra sonlarında 1 zincir çekip dönüyoruz.",
    "Sıra sonunda 1 zincir çekip dönüyoruz.",
    "12) Bütün sıra sonlarında 2 zn çekip dönüyoruz.",
  ])("%j yields zero units", (source) => {
    expect(parseFrames(source).nodes.some((node) => node.kind === "frame" && node.action === "course_end_turn")).toBe(
      true,
    );
    expect(render(source)).toEqual([]);
  });

  it("still renders the stitch_count before a course-end clause, and nothing for the clause", () => {
    expect(texts("1) 28x örüyoruz. Bütün sıra sonlarında 1 zincir çekip dönüyoruz.")).toEqual(["work 28sc"]);
  });
});

describe("frame renderer: scope", () => {
  it("produces no units for languages other than English", () => {
    expect(renderUnits(parseFrames("20x örüyoruz. 1 zincir çekip dönüyoruz."), "es")).toEqual([]);
  });

  it("renders nothing for Opaque-only text", () => {
    expect(render("Sihirli halka içine 6x")).toEqual([]);
    expect(render("2 adet Catania TR263 - ten rengi")).toEqual([]);
    expect(render("")).toEqual([]);
  });

  it("is deterministic and does not depend on earlier calls", () => {
    const source = "1) 28x örüyoruz.\n20 zincir çekip dönüyoruz, zincir üzerine";
    const first = render(source);
    render("3dc örüyoruz");
    expect(render(source)).toEqual(first);
  });
});

describe("frame renderer: module hygiene", () => {
  const code = readFileSync(fileURLToPath(new URL("../frame_renderer.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("imports only the glossary at runtime, plus IR and language types", () => {
    const imports = [...code.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map(
      (match) => match[1],
    );
    expect(imports.sort()).toEqual(["../glossary.js", "../parser/frame_ir.js", "../types.js"]);
    expect(code).toMatch(/import type \{[^}]*\} from "\.\.\/parser\/frame_ir\.js"/);
    expect(code).toMatch(/import type \{ TargetLanguage \} from "\.\.\/types\.js"/);
  });

  it("has no hardcoded target stitch abbreviations", () => {
    expect(code).not.toMatch(/["'`](?:sc|hdc|dc|tr|esc|ch)["'`]/);
  });

  it("has no environment, clock, randomness or locale-dependent access", () => {
    expect(code).not.toMatch(/process\.|Date\.now|new Date\(|Math\.random|performance\.now/);
    expect(code).not.toMatch(/localeCompare|Intl\.|toLocale(?:Lower|Upper)Case/);
  });
});
