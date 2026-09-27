import { describe, expect, it } from "vitest";
import { loadCorpus } from "../../__tests__/corpus/load_corpus.js";
import { PROJECT_NOTATION } from "../../glossary.js";
import {
  parseInvariantIssues,
  reconstructParse,
  type ChainFrame,
  type FrameParse,
  type ParseNode,
  type TurnFrame,
} from "../frame_ir.js";
import {
  CHAIN_CONCEPT,
  CHAIN_CONVERBS,
  CHAIN_UNIT_FORMS,
  TURN_FINITE_VERBS,
  parseFrames,
} from "../frame_parser.js";

const exact = (source: string): FrameParse => {
  const parse = parseFrames(source);
  expect(parseInvariantIssues(parse)).toEqual([]);
  expect(reconstructParse(parse.nodes)).toBe(source);
  return parse;
};

/** `[kind or action, raw]` per node. */
const shape = (source: string): [string, string][] =>
  exact(source).nodes.map((node) => [node.kind === "frame" ? node.action : "opaque", node.span.raw]);

const chainOrTurn = (source: string) =>
  exact(source).nodes.filter(
    (node) => node.kind === "frame" && (node.action === "chain" || node.action === "turn"),
  );

const allOpaque = (source: string): void => {
  expect(shape(source)).toEqual([["opaque", source]]);
};

describe("chain/turn lexicon", () => {
  it("reads the chain abbreviation from PROJECT_NOTATION and adds only the noun zincir", () => {
    const glossaryForms = PROJECT_NOTATION.filter((entry) => entry.concept === CHAIN_CONCEPT).map(
      (entry) => entry.tr.abbreviation,
    );
    expect(glossaryForms).toEqual(["zn"]);
    expect([...CHAIN_UNIT_FORMS.keys()]).toEqual([...glossaryForms, "zincir"]);
    expect(new Set(CHAIN_UNIT_FORMS.values())).toEqual(new Set([CHAIN_CONCEPT]));
  });

  it("admits exactly one converb and one finite turn form", () => {
    expect([...CHAIN_CONVERBS]).toEqual(["çekip"]);
    expect([...TURN_FINITE_VERBS]).toEqual(["dönüyoruz"]);
  });
});

describe("chain(converb) -> turn(finite): recognized pairs", () => {
  it("emits chain, the exact whitespace between, and turn, each with its own span", () => {
    const [chain, between, turn, tail] = exact("1 zincir çekip dönüyoruz.").nodes;
    expect(chain).toEqual({
      kind: "frame",
      action: "chain",
      span: { start: 0, end: 14, raw: "1 zincir çekip" },
      slots: {
        count: { span: { start: 0, end: 1, raw: "1" }, value: 1 },
        unit: { span: { start: 2, end: 8, raw: "zincir" }, concept: "chain" },
        verb: { span: { start: 9, end: 14, raw: "çekip" }, form: "converb" },
      },
    } satisfies ChainFrame);
    expect(between).toEqual({ kind: "opaque", span: { start: 14, end: 15, raw: " " } });
    expect(turn).toEqual({
      kind: "frame",
      action: "turn",
      span: { start: 15, end: 24, raw: "dönüyoruz" },
      slots: { verb: { span: { start: 15, end: 24, raw: "dönüyoruz" }, form: "finite" } },
    } satisfies TurnFrame);
    expect(tail).toEqual({ kind: "opaque", span: { start: 24, end: 25, raw: "." } });
  });

  it.each([
    ["20 zincir çekip dönüyoruz,", 20, "zincir"],
    ["3 zn çekip dönüyoruz.", 3, "zn"],
  ] as const)("recognizes %j", (source, value, unit) => {
    const [chain, turn] = chainOrTurn(source) as [ChainFrame, TurnFrame];
    expect(chain.slots.count.value).toBe(value);
    expect(chain.slots.unit).toMatchObject({ concept: "chain", span: { raw: unit } });
    expect(turn.action).toBe("turn");
  });

  it("recognizes the corpus sleeve-shaping ending between clean boundaries", () => {
    expect(shape("örebilirsiniz. 1 zincir çekip dönüyoruz.\n2) Bu sırayı")).toEqual([
      ["opaque", "örebilirsiniz. "],
      ["chain", "1 zincir çekip"],
      ["opaque", " "],
      ["turn", "dönüyoruz"],
      ["opaque", ".\n2) Bu sırayı"],
    ]);
  });

  it("keeps a wider whitespace run between members as exact Opaque text", () => {
    expect(shape("1  zincir\tçekip  dönüyoruz")).toEqual([
      ["chain", "1  zincir\tçekip"],
      ["opaque", "  "],
      ["turn", "dönüyoruz"],
    ]);
  });

  it("tiles Frame / Opaque / Frame together with stitch_count", () => {
    expect(shape("28x örüyoruz.\n1 zincir çekip dönüyoruz.")).toEqual([
      ["stitch_count", "28x örüyoruz"],
      ["opaque", ".\n"],
      ["chain", "1 zincir çekip"],
      ["opaque", " "],
      ["turn", "dönüyoruz"],
      ["opaque", "."],
    ]);
  });

  it("uses UTF-16 offsets for every span and slot", () => {
    const [chain, turn] = chainOrTurn("🧶.\n1 zincir çekip dönüyoruz") as [ChainFrame, TurnFrame];
    expect(chain.span).toEqual({ start: 4, end: 18, raw: "1 zincir çekip" });
    expect(chain.slots.unit.span).toEqual({ start: 6, end: 12, raw: "zincir" });
    expect(chain.slots.verb.span).toEqual({ start: 13, end: 18, raw: "çekip" });
    expect(turn.span).toEqual({ start: 19, end: 28, raw: "dönüyoruz" });
  });

  it("is deterministic and does not depend on earlier calls", () => {
    const source = "20 zincir çekip dönüyoruz, zincir üzerine üçüncü zincirden itibaren 18hdc";
    const first = parseFrames(source);
    parseFrames("1 zincir çekip dönüyoruz.");
    expect(parseFrames(source)).toEqual(first);
  });
});

describe("chain(converb) -> turn(finite): stays Opaque", () => {
  it.each([
    ["34 zincir çekip geriye dönüyoruz.", "backward turn (adverb between members)"],
    ["1 zincir çekip hemen dönüyoruz.", "any word between members"],
    ["1 zincir çekip ipimizi kesiyoruz.", "chain -> cut is not admitted"],
    ["1 zincir çekip bir üst sıraya geçiyoruz.", "chain -> next row is not admitted"],
    ["1 zincir, dön,", "comma-list chain/turn"],
    ["1 zincir, sıradaki sık iğneye cc, yaparak dönüyoruz.", "yaparak turn"],
    ["İkinci bacaktan 3 zincir ile birleştiriyoruz.", "chain as instrument"],
    ["6 zincir atlıyoruz (düğme iliği oluşturuyoruz.)", "chain as object of skip"],
    ["zincir üzerine üçüncü zincirden itibaren", "chain as reference"],
    ["1 zincir çekip.", "dangling converb chain"],
    ["1 zincir çekip", "dangling converb chain at end of text"],
    ["dönüyoruz.", "standalone turn"],
    ["3 zincir çekiyoruz.", "standalone finite chain"],
    ["2 zn çekiyoruz.", "standalone finite chain"],
    ["1 Zincir çekip dönüyoruz.", "unsupported chain spelling"],
    ["1 ZN çekip dönüyoruz.", "unsupported chain spelling"],
    ["1 zinciri çekip dönüyoruz.", "unsupported chain spelling"],
    ["1zn çekip dönüyoruz.", "count not separated from the unit"],
    ["1 zincir çekip\ndönüyoruz.", "newline between members"],
    ["1 zincir Çekip dönüyoruz.", "converb casing"],
    ["1 zincir çekip Dönüyoruz.", "turn casing"],
    ["1.5 zincir çekip dönüyoruz.", "decimal count"],
    ["1,5 zincir çekip dönüyoruz.", "decimal count"],
    ["1 zincir çekip dönüyoruz ve", "right boundary is a word"],
    ["1 zincir çekip 2 zincir çekip dönüyoruz.", "no three-member sequences"],
    ["Süet ipimiz yoksa da 55cm tütün rengi ip ile zincir çekip aynı işlemi yapabiliriz.", "materials text"],
    ["2 adet Catania TR263 - ten rengi\n1 adet Catania 110 - siyah", "materials text"],
  ])("%j (%s)", (source) => {
    allOpaque(source);
  });

  it.each([
    ["Sıra sonunda 1 zincir çekip dönüyoruz.", "course_end_turn", "."],
    ["Bütün sıra sonlarında 1 zincir çekip dönüyoruz.", "course_end_turn", "."],
  ])("%j: a pair after a course-end phrase is one %s frame, never a standalone pair", (source, action, tail) => {
    expect(shape(source)).toEqual([
      [action, source.slice(0, -tail.length)],
      ["opaque", tail],
    ]);
    expect(chainOrTurn(source)).toEqual([]);
  });

  it("does not admit a pair after a comma, while the stitch_count before it is unchanged", () => {
    expect(shape("1) 28x örüyoruz, 1 zincir çekip dönüyoruz.")).toEqual([
      ["opaque", "1) "],
      ["stitch_count", "28x örüyoruz"],
      ["opaque", ", 1 zincir çekip dönüyoruz."],
    ]);
  });
});

describe("converb invariant", () => {
  const source = "1 zincir çekip dönüyoruz.";
  const pair = parseFrames(source);
  const [chain, , turn, tail] = pair.nodes as [ChainFrame, ParseNode, TurnFrame, ParseNode];
  const danglingReported = (issues: string[]) =>
    issues.some((issue) => issue.includes("without its linked turn frame"));

  it("accepts the linked pair", () => {
    expect(parseInvariantIssues(pair)).toEqual([]);
  });

  it("rejects a chain converb frame that is not followed by its linked turn", () => {
    const dangling: ParseNode[] = [
      chain,
      { kind: "opaque", span: { start: 14, end: 25, raw: " dönüyoruz." } },
    ];
    expect(danglingReported(parseInvariantIssues({ source, nodes: dangling }))).toBe(true);
  });

  it("rejects a chain whose separator is not whitespace-only", () => {
    const text = "1 zincir çekip.dönüyoruz.";
    const nodes: ParseNode[] = [
      chain,
      { kind: "opaque", span: { start: 14, end: 15, raw: "." } },
      turn,
      tail,
    ];
    expect(danglingReported(parseInvariantIssues({ source: text, nodes }))).toBe(true);
  });
});

describe("repro guard", () => {
  const repros = loadCorpus().cases.filter(({ value }) => value.lane === "repro");

  // Repros admit only the course-end signal: no stitch_count and no standalone
  // chain or turn. (Render units stay empty: frame_renderer_shadow.test.ts.)
  it.each(repros.map(({ caseId, value }) => [caseId, value.request.blocks] as const))(
    "%s: no frame other than course_end_turn",
    (_caseId, blocks) => {
      for (const block of blocks) {
        for (const node of exact(block.text).nodes) {
          if (node.kind === "frame") expect(node.action).toBe("course_end_turn");
        }
      }
    },
  );

  it("admits the course-end signal exactly where the repro text has it", () => {
    const found = repros.flatMap(({ caseId, value }) =>
      value.request.blocks.flatMap((block) =>
        exact(block.text).nodes.flatMap((node) =>
          node.kind === "frame" && node.action === "course_end_turn"
            ? [[caseId, block.id, node.slots.scope.value, node.span.raw]]
            : [],
        ),
      ),
    );
    expect(found).toEqual([
      ["r-0b3aaf317b-cross-block-row-context", "local-block-1", "every", "Bütün sıra sonlarında 1 zincir çekip dönüyoruz"],
      ["r-7f044c15ff-ordinal-mid-block", "local-block-1", "every", "Bütün sıra sonlarında 1 zincir çekip dönüyoruz"],
      ["r-9fd3d972ce-unit-drift-turning", "local-block-1", "single", "Sıra sonunda 1 zincir çekip dönüyoruz"],
    ]);
  });
});
