/**
 * Production wiring of the block course-unit resolver (next stage, Task 8).
 *
 * `translateBlocks` precomputes same-block course decisions and gives every
 * block its own resolver, threaded into the normalizer, the style normalizer,
 * the segment validator and the final full-block validator, on the ordinary,
 * mixed and formatting-unit paths. The resolver's answer always equals the
 * legacy inference, so output is unchanged: R3 stays "13) 16sc for 5 rounds".
 *
 * The adapter module is wrapped (not replaced) to record calls and, in the
 * reach tests only, to force one unit. A forced unit that changes the output
 * AND keeps the result valid proves every owner, including the final
 * full-block validator, received the same resolver: a validator left on the
 * legacy default would report NUMBER_MISMATCH.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as CourseUnitResolution from "../course_unit_resolution.js";
import {
  lookupTypedCourseUnit,
  prepareCourseDecisions,
  prepareCrossBlockCourseDecisions,
  resolveCourseUnitWithReason,
} from "../course_unit_resolution.js";
import { normalizeSourceNaturalLanguageDetailed } from "../natural_language/normalizer.js";
import { normalizeTranslationStyle } from "../natural_language/style_normalizer.js";
import { validateTranslation } from "../validator.js";
import type { CrochetCountUnit } from "../natural_language/bare_round_count.js";
import type {
  ProviderReadiness,
  TranslationProvider,
  TranslationProviderRequest,
  TranslationProviderResult,
} from "../providers/provider.js";
import { translateBlocks } from "../translator.js";
import { loadCorpus } from "./corpus/load_corpus.js";

const harness = vi.hoisted(() => ({
  forced: undefined as CrochetCountUnit | undefined,
  calls: [] as { blockId: string; context: string; position: number; source: string; reason?: string }[],
}));

vi.mock("../course_unit_resolution.js", async (importOriginal) => {
  const actual = await importOriginal<typeof CourseUnitResolution>();
  return {
    ...actual,
    courseUnitResolverForBlock: (...args: Parameters<typeof actual.courseUnitResolverForBlock>) => {
      const [prepass, blockId] = args;
      const real = actual.courseUnitResolverForBlock(...args);
      return (context: string, position: number) => {
        const { source, reason } = actual.resolveCourseUnitWithReason(prepass, blockId, context, position);
        harness.calls.push({ blockId, context, position, source, ...(reason === undefined ? {} : { reason }) });
        return harness.forced ?? real(context, position);
      };
    },
  };
});

class EchoProvider implements TranslationProvider {
  readonly name = "echo";
  readonly model = "echo";
  async checkReadiness(): Promise<ProviderReadiness> {
    return { ok: true, provider: this.name, model: this.model };
  }
  async translate(request: TranslationProviderRequest): Promise<TranslationProviderResult> {
    return { translations: request.blocks.map(({ id, text }) => ({ id, translated: text })) };
  }
}

class NoProvider implements TranslationProvider {
  readonly name = "none";
  readonly model = "none";
  async checkReadiness(): Promise<ProviderReadiness> {
    return { ok: true, provider: this.name, model: this.model };
  }
  async translate(): Promise<TranslationProviderResult> {
    throw new Error("This input is resolved without a provider.");
  }
}

const TURN = "12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.";
const TURN_EN = "12) At the end of each row, ch 1 and turn.";
const R3_BLOCK_2 = "13) 5 sıra 16x";

const translate = (blocks: { id: string; text: string }[]) =>
  translateBlocks(blocks, "en", { provider: new EchoProvider() });
const texts = (results: Awaited<ReturnType<typeof translateBlocks>>) =>
  results.map(({ translated, valid, errors }) => ({ translated, valid, errors: errors.map(({ code }) => code) }));

beforeEach(() => {
  harness.forced = undefined;
  harness.calls.length = 0;
});

describe("course unit ownership: current sentence bypasses (Task 14A)", () => {
  // Exact sentence fixtures from natural_language/{normalizer,style_normalizer}
  // tests. Only the preceding evidence marker is adapted for continuity.
  const cases = [
    {
      name: "written-chain yarn cut",
      previous: 10,
      line: "11-35) 25 sıra 12x bir zincir çekip ipimizi kesiyoruz.",
      normalized: "11-35) 25 rows, 12sc. Ch 1 and cut the yarn.",
      rendered: "11-35) 25 rows, 12sc. Ch 1 and cut the yarn.",
      resolverOwned: true,
    },
    {
      name: "arm-joining continuation",
      previous: 14,
      line: "15-29) 15 sıra 42x, İpimizi kesmeden kol birleştirme ile devam ediyoruz.",
      normalized: "15-29) 15 rows, 42x. Without cutting the yarn, continue by joining the arms.",
      rendered: "15-29) 15 rows, 42sc. Without cutting the yarn, continue by joining the arms.",
      resolverOwned: true,
    },
  ];

  it("bare-count control consults the row resolver and validates rows", () => {
    const text = `${TURN}\n${R3_BLOCK_2}`;
    const position = text.indexOf(R3_BLOCK_2);
    const prepass = prepareCourseDecisions([{ id: "b", text }]);
    expect(lookupTypedCourseUnit(prepass, "b", text, position)).toMatchObject({
      kind: "typed", unit: "row",
    });
    const resolver = vi.fn(() => "row" as const);
    const rendered = normalizeTranslationStyle(
      R3_BLOCK_2, "unused provider output", "en", "pattern", text, position,
      { resolveCourseUnit: resolver },
    );
    expect(rendered).toBe("13) 16sc for 5 rows");
    expect(resolver).toHaveBeenCalledExactlyOnceWith(text, position);
    resolver.mockClear();
    expect(validateTranslation(R3_BLOCK_2, rendered, "en", {
      sourceContext: text, sourceStart: position, resolveCourseUnit: resolver,
    })).toEqual({ valid: true, errors: [], warnings: [] });
    expect(resolver).toHaveBeenCalled();
  });

  describe.each(cases)("$name", ({ previous, line, normalized, rendered, resolverOwned }) => {
    const turn = `${previous}) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.`;
    const turnEn = `${previous}) At the end of each row, ch 1 and turn.`;
    const text = `${turn}\n${line}`;
    const position = text.indexOf(line);
    const expected = `${turnEn}\n${rendered}`;

    it("records typed coverage separately from rendering and validation bypasses", () => {
      const prepass = prepareCourseDecisions([{ id: "b", text }]);
      expect(prepass.status).toBe("enabled");
      const lookup = lookupTypedCourseUnit(prepass, "b", text, position);
      // Both formerly bypassed the resolver; each now owns rendering only,
      // with the shared resolver supplying its typed course-unit decision.
      expect(lookup).toMatchObject({ kind: "typed", unit: "row" });
      expect(prepass.decisions.get("b")).toEqual([
        expect.objectContaining({ courseKind: "row", lineIndex: 1 }),
      ]);
      expect(resolveCourseUnitWithReason(prepass, "b", text, position)).toEqual({
        unit: "row", source: "typed", typedUnit: "row",
      });

      const resolver = vi.fn(() => "row" as const);
      expect(normalizeSourceNaturalLanguageDetailed(
        line, "en", "pattern", text, position, { resolveCourseUnit: resolver },
      ).text).toBe(normalized);
      if (resolverOwned) {
        expect(resolver).toHaveBeenCalledExactlyOnceWith(text, position);
      } else {
        expect(resolver).not.toHaveBeenCalled();
      }
      resolver.mockClear();
      expect(normalizeTranslationStyle(
        line, "unused provider output", "en", "pattern", text, position,
        { resolveCourseUnit: resolver },
      )).toBe(rendered);
      if (resolverOwned) {
        expect(resolver).toHaveBeenCalledExactlyOnceWith(text, position);
      } else {
        expect(resolver).not.toHaveBeenCalled();
      }
      resolver.mockClear();
      expect(validateTranslation(line, rendered, "en", {
        sourceContext: text, sourceStart: position, resolveCourseUnit: resolver,
      })).toEqual({ valid: true, errors: [], warnings: [] });
      // Since Task 15A the validator checks these families' unit through the
      // same resolver, at the clause's own source offset.
      expect(resolver).toHaveBeenCalledExactlyOnceWith(text, position);
    });

    it.each([false, true])("production preserves the current unit contract with formatting=%s", async (formatted) => {
      const block = {
        id: "b", text,
        ...(formatted ? { formattingRegions: [
          { id: "turn", start: 0, end: position },
          { id: "count", start: position, end: text.length },
        ] } : {}),
      };
      const [baseline] = await translateBlocks([block], "en", { provider: new EchoProvider() });
      expect(harness.calls.length > 0).toBe(resolverOwned);
      harness.forced = "row";
      const [result] = await translateBlocks([block], "en", { provider: new EchoProvider() });
      expect(result).toEqual(baseline);
      expect(result).toMatchObject({
        id: "b", source: text, translated: expected,
        valid: true, errors: [], warnings: [],
      });
      expect(harness.calls.length > 0).toBe(resolverOwned);
      expect(result?.targetFormattingRegions).toEqual(formatted ? [
        { id: "turn", start: 0, end: turnEn.length + 1 },
        { id: "count", start: turnEn.length + 1, end: expected.length },
      ] : undefined);
    });
  });
});

describe("arm-joining resolver ownership (Task 14B)", () => {
  const line = "15-29) 15 sıra 42x, İpimizi kesmeden kol birleştirme ile devam ediyoruz.";
  const turn = "14) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.";
  const text = `${turn}\n${line}`;
  const position = text.indexOf(line);
  const output = (unit: string) =>
    `15-29) 15 ${unit}, 42sc. Without cutting the yarn, continue by joining the arms.`;

  it.each(["row", "round"] as const)("uses injected %s at the exact block offset", (unit) => {
    const resolver = vi.fn(() => unit);
    expect(normalizeTranslationStyle(line, "probe", "en", "pattern", text, position,
      { resolveCourseUnit: resolver })).toBe(output(`${unit}s`));
    expect(resolver).toHaveBeenCalledExactlyOnceWith(text, position);
    resolver.mockClear();
    expect(normalizeSourceNaturalLanguageDetailed(line, "en", "pattern", text, position,
      { resolveCourseUnit: resolver }).text).toBe(output(`${unit}s`).replace("42sc", "42x"));
    expect(resolver).toHaveBeenCalledExactlyOnceWith(text, position);
  });

  it.each(["row", "round"] as const)("keeps singular %s and punctuation", (unit) => {
    const singular = line.replace("15 sıra", "1 sıra");
    expect(normalizeTranslationStyle(singular, "probe", "en", "pattern", singular, 0,
      { resolveCourseUnit: () => unit })).toBe(output(unit).replace("15-29) 15 ", "15-29) 1 "));
  });

  it("keeps rounds without typed evidence", async () => {
    const [result] = await translate([{ id: "b", text: line }]);
    expect(result).toMatchObject({ translated: output("rounds"), valid: true, errors: [] });
    expect(harness.calls.some(({ reason }) => reason === "unknown_decision")).toBe(true);
  });

  it("honors the existing same-block disagreement fallback", () => {
    const prepass = prepareCourseDecisions([{ id: "b", text }]);
    const resolution = resolveCourseUnitWithReason(prepass, "b", text, position, () => "round");
    expect(resolution).toEqual({ unit: "round", source: "fallback",
      reason: "typed_disagrees_with_legacy", typedUnit: "row" });
    const resolver = vi.fn((context: string, offset: number) =>
      resolveCourseUnitWithReason(prepass, "b", context, offset, () => "round").unit);
    expect(normalizeTranslationStyle(line, "probe", "en", "pattern", text, position,
      { resolveCourseUnit: resolver })).toBe(output("rounds"));
    expect(resolver).toHaveBeenCalledExactlyOnceWith(text, position);
  });

  it("upstream normalization follows real authority, fallback, disagreement and cross-block gates", () => {
    const same = prepareCourseDecisions([{ id: "b", text }]);
    const isolated = prepareCourseDecisions([{ id: "b", text: line }]);
    const cross = prepareCrossBlockCourseDecisions([
      { id: "evidence", text: turn }, { id: "b", text: line },
    ], ["evidence", "b"]);
    const scenarios = [
      { context: text, offset: position, prepass: same, expected: "rows" },
      { context: line, offset: 0, prepass: isolated, expected: "rounds" },
      { context: text, offset: position, prepass: same, expected: "rounds", fallback: () => "round" as const },
      { context: line, offset: 0, prepass: isolated, expected: "rows", cross },
    ];
    for (const scenario of scenarios) {
      const resolver = vi.fn((context: string, offset: number) =>
        resolveCourseUnitWithReason(scenario.prepass, "b", context, offset,
          scenario.fallback, scenario.cross).unit);
      expect(normalizeSourceNaturalLanguageDetailed(line, "en", "pattern",
        scenario.context, scenario.offset, { resolveCourseUnit: resolver }).text)
        .toBe(output(scenario.expected).replace("42sc", "42x"));
      expect(resolver).toHaveBeenCalledExactlyOnceWith(scenario.context, scenario.offset);
    }
  });

  it("uses trusted cross-block rows without reordering results", async () => {
    const results = await translateBlocks([
      { id: "count", text: line, readingOrder: 1 },
      { id: "evidence", text: turn, readingOrder: 0 },
    ], "en", { provider: new EchoProvider() });
    expect(results.map(({ id }) => id)).toEqual(["count", "evidence"]);
    expect(results[0]).toMatchObject({ source: line, translated: output("rows"), valid: true, errors: [] });
  });
});

describe("written-chain resolver ownership (Task 14E)", () => {
  const line = "11-35) 25 sıra 12x bir zincir çekip ipimizi kesiyoruz.";
  const turn = "10) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.";
  const text = `${turn}\n${line}`;
  const position = text.indexOf(line);
  const output = (unit: string) =>
    `11-35) 25 ${unit}, 12sc. Ch 1 and cut the yarn.`;

  it("normalizes in original UTF-16 coordinates after earlier replacements", () => {
    const source = `🧶\r\n${turn}\r\n${line}`;
    const resolver = vi.fn(() => "row" as const);
    const normalized = normalizeSourceNaturalLanguageDetailed(source, "en", "pattern", source, 0,
      { resolveCourseUnit: resolver }).text;
    expect(normalized).toBe(`🧶\r\n10) At the end of each row, ch 1 and turn.\r\n${output("rows")}`);
    expect(resolver).toHaveBeenCalledExactlyOnceWith(source, source.indexOf(line));
  });

  it.each(["row", "round"] as const)("uses injected %s at the exact block offset", (unit) => {
    const resolver = vi.fn(() => unit);
    expect(normalizeTranslationStyle(line, "probe", "en", "pattern", text, position,
      { resolveCourseUnit: resolver })).toBe(output(`${unit}s`));
    expect(resolver).toHaveBeenCalledExactlyOnceWith(text, position);
    resolver.mockClear();
    expect(normalizeSourceNaturalLanguageDetailed(line, "en", "pattern", text, position,
      { resolveCourseUnit: resolver }).text).toBe(output(`${unit}s`));
    expect(resolver).toHaveBeenCalledExactlyOnceWith(text, position);
  });

  it.each(["row", "round"] as const)("keeps singular %s and punctuation", (unit) => {
    const singular = line.replace("25 sıra", "1 sıra");
    expect(normalizeTranslationStyle(singular, "probe", "en", "pattern", singular, 0,
      { resolveCourseUnit: () => unit })).toBe(output(unit).replace("11-35) 25 ", "11-35) 1 "));
  });

  it("keeps rounds without typed evidence", async () => {
    const [result] = await translate([{ id: "b", text: line }]);
    expect(result).toMatchObject({ translated: output("rounds"), valid: true, errors: [] });
    expect(harness.calls.some(({ reason }) => reason === "unknown_decision")).toBe(true);
  });

  it("honors the existing same-block disagreement fallback", () => {
    const prepass = prepareCourseDecisions([{ id: "b", text }]);
    const resolution = resolveCourseUnitWithReason(prepass, "b", text, position, () => "round");
    expect(resolution).toEqual({ unit: "round", source: "fallback",
      reason: "typed_disagrees_with_legacy", typedUnit: "row" });
    const resolver = vi.fn((context: string, offset: number) =>
      resolveCourseUnitWithReason(prepass, "b", context, offset, () => "round").unit);
    expect(normalizeTranslationStyle(line, "probe", "en", "pattern", text, position,
      { resolveCourseUnit: resolver })).toBe(output("rounds"));
    expect(resolver).toHaveBeenCalledExactlyOnceWith(text, position);
  });

  it("upstream normalization follows real authority, fallback, disagreement and cross-block gates", () => {
    const same = prepareCourseDecisions([{ id: "b", text }]);
    const isolated = prepareCourseDecisions([{ id: "b", text: line }]);
    const cross = prepareCrossBlockCourseDecisions([
      { id: "evidence", text: turn }, { id: "b", text: line },
    ], ["evidence", "b"]);
    const scenarios = [
      { context: text, offset: position, prepass: same, expected: "rows" },
      { context: line, offset: 0, prepass: isolated, expected: "rounds" },
      { context: text, offset: position, prepass: same, expected: "rounds", fallback: () => "round" as const },
      { context: line, offset: 0, prepass: isolated, expected: "rows", cross },
    ];
    for (const scenario of scenarios) {
      const resolver = vi.fn((context: string, offset: number) =>
        resolveCourseUnitWithReason(scenario.prepass, "b", context, offset,
          scenario.fallback, scenario.cross).unit);
      expect(normalizeSourceNaturalLanguageDetailed(line, "en", "pattern",
        scenario.context, scenario.offset, { resolveCourseUnit: resolver }).text)
        .toBe(output(scenario.expected));
      expect(resolver).toHaveBeenCalledExactlyOnceWith(scenario.context, scenario.offset);
    }
  });

  it("uses trusted cross-block rows without reordering results", async () => {
    const results = await translateBlocks([
      { id: "count", text: line, readingOrder: 1 },
      { id: "evidence", text: turn, readingOrder: 0 },
    ], "en", { provider: new EchoProvider() });
    expect(results.map(({ id }) => id)).toEqual(["count", "evidence"]);
    expect(results[0]).toMatchObject({ source: line, translated: output("rows"), valid: true, errors: [] });
  });
});

describe("course unit wiring: R3 stays known-bad (no cross-block carry)", () => {
  it("block 2 keeps today's '13) 16sc for 5 rounds'", async () => {
    const results = await translate([
      { id: "local-block-1", text: TURN },
      { id: "local-block-2", text: R3_BLOCK_2 },
    ]);
    expect(texts(results)).toEqual([
      { translated: TURN_EN, valid: true, errors: [] },
      { translated: "13) 16sc for 5 rounds", valid: true, errors: [] },
    ]);
    // Only block 2 has a course count; its same-block decision is unknown.
    expect(new Set(harness.calls.map(({ blockId }) => blockId))).toEqual(new Set(["local-block-2"]));
    expect(harness.calls.every(({ source }) => source === "fallback")).toBe(true);
    expect(harness.calls.some(({ reason }) => reason === "unknown_decision")).toBe(true);
  });

  it("gives block 2 the same result in either block order", async () => {
    const forward = await translate([
      { id: "local-block-1", text: TURN },
      { id: "local-block-2", text: R3_BLOCK_2 },
    ]);
    const reversed = await translate([
      { id: "local-block-2", text: R3_BLOCK_2 },
      { id: "local-block-1", text: TURN },
    ]);
    expect(reversed[0]).toEqual(forward[1]);
  });
});

describe("course unit wiring: same-block behavior is unchanged", () => {
  it("same-block row: the typed row is live, agrees with legacy, and output is today's", async () => {
    const results = await translate([{ id: "b", text: `${TURN}\n${R3_BLOCK_2}` }]);
    expect(texts(results)).toEqual([
      { translated: `${TURN_EN}\n13) 16sc for 5 rows`, valid: true, errors: [] },
    ]);
    expect(harness.calls.some(({ source }) => source === "typed")).toBe(true);
    expect(harness.calls.some(({ reason }) => reason === "typed_disagrees_with_legacy")).toBe(false);
  });

  it.each([
    [
      "a blank line between the turn and the count",
      `${TURN}\n\n${R3_BLOCK_2}`,
      `${TURN_EN}\n\n13) 16sc for 5 rounds`,
    ],
    [
      "a yarn cut between the turn and the count",
      `${TURN}\nipimizi kesiyoruz\n${R3_BLOCK_2}`,
      `${TURN_EN}\nipimizi kesiyoruz\n13) 16sc for 5 rounds`,
    ],
    [
      "turn evidence on an unnumbered line",
      "12) 3x\nBütün sıra sonlarında 1 zincir çekip dönüyoruz.\n13) 5 sıra 16x",
      "12) 3sc\nAt the end of each row, ch 1 and turn.\n13) 16sc for 5 rounds",
    ],
  ])("former disagreement (%s): typed is now unknown, legacy round stays and output is today's", async (_label, text, expected) => {
    const results = await translate([{ id: "b", text }]);
    expect(texts(results)).toEqual([{ translated: expected, valid: true, errors: [] }]);
    expect(harness.calls.some(({ reason }) => reason === "unknown_decision")).toBe(true);
    expect(harness.calls.some(({ reason }) => reason === "typed_disagrees_with_legacy")).toBe(false);
    expect(harness.calls.some(({ source }) => source === "typed")).toBe(false);
  });

  it("duplicate block ids disable the pre-pass: every block falls back and output is unchanged", async () => {
    const results = await translate([
      { id: "x", text: `${TURN}\n${R3_BLOCK_2}` },
      { id: "x", text: R3_BLOCK_2 },
    ]);
    expect(results.map(({ translated }) => translated)).toEqual([
      `${TURN_EN}\n13) 16sc for 5 rows`,
      "13) 16sc for 5 rounds",
    ]);
    expect(harness.calls.every(({ reason }) => reason === "prepass_disabled")).toBe(true);
  });
});

describe("course unit wiring: every owner receives the block resolver", () => {
  it("segment path: a forced row reaches the normalizer, style normalizer and both validators", async () => {
    harness.forced = "row";
    const [result] = await translate([{ id: "b", text: R3_BLOCK_2 }]);
    expect(texts([result!])).toEqual([{ translated: "13) 16sc for 5 rows", valid: true, errors: [] }]);
    // The block's own text is the context for every call except the
    // deterministic-resolution probe, which passes the marker-stripped body.
    expect(harness.calls.every(({ blockId }) => blockId === "b")).toBe(true);
    expect(harness.calls.filter(({ context }) => context === R3_BLOCK_2).length).toBeGreaterThan(0);
    expect(
      harness.calls.filter(({ context }) => context !== R3_BLOCK_2).every(({ reason }) => reason === "unsupported_source_context"),
    ).toBe(true);
  });

  it("segment path: a forced round keeps today's output", async () => {
    harness.forced = "round";
    const [result] = await translate([{ id: "b", text: R3_BLOCK_2 }]);
    expect(result?.translated).toBe("13) 16sc for 5 rounds");
    expect(result?.valid).toBe(true);
  });

  describe("formatting-unit path (h-2c6ae438a1)", () => {
    const found = loadCorpus().cases.find(({ caseId }) => caseId.startsWith("h-2c6ae438a1"))!;
    const block = found.value.request.blocks[0]!;
    const golden = found.value.expected!.results[0]!;
    const run = () => translateBlocks([block], "en", { provider: new NoProvider() });

    it("keeps the golden text and formatting runs, with the resolver asked in block coordinates", async () => {
      expect((block.formattingRegions ?? []).length).toBeGreaterThan(1);
      const [result] = await run();
      expect(result?.translated).toBe(golden.translated);
      expect(result?.targetFormattingRegions).toEqual(golden.targetFormattingRegions);
      expect(harness.calls.length).toBeGreaterThan(0);
      expect(harness.calls.every(({ blockId }) => blockId === block.id)).toBe(true);
      expect(harness.calls.some(({ context }) => context === block.text)).toBe(true);
    });

    it("a forced row reaches the unit segments and the final full-block validator", async () => {
      harness.forced = "row";
      const [result] = await run();
      expect(result?.translated.startsWith("2-11) 64sc for 10 rows\n")).toBe(true);
      expect(result?.valid).toBe(true);
      expect(result?.errors).toEqual([]);
    });
  });
});

describe("style wording cannot override resolver-owned course counts (Task 14G)", () => {
  // Task 14F probe sources. With no turning evidence in the segment, the style
  // normalizer's segment-wide row -> round rule is active; it must leave the
  // resolver's rendering of each course-count clause alone.
  const writtenChain = "13) 5 sıra 16x bir zincir çekip ipimizi kesiyoruz. Sonra dikiyoruz.";
  const writtenChainEn = (unit: string) =>
    `13) 5 ${unit}, 16sc. Ch 1 and cut the yarn. Sonra dikiyoruz.`;
  const armJoining = "13) 15 sıra 42x, İpimizi kesmeden kol birleştirme ile devam ediyoruz.";
  const armJoiningEn = (unit: string) =>
    `13) 15 ${unit}, 42sc. Without cutting the yarn, continue by joining the arms.`;
  const crossBlock = (text: string) =>
    translateBlocks([
      { id: "a", text: TURN, readingOrder: 0 },
      { id: "b", text, readingOrder: 1 },
    ], "en", { provider: new EchoProvider() });
  const callsFor = (blockId: string) => harness.calls.filter((call) => call.blockId === blockId);

  it("cross-block written-chain + trailing prose keeps the resolver's rows", async () => {
    const [, result] = await crossBlock(writtenChain);
    expect(result).toMatchObject({
      id: "b", source: writtenChain, translated: writtenChainEn("rows"), valid: true, errors: [],
    });
    const blocks = [{ id: "a", text: TURN }, { id: "b", text: writtenChain }];
    expect(resolveCourseUnitWithReason(
      prepareCourseDecisions(blocks), "b", writtenChain, 0, undefined,
      prepareCrossBlockCourseDecisions(blocks, ["a", "b"]),
    )).toEqual({ unit: "row", source: "typed_cross_block", typedUnit: "row" });
    const calls = callsFor("b");
    expect(calls.length).toBeGreaterThan(0);
    // Source mapping: every question is asked inside the count line of block b.
    expect(calls.every(({ context, position }) =>
      context === writtenChain && position >= 0 && position < writtenChain.length)).toBe(true);
  });

  it("same-block written-chain + trailing prose keeps typed rows, with unchanged formatting projection", async () => {
    const text = `${TURN}\n${writtenChain}`;
    const position = text.indexOf(writtenChain);
    const prepass = prepareCourseDecisions([{ id: "b", text }]);
    expect(resolveCourseUnitWithReason(prepass, "b", text, position)).toEqual({
      unit: "row", source: "typed", typedUnit: "row",
    });
    // Separate formatting regions translate the count without the turn in its
    // segment, so the segment-wide wording rule is active for it.
    const [result] = await translateBlocks([{
      id: "b", text,
      formattingRegions: [
        { id: "turn", start: 0, end: position },
        { id: "count", start: position, end: text.length },
      ],
    }], "en", { provider: new EchoProvider() });
    const expected = `${TURN_EN}\n${writtenChainEn("rows")}`;
    expect(result).toMatchObject({ translated: expected, valid: true, errors: [] });
    expect(result?.targetFormattingRegions).toEqual([
      { id: "turn", start: 0, end: TURN_EN.length + 1 },
      { id: "count", start: TURN_EN.length + 1, end: expected.length },
    ]);
  });

  it("arm-joining followed by prose keeps the resolver's rows", async () => {
    const [, result] = await crossBlock(`${armJoining}\nSonra dikiyoruz.`);
    expect(result).toMatchObject({
      translated: `${armJoiningEn("rows")}\nSonra dikiyoruz.`, valid: true, errors: [],
    });
  });

  it("scope boundary: same-line prose after arm-joining is owned by the generic count (Task 14H)", async () => {
    // The arm-joining structure stays line-anchored, so this shape falls to the
    // generic course count, which since Task 14H asks the resolver.
    const [, result] = await crossBlock(`${armJoining.slice(0, -1)}. Sonra dikiyoruz.`);
    expect(result?.translated).toBe(
      "13) 15 rows, 42sc. Without cutting the yarn, continue by joining the arms. Sonra dikiyoruz.",
    );
  });

  it("a bare course count in a mixed segment keeps the resolver's rows", async () => {
    const [, result] = await crossBlock("13) 5 sıra 16x\nSonra dikiyoruz.");
    expect(result).toMatchObject({
      translated: "13) 16sc for 5 rows\nSonra dikiyoruz.", valid: true, errors: [],
    });
  });

  it("a forced round resolver still renders rounds", async () => {
    harness.forced = "round";
    const [, result] = await crossBlock(writtenChain);
    expect(result).toMatchObject({ translated: writtenChainEn("rounds"), valid: true, errors: [] });
  });

  it("without typed authority the legacy fallback still renders rounds", async () => {
    const [result] = await translate([{ id: "b", text: writtenChain }]);
    expect(result).toMatchObject({ translated: writtenChainEn("rounds"), valid: true, errors: [] });
    const calls = callsFor("b");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(({ source }) => source === "fallback")).toBe(true);
  });

  it("protection is span-level: unrelated row wording on the same line is still rewritten", () => {
    const source = "13) 5 sıra 16x bir zincir çekip ipimizi kesiyoruz. Sıranın sonunu dikiyoruz.";
    const resolver = vi.fn(() => "row" as const);
    expect(normalizeTranslationStyle(
      source,
      "13) 5 rows, 16sc. Ch 1 and cut the yarn. Sew the end of the row.",
      "en", "pattern", source, 0, { resolveCourseUnit: resolver },
    )).toBe("13) 5 rows, 16sc. Ch 1 and cut the yarn. Sew the end of the round.");
    expect(resolver).toHaveBeenCalledExactlyOnceWith(source, 0);
  });

  it("text the resolver does not own keeps today's row -> round rewrite", () => {
    const source = "Sıranın sonunu dikiyoruz.";
    const resolver = vi.fn(() => "row" as const);
    expect(normalizeTranslationStyle(source, "Sew the end of the rows.", "en", "pattern",
      source, 0, { resolveCourseUnit: resolver })).toBe("Sew the end of the rounds.");
    expect(resolver).not.toHaveBeenCalled();
  });

  it.each(["row", "round"] as const)(
    "unequal line counts: resolver %s renderings survive, other wording is rewritten",
    (unit) => {
      const source = `13) 5 sıra 16x\n${writtenChain}`;
      const words = `${unit}s`;
      const resolver = vi.fn(() => unit);
      // The provider merged two source lines into one.
      expect(normalizeTranslationStyle(
        source,
        `13) 16x for 5 ${words} 13) 5 ${words}, 16sc. Ch 1 and cut the yarn. Then the next row.`,
        "en", "pattern", source, 0, { resolveCourseUnit: resolver },
      )).toBe(`13) 16x for 5 ${words} 13) 5 ${words}, 16sc. Ch 1 and cut the yarn. Then the next round.`);
      expect(resolver).toHaveBeenCalledWith(source, 0);
      expect(resolver).toHaveBeenCalledWith(source, source.indexOf(writtenChain));
    },
  );

  it("validation follows the resolver: rows pass, rounds fail for written-chain and bare counts (Task 15A)", () => {
    const text = `${TURN}\n${writtenChain}`;
    const position = text.indexOf(writtenChain);
    const options = { sourceContext: text, sourceStart: position, resolveCourseUnit: () => "row" as const };
    expect(validateTranslation(writtenChain, writtenChainEn("rows"), "en", options))
      .toEqual({ valid: true, errors: [], warnings: [] });
    // Task 15A: written-chain wording is checked against the same resolver.
    expect(validateTranslation(writtenChain, writtenChainEn("rounds"), "en", options).errors
      .map(({ code }) => code)).toEqual(["NUMBER_MISMATCH"]);
    expect(validateTranslation("13) 5 sıra 16x", "13) 16sc for 5 rounds", "en",
      { resolveCourseUnit: () => "row" }).errors.map(({ code }) => code)).toEqual(["NUMBER_MISMATCH"]);
  });
});

describe("generic course-count resolver ownership (Task 14H)", () => {
  // Task 14F probe source: two generic counts on one line, no specialized family.
  const line = "13) 5 sıra 16x, 6 sıra 18x";
  const firstCount = line.indexOf("5 sıra");
  const secondCount = line.indexOf("6 sıra");
  const rendered = (first: string, second: string, notation = "sc") =>
    `13) 5 ${first}, 16${notation}, 6 ${second}, 18${notation}`;
  const sameBlock = `${TURN}\n${line}`;
  const crossBlocks = [
    { id: "a", text: TURN, readingOrder: 0 },
    { id: "b", text: line, readingOrder: 1 },
  ];

  it("same-block typed row renders rows for every count", async () => {
    const position = sameBlock.indexOf(line);
    expect(resolveCourseUnitWithReason(prepareCourseDecisions([{ id: "b", text: sameBlock }]),
      "b", sameBlock, position + firstCount)).toEqual({ unit: "row", source: "typed", typedUnit: "row" });
    const [result] = await translate([{ id: "b", text: sameBlock }]);
    expect(result).toMatchObject({
      translated: `${TURN_EN}\n${rendered("rows", "rows")}`, valid: true, errors: [],
    });
  });

  it("trusted cross-block row renders rows, and the 14G style rule does not revert them", async () => {
    const results = await translateBlocks(crossBlocks, "en", { provider: new EchoProvider() });
    expect(results.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(results[1]).toMatchObject({
      source: line, translated: rendered("rows", "rows"), valid: true, errors: [],
    });
  });

  it.each(["row", "round"] as const)(
    "forced %s: each count asks the resolver once at its own exact source offset",
    (unit) => {
      const resolver = vi.fn(() => unit);
      const context = `${TURN}\n${line}`;
      const offset = context.indexOf(line);
      expect(normalizeSourceNaturalLanguageDetailed(line, "en", "pattern", context, offset,
        { resolveCourseUnit: resolver }).text).toBe(rendered(`${unit}s`, `${unit}s`, "x"));
      expect(resolver.mock.calls).toEqual([
        [context, offset + firstCount],
        [context, offset + secondCount],
      ]);
    },
  );

  it("multiple counts are resolved independently, not once per line", () => {
    const resolver = vi.fn((_context: string, position: number) =>
      position === secondCount ? "row" as const : "round" as const);
    expect(normalizeSourceNaturalLanguageDetailed(line, "en", "pattern", line, 0,
      { resolveCourseUnit: resolver }).text).toBe(rendered("rounds", "rows", "x"));
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("without typed authority the legacy fallback renders rounds", async () => {
    const [result] = await translate([{ id: "b", text: line }]);
    expect(result).toMatchObject({ translated: rendered("rounds", "rounds"), valid: true, errors: [] });
    const calls = harness.calls.filter(({ blockId }) => blockId === "b");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(({ source, reason }) => source === "fallback" && reason === "unknown_decision"))
      .toBe(true);
  });

  it("typed/legacy disagreement keeps the fail-closed fallback", () => {
    const position = sameBlock.indexOf(line);
    const prepass = prepareCourseDecisions([{ id: "b", text: sameBlock }]);
    const resolver = vi.fn((context: string, offset: number) =>
      resolveCourseUnitWithReason(prepass, "b", context, offset, () => "round").unit);
    expect(resolveCourseUnitWithReason(prepass, "b", sameBlock, position + firstCount, () => "round"))
      .toEqual({ unit: "round", source: "fallback", reason: "typed_disagrees_with_legacy", typedUnit: "row" });
    expect(normalizeSourceNaturalLanguageDetailed(line, "en", "pattern", sameBlock, position,
      { resolveCourseUnit: resolver }).text).toBe(rendered("rounds", "rounds", "x"));
  });

  it.each(["row", "round"] as const)("singular counts use 1 %s, never a plural", (unit) => {
    const singular = "13) 1 sıra 16x, 1 sıra 18x";
    const text = normalizeSourceNaturalLanguageDetailed(singular, "en", "pattern", singular, 0,
      { resolveCourseUnit: () => unit }).text;
    expect(text).toBe(`13) 1 ${unit}, 16x, 1 ${unit}, 18x`);
    expect(text).not.toMatch(/\b1 (?:rows|rounds)\b/u);
  });

  it("preserves separators, punctuation and trailing prose exactly", () => {
    const source = "13) 5 sıra 16x; 6 sıra 18x. Sonra dikiyoruz.";
    expect(normalizeSourceNaturalLanguageDetailed(source, "en", "pattern", source, 0,
      { resolveCourseUnit: () => "row" }).text).toBe("13) 5 rows, 16x; 6 rows, 18x. Sonra dikiyoruz.");
  });

  it("trailing prose after a generic count follows the resolver (Task 14F source)", async () => {
    const tail = "13) 6 sıra 18x - ipimizi kesiyoruz ve dikiyoruz.";
    const [same] = await translate([{ id: "b", text: `${TURN}\n${tail}` }]);
    expect(same).toMatchObject({
      translated: `${TURN_EN}\n13) 6 rows, 18sc - ipimizi kesiyoruz ve dikiyoruz.`, valid: true, errors: [],
    });
  });

  it("keeps the precedence of the earlier compact chain-cut replacement: the resolver is not asked", () => {
    const resolver = vi.fn(() => "row" as const);
    const source = "13) 5 sıra 16x, 1 zincir çekip ipimizi kesiyoruz, sonra dikiyoruz.";
    expect(normalizeSourceNaturalLanguageDetailed(source, "en", "pattern", source, 0,
      // The count stays notation in the normalizer output ("16sc" after reconstruction, Task 23G).
      { resolveCourseUnit: resolver }).text).toBe("13) 5 sıra 16x. Ch 1 and cut the yarn, sonra dikiyoruz.");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("the örüyoruz variant keeps its own rendering; the generic count does not double-handle it (Task 14I)", () => {
    const resolver = vi.fn(() => "row" as const);
    const source = "13-38) 26 sıra 14x örüyoruz, 1 zincir çekip ipimizi kesiyoruz.";
    expect(normalizeSourceNaturalLanguageDetailed(source, "en", "pattern", source, 0,
      { resolveCourseUnit: resolver }).text).toBe("13-38) 26 rows, 14 sc. Ch 1 and cut the yarn.");
    expect(resolver.mock.calls).toEqual([[source, 0]]);
  });

  it("style protection keeps generic rows in the restored sc notation; other wording is still rewritten", () => {
    const source = `${line}. Sıranın sonunu dikiyoruz.`;
    const resolver = vi.fn(() => "row" as const);
    expect(normalizeTranslationStyle(source,
      `${rendered("rows", "rows")}. Sew the end of the row.`,
      "en", "pattern", source, 0, { resolveCourseUnit: resolver },
    )).toBe(`${rendered("rows", "rows")}. Sew the end of the round.`);
    expect(resolver.mock.calls).toEqual([[source, firstCount], [source, secondCount]]);
  });

  it("formatting projection stays exact for the migrated output", async () => {
    const position = sameBlock.indexOf(line);
    const [result] = await translateBlocks([{
      id: "b", text: sameBlock,
      formattingRegions: [
        { id: "turn", start: 0, end: position },
        { id: "count", start: position, end: sameBlock.length },
      ],
    }], "en", { provider: new EchoProvider() });
    const expected = `${TURN_EN}\n${rendered("rows", "rows")}`;
    expect(result).toMatchObject({ translated: expected, valid: true, errors: [] });
    expect(result?.targetFormattingRegions).toEqual([
      { id: "turn", start: 0, end: TURN_EN.length + 1 },
      { id: "count", start: TURN_EN.length + 1, end: expected.length },
    ]);
  });

  it("validator follows the resolver for generic counts (Task 15A)", () => {
    const options = { resolveCourseUnit: () => "row" as const };
    expect(validateTranslation(line, rendered("rows", "rows"), "en", options).valid).toBe(true);
    expect(validateTranslation(line, rendered("rounds", "rounds"), "en", options).valid).toBe(false);
  });
});

describe("örüyoruz chain-cut resolver ownership (Task 14I)", () => {
  // Task 14F probe source (normalizer and translator tests).
  const line = "13-38) 26 sıra 14x örüyoruz, 1 zincir çekip ipimizi kesiyoruz.";
  const output = (unit: string) => `13-38) 26 ${unit}, 14 sc. Ch 1 and cut the yarn.`;
  const sameBlock = `${TURN}\n${line}`;
  const position = sameBlock.indexOf(line);

  it("same-block typed row renders rows", async () => {
    expect(resolveCourseUnitWithReason(prepareCourseDecisions([{ id: "b", text: sameBlock }]),
      "b", sameBlock, position)).toEqual({ unit: "row", source: "typed", typedUnit: "row" });
    const [result] = await translate([{ id: "b", text: sameBlock }]);
    expect(result).toMatchObject({ translated: `${TURN_EN}\n${output("rows")}`, valid: true, errors: [] });
  });

  it("trusted cross-block row renders rows without reordering results", async () => {
    const results = await translateBlocks([
      { id: "b", text: line, readingOrder: 1 },
      { id: "a", text: TURN, readingOrder: 0 },
    ], "en", { provider: new EchoProvider() });
    expect(results.map(({ id }) => id)).toEqual(["b", "a"]);
    expect(results[0]).toMatchObject({ source: line, translated: output("rows"), valid: true, errors: [] });
  });

  it.each(["row", "round"] as const)(
    "forced %s asks the resolver exactly once, at the clause's exact block offset",
    (unit) => {
      const resolver = vi.fn(() => unit);
      expect(normalizeSourceNaturalLanguageDetailed(line, "en", "pattern", sameBlock, position,
        { resolveCourseUnit: resolver }).text).toBe(output(`${unit}s`));
      expect(resolver.mock.calls).toEqual([[sameBlock, position]]);
    },
  );

  it("without typed authority the legacy fallback renders rounds", async () => {
    const [result] = await translate([{ id: "b", text: line }]);
    expect(result).toMatchObject({ translated: output("rounds"), valid: true, errors: [] });
    const calls = harness.calls.filter(({ blockId }) => blockId === "b");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(({ source, reason }) => source === "fallback" && reason === "unknown_decision"))
      .toBe(true);
  });

  it("typed/legacy disagreement keeps the fail-closed fallback", () => {
    const prepass = prepareCourseDecisions([{ id: "b", text: sameBlock }]);
    expect(resolveCourseUnitWithReason(prepass, "b", sameBlock, position, () => "round")).toEqual({
      unit: "round", source: "fallback", reason: "typed_disagrees_with_legacy", typedUnit: "row",
    });
    const resolver = vi.fn((context: string, offset: number) =>
      resolveCourseUnitWithReason(prepass, "b", context, offset, () => "round").unit);
    expect(normalizeSourceNaturalLanguageDetailed(line, "en", "pattern", sameBlock, position,
      { resolveCourseUnit: resolver }).text).toBe(output("rounds"));
    expect(resolver).toHaveBeenCalledExactlyOnceWith(sameBlock, position);
  });

  it.each(["row", "round"] as const)("singular uses 1 %s and preserves every count and the trailing prose", (unit) => {
    const singular = "13) 1 sıra 7x örüyoruz, 2 zincir çekip ipimizi kesiyoruz. Sonra dikiyoruz.";
    const text = normalizeSourceNaturalLanguageDetailed(singular, "en", "pattern", singular, 0,
      { resolveCourseUnit: () => unit }).text;
    expect(text).toBe(`13) 1 ${unit}, 7 sc. Ch 2 and cut the yarn. Sonra dikiyoruz.`);
    expect(text).not.toMatch(/\b1 (?:rows|rounds)\b/u);
  });

  it("style protection keeps rows when the segment-wide wording rule is active", () => {
    const source = `${line} Sıranın sonunu dikiyoruz.`;
    const resolver = vi.fn(() => "row" as const);
    expect(normalizeTranslationStyle(source, `${output("rows")} Sew the end of the row.`,
      "en", "pattern", source, 0, { resolveCourseUnit: resolver },
    )).toBe(`${output("rows")} Sew the end of the round.`);
    // Asked once for the clause; the generic count inside it is not asked again.
    expect(resolver.mock.calls).toEqual([[source, 0]]);
  });

  it("formatting projection stays exact", async () => {
    const [result] = await translateBlocks([{
      id: "b", text: sameBlock,
      formattingRegions: [
        { id: "turn", start: 0, end: position },
        { id: "count", start: position, end: sameBlock.length },
      ],
    }], "en", { provider: new EchoProvider() });
    const expected = `${TURN_EN}\n${output("rows")}`;
    expect(result).toMatchObject({ translated: expected, valid: true, errors: [] });
    expect(result?.targetFormattingRegions).toEqual([
      { id: "turn", start: 0, end: TURN_EN.length + 1 },
      { id: "count", start: TURN_EN.length + 1, end: expected.length },
    ]);
  });

  it("validator follows the resolver for this family (Task 15A)", () => {
    const options = { resolveCourseUnit: () => "row" as const };
    expect(validateTranslation(line, output("rows"), "en", options).valid).toBe(true);
    expect(validateTranslation(line, output("rounds"), "en", options).valid).toBe(false);
  });
});

describe("dash-separated yarn-cut typed coverage (Task 15B)", () => {
  const turn = "9) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.";
  const turnEn = "9) At the end of each row, ch 1 and turn.";
  const variants = [
    {
      line: "10-15) 6 sıra 18x --- ipimizi kesiyoruz.",
      output: (word: string) => `10-15) 18sc for 6 ${word} — cut the yarn.`,
    },
    {
      line: "10-15) 6 sıra 18x - ipimizi kesiyoruz ve dikiyoruz.",
      output: (word: string) => `10-15) 6 ${word}, 18sc - ipimizi kesiyoruz ve dikiyoruz.`,
    },
  ];

  describe.each(variants)("$line", ({ line, output }) => {
    const sameBlock = `${turn}\n${line}`;
    const position = sameBlock.indexOf(line);

    it("same-block: typed row is live and output stays rows", async () => {
      const prepass = prepareCourseDecisions([{ id: "b", text: sameBlock }]);
      expect(lookupTypedCourseUnit(prepass, "b", sameBlock, position)).toMatchObject({ kind: "typed", unit: "row" });
      expect(resolveCourseUnitWithReason(prepass, "b", sameBlock, position))
        .toEqual({ unit: "row", source: "typed", typedUnit: "row" });
      const [result] = await translate([{ id: "b", text: sameBlock }]);
      expect(result).toMatchObject({ translated: `${turnEn}\n${output("rows")}`, valid: true, errors: [] });
    });

    it("trusted cross-block row now reaches the variant without reordering results", async () => {
      const blocks = [{ id: "b", text: line, readingOrder: 1 }, { id: "a", text: turn, readingOrder: 0 }];
      expect(resolveCourseUnitWithReason(prepareCourseDecisions(blocks), "b", line, 0, undefined,
        prepareCrossBlockCourseDecisions(blocks, ["a", "b"])))
        .toEqual({ unit: "row", source: "typed_cross_block", typedUnit: "row" });
      const results = await translateBlocks(blocks, "en", { provider: new EchoProvider() });
      expect(results.map(({ id }) => id)).toEqual(["b", "a"]);
      expect(results[0]).toMatchObject({ source: line, translated: output("rows"), valid: true, errors: [] });
    });

    it("the validator agrees with the renderer's resolver decision", () => {
      const prepass = prepareCourseDecisions([{ id: "b", text: sameBlock }]);
      const resolver = (context: string, offset: number) =>
        resolveCourseUnitWithReason(prepass, "b", context, offset).unit;
      const options = { sourceContext: sameBlock, sourceStart: position, resolveCourseUnit: resolver };
      expect(validateTranslation(line, output("rows"), "en", options).valid).toBe(true);
      expect(validateTranslation(line, output("rounds"), "en", options).errors.map(({ code }) => code))
        .toEqual(["NUMBER_MISMATCH"]);
    });

    it("typed/legacy disagreement still fails closed", () => {
      const prepass = prepareCourseDecisions([{ id: "b", text: sameBlock }]);
      expect(resolveCourseUnitWithReason(prepass, "b", sameBlock, position, () => "round")).toEqual({
        unit: "round", source: "fallback", reason: "typed_disagrees_with_legacy", typedUnit: "row",
      });
    });

    it("without typed authority the legacy fallback renders rounds", async () => {
      const [result] = await translate([{ id: "b", text: line }]);
      expect(result).toMatchObject({ translated: output("rounds"), valid: true, errors: [] });
      const calls = harness.calls.filter(({ blockId }) => blockId === "b");
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every(({ source, reason }) => source === "fallback" && reason === "unknown_decision")).toBe(true);
    });
  });
});
