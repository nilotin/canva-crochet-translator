import { describe, expect, it } from "vitest";
import {
  carryDeterministicSpans,
  isCarriedPatternOnly,
  protectCarriedBlock,
} from "../deterministic_carrier.js";
import {
  protectImmutablePattern,
  reservedPlaceholder,
  restoreImmutablePattern,
} from "../notation/immutable.js";
import type { DeterministicSpan } from "../natural_language/tracked_text.js";

/** Spans for each exact `pieces` occurrence, in order (test-only lookup). */
const spansOf = (text: string, pieces: readonly string[]): DeterministicSpan[] => {
  let from = 0;
  return pieces.map((piece) => {
    const start = text.indexOf(piece, from);
    from = start + piece.length;
    return { start, end: start + piece.length, text: piece };
  });
};
const rangeOf = (text: string, piece: string, from = 0) => {
  const start = text.indexOf(piece, from);
  return { start, end: start + piece.length };
};

describe("carryDeterministicSpans places every span and source-data range exactly (Task 23K-2)", () => {
  const text = "Ch 1 and turn. (Alize 3x) ve 6sc into the magic ring, sonra (Gazzal 1v) dikiyoruz.";
  const spans = spansOf(text, ["Ch 1 and turn.", "into the magic ring"]);

  it("replaces each span by the reserved placeholder of its own index", () => {
    const carried = carryDeterministicSpans(text, spans, []);
    expect(carried?.text).toBe(
      `${reservedPlaceholder(0)} (Alize 3x) ve 6sc ${reservedPlaceholder(1)}, sonra (Gazzal 1v) dikiyoruz.`,
    );
    expect([...(carried?.rendered ?? [])]).toEqual([
      [reservedPlaceholder(0), "Ch 1 and turn."],
      [reservedPlaceholder(1), "into the magic ring"],
    ]);
  });

  it("shifts source data between and after spans through the original span indices", () => {
    const carried = carryDeterministicSpans(text, spans, [rangeOf(text, "Alize 3x"), rangeOf(text, "Gazzal 1v")]);
    expect(carried?.opaqueRanges.map(({ start, end }) => carried.text.slice(start, end))).toEqual([
      "Alize 3x",
      "Gazzal 1v",
    ]);
  });

  it("drops source data that a span already carries verbatim", () => {
    const yarn = "Start with red yarn (Alize 3x) ve kenarı dikiyoruz.";
    const carried = carryDeterministicSpans(yarn, spansOf(yarn, ["Start with red yarn (Alize 3x)"]), [rangeOf(yarn, "Alize 3x")]);
    expect(carried?.opaqueRanges).toEqual([]);
    expect(carried?.text).toBe(`${reservedPlaceholder(0)} ve kenarı dikiyoruz.`);
  });

  it.each([
    ["no spans", text, [], []],
    ["reserved placeholder syntax in the text", `${text} __XQAAAAQX__`, spans, []],
    ["overlapping spans", text, [spans[0]!, { start: 5, end: 20, text: text.slice(5, 20) }], []],
    ["spans out of order", text, [spans[1]!, spans[0]!], []],
    ["a span whose text no longer matches", text, [{ ...spans[0]!, text: "Ch 2 and turn." }], []],
    ["an empty span", text, [{ start: 3, end: 3, text: "" }], []],
    ["source data straddling a span boundary", text, spans, [{ start: spans[0]!.end - 3, end: spans[0]!.end + 3 }]],
  ] as const)("fails closed on %s", (_name, normalized, given, sourceData) => {
    expect(carryDeterministicSpans(normalized, given, sourceData)).toBeUndefined();
  });
});

describe("protectCarriedBlock protects whole blocks without collisions (Task 23K-2)", () => {
  const text = "Using a 2.20 mm crochet hook and black yarn (Alize 3x), work as follows. 3x örüyoruz, 5 cm sonra (Gazzal 1v) kenarı dikiyoruz.";
  const intro = "Using a 2.20 mm crochet hook and black yarn (Alize 3x), work as follows";
  const spans = spansOf(text, [intro]);
  const sourceData = [rangeOf(text, "Alize 3x"), rangeOf(text, "Gazzal 1v")];

  it("adds one structure token per span, keeps immutable placeholders disjoint and in text order", () => {
    const carried = carryDeterministicSpans(text, spans, sourceData)!;
    const block = protectCarriedBlock(carried, "pattern")!;
    expect(block.tokens[0]).toEqual({ kind: "structure", placeholder: reservedPlaceholder(0), source: intro });
    const placeholders = block.tokens.map(({ placeholder }) => placeholder);
    expect(new Set(placeholders).size).toBe(placeholders.length);
    expect([...block.text.matchAll(/__XQ[A-Z]{4}QX__/gu)].map(([match]) => match)).toEqual(placeholders);
    // Real notation and the measurement outside the span stay protected; the brand stays opaque.
    expect(block.tokens.filter(({ kind }) => kind === "notation")).toHaveLength(1);
    expect(block.tokens.filter(({ kind }) => kind === "measurement").map(({ source }) => source)).toEqual(["5 cm"]);
    expect(block.tokens.some((token) => token.kind === "structure" && token.source === "Gazzal 1v")).toBe(true);
    expect(block.text).not.toMatch(/Using|crochet hook|work as follows|Alize|Gazzal/u);
  });

  it("restores the exact block and checks integrity against the uncarried text", () => {
    const carried = carryDeterministicSpans(text, spans, sourceData)!;
    const block = protectCarriedBlock(carried, "pattern")!;
    const uncarried = protectImmutablePattern(text, 0, "pattern", sourceData);
    const restored = restoreImmutablePattern(block.text, block, "en", uncarried);
    expect(restored).toMatchObject({
      valid: true,
      text: "Using a 2.20 mm crochet hook and black yarn (Alize 3x), work as follows. 3sc örüyoruz, 5 cm sonra (Gazzal 1v) kenarı dikiyoruz.",
    });
    // A measurement or count lost from the carried text would still be caught.
    const lost = { ...block, tokens: block.tokens.map((token) => token.kind === "structure" && token.placeholder === reservedPlaceholder(0) ? { ...token, source: "Using a crochet hook" } : token) };
    expect(restoreImmutablePattern(block.text, lost, "en", uncarried).errors.map(({ code }) => code)).toContain(
      "MEASUREMENT_INTEGRITY_MISMATCH",
    );
  });

  it.each([
    ["dropped", (protectedText: string) => protectedText.replace(reservedPlaceholder(0), ""), "MISSING_PROTECTED_NOTATION"],
    ["duplicated", (protectedText: string) => `${protectedText} ${reservedPlaceholder(0)}`, "DUPLICATE_PROTECTED_NOTATION"],
    ["moved", (protectedText: string) => `${protectedText.replace(reservedPlaceholder(0), "")} ${reservedPlaceholder(0)}`, "REORDERED_PROTECTED_NOTATION"],
  ] as const)("rejects a %s carried placeholder", (_name, mutate, code) => {
    const carried = carryDeterministicSpans(text, spans, sourceData)!;
    const block = protectCarriedBlock(carried, "pattern")!;
    const restored = restoreImmutablePattern(mutate(block.text), block, "en", protectImmutablePattern(text));
    expect(restored.valid).toBe(false);
    expect(restored.errors.map(({ code: found }) => found)).toContain(code);
  });

  it("restores carried text containing `$` patterns verbatim", () => {
    const dollar = "Start with red yarn (Brand $& $' $1) ve 5 cm dikiyoruz.";
    const carried = carryDeterministicSpans(dollar, spansOf(dollar, ["Start with red yarn (Brand $& $' $1)"]), [])!;
    const block = protectCarriedBlock(carried, "pattern")!;
    expect(restoreImmutablePattern(block.text, block, "en", protectImmutablePattern(dollar)).text).toBe(dollar);
  });

  it("fails closed when a source-data range would not stay opaque", () => {
    const carried = carryDeterministicSpans(text, spans, sourceData)!;
    const broken = { ...carried, opaqueRanges: [...carried.opaqueRanges, { start: 0, end: carried.text.length + 5 }] };
    expect(protectCarriedBlock(broken, "pattern")).toBeUndefined();
  });

  it("knows when nothing is left for the provider", () => {
    const only = "✦ Using a 2.20 mm crochet hook and black yarn (Alize 3x), work as follows.\n1) 6x into the magic ring";
    const carried = carryDeterministicSpans(only, spansOf(only, [intro, "into the magic ring"]), [])!;
    expect(isCarriedPatternOnly(protectCarriedBlock(carried, "pattern")!)).toBe(true);
    const prose = carryDeterministicSpans(text, spans, sourceData)!;
    expect(isCarriedPatternOnly(protectCarriedBlock(prose, "pattern")!)).toBe(false);
  });
});
