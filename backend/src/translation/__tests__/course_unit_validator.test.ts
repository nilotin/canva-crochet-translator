/**
 * Validator unit-ownership parity (Task 15A).
 *
 * The generic, written-chain, arm-joining and worked chain-cut course-count
 * families render their unit through `CourseUnitResolver`. The validator must
 * verify that rendered unit against the same resolver, asked once per count at
 * the count's own source offset, and never decide row/round itself. A wrong
 * unit reports the existing NUMBER_MISMATCH terminology diagnostic.
 */
import { describe, expect, it, vi } from "vitest";
import {
  prepareCourseDecisions,
  prepareCrossBlockCourseDecisions,
  resolveCourseUnitWithReason,
} from "../course_unit_resolution.js";
import type { CrochetCountUnit } from "../natural_language/bare_round_count.js";
import { validateTranslation } from "../validator.js";

const TURN = "12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.";
/** The turning-row evidence numbered directly before `line`, so it is inherited. */
const turnBefore = (line: string) =>
  `${Number(/^(\d+)/u.exec(line)![1]) - 1}) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.`;
const TERMINOLOGY = "Crochet row/round terminology does not match the source construction.";

const plural = (unit: CrochetCountUnit) => `${unit}s`;

/** Exact Task 14 fixtures; `offset` is the count's source offset in `line`. */
const families = [
  {
    name: "generic",
    line: "13) 5 sıra 16x, sonra dikiyoruz.",
    offset: 4,
    render: (word: string) => `13) 5 ${word}, 16sc, sonra dikiyoruz.`,
  },
  {
    name: "written-chain",
    line: "11-35) 25 sıra 12x bir zincir çekip ipimizi kesiyoruz.",
    offset: 0,
    render: (word: string) => `11-35) 25 ${word}, 12sc. Ch 1 and cut the yarn.`,
  },
  {
    name: "arm-joining",
    line: "15-29) 15 sıra 42x, İpimizi kesmeden kol birleştirme ile devam ediyoruz.",
    offset: 0,
    render: (word: string) =>
      `15-29) 15 ${word}, 42sc. Without cutting the yarn, continue by joining the arms.`,
  },
  {
    name: "örüyoruz chain-cut",
    line: "13-38) 26 sıra 14x örüyoruz, 1 zincir çekip ipimizi kesiyoruz.",
    offset: 0,
    render: (word: string) => `13-38) 26 ${word}, 14 sc. Ch 1 and cut the yarn.`,
  },
];

const validate = (
  source: string,
  translated: string,
  resolveCourseUnit: (context: string, position: number) => CrochetCountUnit,
  sourceContext = source,
  sourceStart = 0,
) => validateTranslation(source, translated, "en", {
  notationCaseInsensitive: true, contentKind: "pattern", sourceContext, sourceStart, resolveCourseUnit,
});

describe.each(families)("validator unit parity: $name", ({ line, offset, render }) => {
  const turn = turnBefore(line);
  const context = `${turn}\n${line}`;
  const position = context.indexOf(line);

  it.each([
    ["row", "row", true],
    ["row", "round", false],
    ["round", "round", true],
    ["round", "row", false],
  ] as const)("resolver %s + translated %ss -> valid=%s", (unit, rendered, valid) => {
    const resolver = vi.fn((): CrochetCountUnit => unit);
    const result = validate(line, render(plural(rendered)), resolver, context, position);
    expect(result.valid).toBe(valid);
    expect(result.errors.map(({ message }) => message)).toEqual(valid ? [] : [TERMINOLOGY]);
    // Asked once for the count, at its exact block offset: no generic re-check.
    expect(resolver.mock.calls).toEqual([[context, position + offset]]);
  });

  it("same-block typed row: rows pass, rounds fail", () => {
    const prepass = prepareCourseDecisions([{ id: "b", text: context }]);
    expect(resolveCourseUnitWithReason(prepass, "b", context, position + offset))
      .toEqual({ unit: "row", source: "typed", typedUnit: "row" });
    const resolver = (ctx: string, at: number) => resolveCourseUnitWithReason(prepass, "b", ctx, at).unit;
    expect(validate(line, render("rows"), resolver, context, position).valid).toBe(true);
    expect(validate(line, render("rounds"), resolver, context, position).valid).toBe(false);
  });

  it("trusted cross-block row: rows pass, rounds fail", () => {
    const blocks = [{ id: "a", text: turn }, { id: "b", text: line }];
    const same = prepareCourseDecisions(blocks);
    const cross = prepareCrossBlockCourseDecisions(blocks, ["a", "b"]);
    expect(resolveCourseUnitWithReason(same, "b", line, offset, undefined, cross))
      .toEqual({ unit: "row", source: "typed_cross_block", typedUnit: "row" });
    const resolver = (ctx: string, at: number) =>
      resolveCourseUnitWithReason(same, "b", ctx, at, undefined, cross).unit;
    expect(validate(line, render("rows"), resolver).valid).toBe(true);
    expect(validate(line, render("rounds"), resolver).valid).toBe(false);
  });

  it("no typed authority: the legacy fallback expects rounds", () => {
    const prepass = prepareCourseDecisions([{ id: "b", text: line }]);
    expect(resolveCourseUnitWithReason(prepass, "b", line, offset))
      .toMatchObject({ unit: "round", source: "fallback" });
    const resolver = (ctx: string, at: number) => resolveCourseUnitWithReason(prepass, "b", ctx, at).unit;
    expect(validate(line, render("rounds"), resolver).valid).toBe(true);
    expect(validate(line, render("rows"), resolver).valid).toBe(false);
  });

  it("typed/legacy disagreement: the fail-closed fallback expects rounds", () => {
    const prepass = prepareCourseDecisions([{ id: "b", text: context }]);
    const resolver = (ctx: string, at: number) =>
      resolveCourseUnitWithReason(prepass, "b", ctx, at, () => "round").unit;
    expect(resolveCourseUnitWithReason(prepass, "b", context, position + offset, () => "round"))
      .toEqual({ unit: "round", source: "fallback", reason: "typed_disagrees_with_legacy", typedUnit: "row" });
    expect(validate(line, render("rounds"), resolver, context, position).valid).toBe(true);
    expect(validate(line, render("rows"), resolver, context, position).valid).toBe(false);
  });
});

describe("validator unit parity: counts, plurality and precedence", () => {
  it("validates multiple generic counts independently at their own offsets", () => {
    const line = "13) 5 sıra 16x, 6 sıra 18x";
    const context = `${TURN}\n${line}`;
    const position = context.indexOf(line);
    const second = position + line.indexOf("6 sıra");
    const resolver = vi.fn((_ctx: string, at: number): CrochetCountUnit => (at === second ? "round" : "row"));
    expect(validate(line, "13) 5 rows, 16sc, 6 rounds, 18sc", resolver, context, position).valid).toBe(true);
    expect(resolver.mock.calls).toEqual([[context, position + 4], [context, second]]);
    expect(validate(line, "13) 5 rows, 16sc, 6 rows, 18sc", resolver, context, position).valid).toBe(false);
    expect(validate(line, "13) 5 rounds, 16sc, 6 rounds, 18sc", resolver, context, position).valid).toBe(false);
  });

  it.each(["row", "round"] as const)("singular: 1 %s passes, every other wording fails", (unit) => {
    const line = "13) 1 sıra 16x, sonra dikiyoruz.";
    const resolver = (): CrochetCountUnit => unit;
    const other = unit === "row" ? "round" : "row";
    expect(validate(line, `13) 1 ${unit}, 16sc, sonra dikiyoruz.`, resolver).valid).toBe(true);
    for (const word of [`${unit}s`, other, `${other}s`]) {
      expect(validate(line, `13) 1 ${word}, 16sc, sonra dikiyoruz.`, resolver).valid).toBe(false);
    }
  });

  it("the compact chain-cut keeps precedence: no generic count is validated or resolved", () => {
    const line = "13) 5 sıra 16x, 1 zincir çekip ipimizi kesiyoruz, sonra dikiyoruz.";
    const resolver = vi.fn((): CrochetCountUnit => "row");
    expect(validate(line, "13) 5 sıra 16sc. Ch 1 and cut the yarn, sonra dikiyoruz.", resolver).valid).toBe(true);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("a trailing-action count on the same line is located, not resolved again by this check", () => {
    const line = "13) 9 sıra 54x, 6 zincir (düğme iliği) 2 sıra 8x, sonra dikiyoruz.";
    const generic = line.indexOf("2 sıra");
    const resolver = vi.fn((): CrochetCountUnit => "row");
    expect(validate(line, "13) 54sc for 9 rows, ch 6 (buttonhole) 2 rows, 8sc, sonra dikiyoruz.", resolver).valid)
      .toBe(true);
    // 0: the existing trailing-action swap check; generic: this check.
    expect(resolver.mock.calls).toEqual([[line, 0], [line, generic]]);
    expect(validate(line, "13) 54sc for 9 rows, ch 6 (buttonhole) 2 rounds, 8sc, sonra dikiyoruz.", resolver).valid)
      .toBe(false);
  });

  it("pairs lines like bare counts: index, else a unique leading marker, else fail closed", () => {
    const resolver = (): CrochetCountUnit => "row";
    const marked = "13) 5 sıra 16x, sonra dikiyoruz.\nBaşka satır.";
    expect(validate(marked, "13) 5 rows, 16sc,\nsonra dikiyoruz.\nAnother line.", resolver).valid).toBe(true);
    expect(validate(marked, "13) 5 rounds, 16sc,\nsonra dikiyoruz.\nAnother line.", resolver).valid).toBe(false);
    const unmarked = "5 sıra 16x, sonra dikiyoruz.\nBaşka satır.";
    expect(validate(unmarked, "5 rows, 16sc, sonra dikiyoruz. Another line.", resolver).errors
      .map(({ message }) => message)).toEqual([TERMINOLOGY]);
  });

  it("is English-pattern only, like the bare-count check", () => {
    const line = "13) 5 sıra 16x, sonra dikiyoruz.";
    const resolver = vi.fn((): CrochetCountUnit => "row");
    expect(validateTranslation(line, "13) 5 vueltas, 16 pb, luego cosemos.", "es", { resolveCourseUnit: resolver })
      .errors.map(({ message }) => message)).not.toContain(TERMINOLOGY);
    expect(resolver).not.toHaveBeenCalled();
  });
});
