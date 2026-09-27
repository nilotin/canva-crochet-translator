/**
 * The course-unit authority seam (next stage, Task 6).
 *
 * The normalizer, the style normalizer and the validator all ask one
 * `CourseUnitResolver` for a course count's row/round unit. Without an
 * injected resolver they use `legacyCourseUnitResolver` (the existing
 * inference), so output is unchanged. With an injected resolver all three
 * agree. No PatternContext, renderer or placement code is involved.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateTranslation } from "../../validator.js";
import {
  inferCrochetCountUnitAtSourcePosition,
  legacyCourseUnitResolver,
  type CourseUnitResolver,
} from "../bare_round_count.js";
import { normalizeSourceNaturalLanguageDetailed } from "../normalizer.js";
import { normalizeTranslationStyle } from "../style_normalizer.js";

const alwaysRow: CourseUnitResolver = () => "row";
const alwaysRound: CourseUnitResolver = () => "round";

/** A resolver that records every position it is asked about, answering like `answer`. */
const recording = (answer: CourseUnitResolver = legacyCourseUnitResolver) => {
  const calls: { context: string; position: number }[] = [];
  const resolver: CourseUnitResolver = (context, position) => {
    calls.push({ context, position });
    return answer(context, position);
  };
  return { resolver, calls };
};

const R3_BLOCK_2 = "13) 5 sıra 16x";
const TRAILING = "3-7) 5 sıra 16x, 1 zincir çekip ipimizi kesiyoruz.";
const CUT_YARN = "10-15) 6 sıra 18x --- ipimizi kesiyoruz.";

const normalize = (block: string, body: string, bodyStart: number, resolveCourseUnit?: CourseUnitResolver) =>
  normalizeSourceNaturalLanguageDetailed(body, "en", "pattern", block, bodyStart, { resolveCourseUnit }).text;

const style = (source: string, translated: string, resolveCourseUnit?: CourseUnitResolver) =>
  normalizeTranslationStyle(source, translated, "en", "pattern", source, 0, { resolveCourseUnit });

const validate = (source: string, translated: string, resolveCourseUnit?: CourseUnitResolver) =>
  validateTranslation(source, translated, "en", {
    notationCaseInsensitive: true,
    contentKind: "pattern",
    sourceContext: source,
    sourceStart: 0,
    resolveCourseUnit,
  });

describe("CourseUnitResolver: default", () => {
  it("the legacy resolver is the existing inference", () => {
    expect(legacyCourseUnitResolver).toBe(inferCrochetCountUnitAtSourcePosition);
  });

  it.each([
    [R3_BLOCK_2, "13) 16sc for 5 rows"],
    [R3_BLOCK_2, "13) 16sc for 5 rounds"],
    [TRAILING, "3-7) 16sc for 5 rows, ch 1 and cut the yarn."],
    [CUT_YARN, "10-15) 18sc for 6 rounds — cut the yarn."],
    [
      "1) 28x örüyoruz, 1 zincir çekip dönüyoruz. Bütün sıra sonlarında 1 zincir çekip dönüyoruz.\n♦ Yakanın ilk parçasını öreceğiz,\n2) (1x, 1v)*5, 1sc = 16x\n3-7) 5 sıra 16x, 1 zincir çekip ipimizi kesiyoruz.",
      "1) Work 28sc, Ch 1 and turn. At the end of each row, ch 1 and turn.\n♦ We will crochet the first part of the collar,\n2) (1sc, 1inc)*5, 1sc = 16sc\n3-7) 16sc for 5 rows, ch 1 and cut the yarn.",
    ],
  ])("passing no resolver equals passing the legacy resolver: %j", (source, translated) => {
    expect(style(source, translated)).toBe(style(source, translated, legacyCourseUnitResolver));
    expect(validate(source, translated)).toEqual(validate(source, translated, legacyCourseUnitResolver));
    expect(normalize(source, source, 0)).toBe(normalize(source, source, 0, legacyCourseUnitResolver));
  });

  it("keeps today's R3 block-2 behavior: rounds, and rows rejected", () => {
    expect(normalize(R3_BLOCK_2, "5 sıra 16x", 4)).toBe("16x for 5 rounds");
    expect(style(R3_BLOCK_2, "13) 16sc for 5 rows")).toBe("13) 16sc for 5 rounds");
    expect(validate(R3_BLOCK_2, "13) 16sc for 5 rows").errors.map(({ code }) => code)).toEqual(["NUMBER_MISMATCH"]);
    expect(validate(R3_BLOCK_2, "13) 16sc for 5 rounds").valid).toBe(true);
  });
});

describe("CourseUnitResolver: an injected row resolver makes all three owners agree", () => {
  it("normalizer renders rows", () => {
    expect(normalize(R3_BLOCK_2, "5 sıra 16x", 4, alwaysRow)).toBe("16x for 5 rows");
  });

  it("style normalizer keeps rows (neither the line rebuild nor the segment-wide rule turns them into rounds)", () => {
    expect(style(R3_BLOCK_2, "13) 16sc for 5 rows", alwaysRow)).toBe("13) 16sc for 5 rows");
    expect(style(R3_BLOCK_2, "13) 16sc for 5 rounds", alwaysRow)).toBe("13) 16sc for 5 rows");
  });

  it("validator accepts rows and rejects rounds", () => {
    expect(validate(R3_BLOCK_2, "13) 16sc for 5 rows", alwaysRow).valid).toBe(true);
    expect(validate(R3_BLOCK_2, "13) 16sc for 5 rounds", alwaysRow).errors.map(({ code }) => code)).toEqual([
      "NUMBER_MISMATCH",
    ]);
  });

  it.each([
    [TRAILING, "3-7) 16x for 5 rows, ch 1 and cut the yarn.", "3-7) 16sc for 5 rows, ch 1 and cut the yarn."],
    [CUT_YARN, "10-15) 18x for 6 rows — cut the yarn.", "10-15) 18sc for 6 rows — cut the yarn."],
  ])("trailing-action and cut-yarn shapes follow it too: %j", (source, normalized, styled) => {
    expect(normalize(source, source, 0, alwaysRow)).toBe(normalized);
    expect(style(source, styled.replace("rows", "rounds"), alwaysRow)).toBe(styled);
    expect(validate(source, styled, alwaysRow).valid).toBe(true);
  });
});

describe("CourseUnitResolver: an injected round resolver makes all three owners agree", () => {
  it("normalizer, style normalizer and validator all use round", () => {
    expect(normalize(R3_BLOCK_2, "5 sıra 16x", 4, alwaysRound)).toBe("16x for 5 rounds");
    expect(style(R3_BLOCK_2, "13) 16sc for 5 rows", alwaysRound)).toBe("13) 16sc for 5 rounds");
    expect(validate(R3_BLOCK_2, "13) 16sc for 5 rounds", alwaysRound).valid).toBe(true);
    expect(validate(R3_BLOCK_2, "13) 16sc for 5 rows", alwaysRound).valid).toBe(false);
  });

  it.each([
    [TRAILING, "3-7) 16x for 5 rounds, ch 1 and cut the yarn.", "3-7) 16sc for 5 rounds, ch 1 and cut the yarn."],
    [CUT_YARN, "10-15) 18x for 6 rounds — cut the yarn.", "10-15) 18sc for 6 rounds — cut the yarn."],
  ])("for trailing-action and cut-yarn shapes too: %j", (source, normalized, styled) => {
    expect(normalize(source, source, 0, alwaysRound)).toBe(normalized);
    expect(style(source, styled.replace("rounds", "rows"), alwaysRound)).toBe(styled);
    expect(validate(source, styled, alwaysRound).valid).toBe(true);
  });
});

describe("CourseUnitResolver: positions", () => {
  it("the normalizer asks at the bare count's body offset in the block", () => {
    const { resolver, calls } = recording();
    normalize(R3_BLOCK_2, "5 sıra 16x", 4, resolver);
    expect(calls).toEqual([{ context: R3_BLOCK_2, position: 4 }]);
  });

  it("the style normalizer and the validator ask at the start of the course-count line", () => {
    const styleCalls = recording();
    style(R3_BLOCK_2, "13) 16sc for 5 rows", styleCalls.resolver);
    expect(styleCalls.calls).toEqual([{ context: R3_BLOCK_2, position: 0 }]);
    const validatorCalls = recording();
    validate(R3_BLOCK_2, "13) 16sc for 5 rows", validatorCalls.resolver);
    expect(validatorCalls.calls.length).toBeGreaterThan(0);
    for (const { context, position } of validatorCalls.calls) {
      expect(context).toBe(R3_BLOCK_2);
      expect(position).toBe(0);
    }
  });

  it("a multi-line block is asked at the course-count line, not at 0", () => {
    const source =
      "1) 28x örüyoruz, 1 zincir çekip dönüyoruz. Bütün sıra sonlarında 1 zincir çekip dönüyoruz.\n♦ Yeni bölüm\n3) 5 sıra 16x";
    const lineStart = source.lastIndexOf("\n") + 1;
    const { resolver, calls } = recording();
    style(source, "1) Work 28sc, Ch 1 and turn. At the end of each row, ch 1 and turn.\n♦ New section\n3) 16sc for 5 rounds", resolver);
    expect(calls.map(({ position }) => position)).toEqual([lineStart]);
    const normalizerCalls = recording();
    normalize(source, source, 0, normalizerCalls.resolver);
    expect(normalizerCalls.calls.map(({ position }) => position)).toEqual([lineStart]);
  });

  it("trailing-action and cut-yarn spans are asked at their span start", () => {
    for (const source of [TRAILING, CUT_YARN]) {
      const { resolver, calls } = recording();
      normalize(source, source, 0, resolver);
      expect(calls).toEqual([{ context: source, position: 0 }]);
    }
  });
});

describe("CourseUnitResolver: text that is not a course count", () => {
  it.each([
    ["Bu sıradan sonra kol ve gövdeye teli takabilirsiniz.", "After this round, you can attach the wire to the arm and body."],
    [
      "Sıra sonlarında cc ile birleştirip, 1 zincir çekip bir üst sıraya geçiyoruz.",
      "At the end of each row, join with sl st, ch 1, and continue to the next row.",
    ],
  ])("is never asked about, and is unaffected by the resolver: %j", (source, translated) => {
    const { resolver, calls } = recording(alwaysRow);
    const styled = style(source, translated, resolver);
    expect(styled).toBe(style(source, translated));
    expect(styled).toBe(style(source, translated, alwaysRound));
    expect(normalize(source, source, 0, resolver)).toBe(normalize(source, source, 0));
    expect(validate(source, translated, resolver)).toEqual(validate(source, translated));
    expect(calls).toEqual([]);
  });
});

describe("CourseUnitResolver: purity", () => {
  it("gives the same results on repeated calls", () => {
    expect(style(R3_BLOCK_2, "13) 16sc for 5 rows", alwaysRow)).toBe(style(R3_BLOCK_2, "13) 16sc for 5 rows", alwaysRow));
    expect(validate(R3_BLOCK_2, "13) 16sc for 5 rows", alwaysRow)).toEqual(validate(R3_BLOCK_2, "13) 16sc for 5 rows", alwaysRow));
    expect(normalize(R3_BLOCK_2, "5 sıra 16x", 4, alwaysRow)).toBe(normalize(R3_BLOCK_2, "5 sıra 16x", 4, alwaysRow));
  });

  it("does not mutate the options it is given", () => {
    const options = Object.freeze({ resolveCourseUnit: alwaysRow });
    expect(() =>
      normalizeTranslationStyle(R3_BLOCK_2, "13) 16sc for 5 rows", "en", "pattern", R3_BLOCK_2, 0, options),
    ).not.toThrow();
    expect(options.resolveCourseUnit).toBe(alwaysRow);
  });
});

describe("CourseUnitResolver: one authority, no typed dependencies", () => {
  const code = (relative: string) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  const owners = ["../normalizer.ts", "../style_normalizer.ts", "../../validator.ts"];

  it.each(owners)("%s asks the resolver instead of calling the inference directly", (file) => {
    expect(code(file)).not.toMatch(/inferCrochetCountUnitAtSourcePosition\(/);
  });

  it.each([...owners, "../bare_round_count.ts"])("%s imports no PatternContext, renderer or placement code", (file) => {
    expect(code(file)).not.toMatch(/context\/|pattern_context|pattern_events|frame_renderer|renderCourseCount|assembly\//);
  });
});
