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
