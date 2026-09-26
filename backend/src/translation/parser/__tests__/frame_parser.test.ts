import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCorpus } from "../../__tests__/corpus/load_corpus.js";
import { PROJECT_NOTATION } from "../../glossary.js";
import {
  parseInvariantIssues,
  reconstructParse,
  type FrameParse,
  type StitchCountFrame,
} from "../frame_ir.js";
import {
  STITCH_COUNT_CONCEPTS,
  STITCH_COUNT_FORMS,
  parseFrames,
} from "../frame_parser.js";

const exact = (source: string): FrameParse => {
  const parse = parseFrames(source);
  expect(parseInvariantIssues(parse)).toEqual([]);
  expect(reconstructParse(parse.nodes)).toBe(source);
  return parse;
};

/** `["frame", raw]` or `["opaque", raw]` per node. */
const shape = (source: string): [string, string][] =>
  exact(source).nodes.map((node) => [node.kind, node.span.raw]);

/** The stitch_count frames of a parse (the family these tests cover). */
const frames = (source: string) =>
  exact(source).nodes.filter(
    (node): node is StitchCountFrame => node.kind === "frame" && node.action === "stitch_count",
  );

const allOpaque = (source: string): void => {
  expect(shape(source)).toEqual(source === "" ? [] : [["opaque", source]]);
};

describe("stitch_count lexicon", () => {
  it("derives every accepted spelling from PROJECT_NOTATION, one per admitted concept", () => {
    const fromGlossary = new Map(
      PROJECT_NOTATION.filter((entry) => STITCH_COUNT_CONCEPTS.includes(entry.concept)).map(
        (entry): [string, string] => [entry.tr.abbreviation, entry.concept],
      ),
    );
    expect([...STITCH_COUNT_FORMS]).toEqual([...fromGlossary]);
    expect([...STITCH_COUNT_FORMS.values()].sort()).toEqual([...STITCH_COUNT_CONCEPTS].sort());
  });

  it("maps x to the glossary's single_crochet concept", () => {
    expect(STITCH_COUNT_FORMS.get("x")).toBe("single_crochet");
  });

  it("does not admit increase, decrease, slip stitch, loop-mode or magic-ring concepts", () => {
    for (const concept of [
      "increase",
      "decrease",
      "slip_stitch",
      "front_loop_only",
      "back_loop_only",
      "magic_ring",
      "chain",
      "decrease_three_single_crochet",
    ]) {
      expect([...STITCH_COUNT_FORMS.values()]).not.toContain(concept);
    }
  });
});

describe("stitch_count: recognized clauses", () => {
  it("recognizes a compact count, a glossary stitch form and the finite verb as ONE frame", () => {
    const [frame] = frames("6x örüyoruz");
    expect(frame).toEqual({
      kind: "frame",
      action: "stitch_count",
      span: { start: 0, end: 11, raw: "6x örüyoruz" },
      slots: {
        count: { span: { start: 0, end: 1, raw: "6" }, value: 6 },
        stitch: { span: { start: 1, end: 2, raw: "x" }, concept: "single_crochet" },
        verb: { span: { start: 3, end: 11, raw: "örüyoruz" }, form: "finite" },
      },
    });
  });

  it.each([
    ["18hdc örüyoruz", "half_double_crochet", 18],
    ["3dc örüyoruz", "double_crochet", 3],
    ["2tr örüyoruz", "treble_crochet", 2],
    ["4esc örüyoruz", "extended_single_crochet", 4],
    ["120x örüyoruz", "single_crochet", 120],
  ] as const)("recognizes %s", (source, concept, value) => {
    const [frame] = frames(source);
    expect(frame?.span.raw).toBe(source);
    expect(frame?.slots.stitch.concept).toBe(concept);
    expect(frame?.slots.count.value).toBe(value);
  });

  it.each(["6x  örüyoruz", "6x\törüyoruz", "6x\u00a0örüyoruz", " \t6x örüyoruz \t"])(
    "accepts horizontal whitespace variation: %j",
    (source) => {
      const [frame] = frames(source);
      expect(frame?.slots.count.span.raw).toBe("6");
      expect(frame?.slots.verb.span.raw).toBe("örüyoruz");
    },
  );

  it("keeps boundary punctuation and surrounding text as Opaque", () => {
    expect(shape("26) 13x örüyoruz (kolun üzerindeki kısmı öreceğiz).")).toEqual([
      ["opaque", "26) "],
      ["frame", "13x örüyoruz"],
      ["opaque", " (kolun üzerindeki kısmı öreceğiz)."],
    ]);
    expect(shape("1) 28x örüyoruz, 1 zincir çekip dönüyoruz.")).toEqual([
      ["opaque", "1) "],
      ["frame", "28x örüyoruz"],
      ["opaque", ", 1 zincir çekip dönüyoruz."],
    ]);
    expect(shape("İpimizi sabitliyoruz. 20x örüyoruz. Başlangıç noktamız burası olacak.")).toEqual([
      ["opaque", "İpimizi sabitliyoruz. "],
      ["frame", "20x örüyoruz"],
      ["opaque", ". Başlangıç noktamız burası olacak."],
    ]);
  });

  it("produces Frame + Opaque + Frame for two clauses on separate lines", () => {
    expect(shape("6x örüyoruz.\n3dc örüyoruz.")).toEqual([
      ["frame", "6x örüyoruz"],
      ["opaque", ".\n"],
      ["frame", "3dc örüyoruz"],
      ["opaque", "."],
    ]);
  });

  it("uses UTF-16 offsets for every span", () => {
    const source = "🧶.\n12x örüyoruz";
    const [frame] = frames(source);
    expect(frame?.span).toEqual({ start: 4, end: 16, raw: "12x örüyoruz" });
    expect(frame?.slots.count.span).toEqual({ start: 4, end: 6, raw: "12" });
    expect(frame?.slots.stitch.span).toEqual({ start: 6, end: 7, raw: "x" });
    expect(frame?.slots.verb.span).toEqual({ start: 8, end: 16, raw: "örüyoruz" });
  });

  it("is deterministic and does not depend on earlier calls", () => {
    const source = "1) 28x örüyoruz, 1 zincir çekip dönüyoruz.\n2) 3dc örüyoruz.";
    const first = parseFrames(source);
    parseFrames("6x örüyoruz");
    expect(parseFrames(source)).toEqual(first);
  });
});

describe("stitch_count: near misses stay Opaque", () => {
  it.each([
    ["6X örüyoruz", "stitch spelling differs from the glossary form"],
    ["6Dc örüyoruz", "stitch spelling differs from the glossary form"],
    ["6x Örüyoruz", "verb spelling is not in the lexicon"],
    ["6 x örüyoruz", "count and stitch are not adjacent"],
    ["6x\nörüyoruz", "a line break separates stitch and verb"],
    ["2.5x örüyoruz", "the count is not a whole number"],
    ["6v örüyoruz", "increase is a different family"],
    ["6e örüyoruz", "decrease is a different family"],
    ["6x örüp", "converb: linked to another action"],
    ["13x ördüğümde", "participle, not the finite verb"],
    ["6x örüyoruzdur", "a different word"],
    ["x örüyoruz", "no count"],
    ["FLO örüyoruz", "loop mode, not a stitch count"],
    ["6x sayıp atlıyoruz", "different verbs"],
  ])("%j (%s)", (source) => {
    allOpaque(source);
  });

  it("does not read a loop-mode clause after a repetition group as a stitch count", () => {
    allOpaque("1) (6x, v) x 6. FLO örüyoruz.");
  });

  it("does not parse product codes, measurements or materials text", () => {
    allOpaque("2 adet Catania TR263 - ten rengi\n1 adet Catania 110 - siyah");
    allOpaque("2.20 mm tığ ile örüyoruz.");
    allOpaque("Süet ipimiz yoksa da 55cm tütün rengi ip ile zincir çekip aynı işlemi yapabiliriz.");
  });

  it("leaves the magic-ring and eye-placement instructions Opaque", () => {
    allOpaque("Sihirli halka içine 6x");
    allOpaque("1. 6x ile sh oluşturuyoruz.");
    allOpaque(
      "24) 15x, 2 zincir 2x atla, 9x, 2 zincir 2x atla, 38x (zincirlerle oluşturduğumuz boşluklara daha sonra gözleri takacağız)",
    );
  });
});

describe("stitch_count: outside the FIRST migrated slice (admission rule, not grammar)", () => {
  // These are meaningful Turkish stitch-count clauses. They stay Opaque only
  // because this first slice admits a clause at a clean clause boundary. A
  // later task may admit them together with the context they need; changing
  // these expectations then is intended, not a regression.
  it.each([
    ["26. sırada ilk kolda 13x örüyoruz.", "preceded by an adjunct"],
    ["12) 66x örüyoruz ipimizi kesmeden devam ediyoruz.", "followed directly by another clause"],
    ["20x, 6x örüyoruz.", "shares its verb with an earlier list item"],
  ])("%j is not admitted yet (%s)", (source) => {
    expect(frames(source)).toEqual([]);
  });
});

describe("ordinal repros stay unresolved", () => {
  const repros = loadCorpus().cases.filter(({ value }) => value.lane === "repro");

  it.each(repros.map(({ caseId, value }) => [caseId, value.request.blocks] as const))(
    "%s: every block is Opaque",
    (_caseId, blocks) => {
      for (const block of blocks) allOpaque(block.text);
    },
  );
});

describe("frame IR invariants", () => {
  it("reports a gap, a wrong raw text and a slot outside its frame", () => {
    const parse = parseFrames("6x örüyoruz.");
    const [frame, tail] = parse.nodes;
    expect(parseInvariantIssues({ ...parse, nodes: [frame!] })).not.toEqual([]);
    expect(
      parseInvariantIssues({
        ...parse,
        nodes: [{ kind: "opaque", span: { start: 0, end: 11, raw: "7x örüyoruz" } }, tail!],
      }),
    ).not.toEqual([]);
    if (frame?.kind !== "frame" || frame.action !== "stitch_count") {
      throw new Error("expected a stitch_count frame");
    }
    expect(
      parseInvariantIssues({
        ...parse,
        nodes: [
          {
            ...frame,
            slots: {
              ...frame.slots,
              verb: { span: { start: 3, end: 12, raw: "örüyoruz." }, form: "finite" },
            },
          },
          tail!,
        ],
      }),
    ).not.toEqual([]);
  });

  it("parses the empty string to no nodes", () => {
    expect(exact("").nodes).toEqual([]);
  });
});

describe("frame parser: module hygiene", () => {
  const code = (file: string) =>
    readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  const imports = (file: string) =>
    [...code(file).matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((match) => match[1]);

  it("imports only the lexer, the glossary and its own IR", () => {
    expect(imports("frame_parser.ts").sort()).toEqual([
      "../glossary.js",
      "../lexer/typed_lexer.js",
      "./frame_ir.js",
    ]);
    expect(imports("frame_ir.ts")).toEqual([]);
  });

  it.each(["frame_parser.ts", "frame_ir.ts"])(
    "%s has no environment, clock, randomness or locale-dependent access",
    (file) => {
      expect(code(file)).not.toMatch(/process\.|Date\.now|new Date\(|Math\.random|performance\.now/);
      expect(code(file)).not.toMatch(/localeCompare|Intl\.|toLocale(?:Lower|Upper)Case/);
    },
  );
});
