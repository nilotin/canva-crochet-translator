/**
 * Request reading order (next stage, Task 10).
 *
 * `readingOrder` is optional, opaque request metadata: the schema accepts any
 * value (a malformed one never fails a translation), `validatedReadingOrder`
 * is its only reader, and translation ignores it entirely: the array order
 * stays the translation order and outputs are unchanged, R3 included.
 */
import { describe, expect, it } from "vitest";
import { validatedReadingOrder } from "../reading_order.js";
import { translateBlocks } from "../translator.js";
import { translateRequestSchema, translationBlockSchema } from "../types.js";
import type { TranslationProvider } from "../providers/provider.js";

const blocks = (...orders: unknown[]) =>
  orders.map((readingOrder, index) => ({ id: `b${index}`, readingOrder }));

describe("validatedReadingOrder", () => {
  it("returns block ids in reading order when every value is valid and unique", () => {
    expect(validatedReadingOrder(blocks(2, 0, 1))).toEqual(["b1", "b2", "b0"]);
  });

  it("allows gaps", () => {
    expect(validatedReadingOrder(blocks(10, 3, 7))).toEqual(["b1", "b2", "b0"]);
  });

  it.each([
    ["a duplicate", blocks(0, 1, 1)],
    ["a negative value", blocks(0, -1)],
    ["a non-integer", blocks(0, 1.5)],
    ["an unsafe integer", blocks(0, 2 ** 53)],
    ["NaN", blocks(0, Number.NaN)],
    ["a numeric string", blocks(0, "1")],
    ["null", blocks(0, null)],
    ["one block without a value", [{ id: "b0", readingOrder: 0 }, { id: "b1" }]],
    ["no values at all", [{ id: "b0" }, { id: "b1" }]],
    ["an empty request", []],
  ])("returns undefined for %s", (_label, input) => {
    expect(validatedReadingOrder(input)).toBeUndefined();
  });

  it("does not mutate its input", () => {
    const input = blocks(1, 0);
    const before = JSON.stringify(input);
    validatedReadingOrder(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("translation request schema: readingOrder", () => {
  const request = (extra: Record<string, unknown>[]) => ({
    designToken: "design-jwt",
    sourceLanguage: "tr",
    targetLanguage: "en",
    blocks: extra.map((fields, index) => ({ id: `b${index}`, text: "Kulak", ...fields })),
  });

  it("accepts an old request without readingOrder and adds no key", () => {
    const parsed = translateRequestSchema.parse(request([{}, {}]));
    expect(parsed.blocks.map((block) => "readingOrder" in block)).toEqual([false, false]);
  });

  it("keeps valid readingOrder values and the array order", () => {
    const parsed = translateRequestSchema.parse(request([{ readingOrder: 1 }, { readingOrder: 0 }]));
    expect(parsed.blocks.map(({ id, readingOrder }) => [id, readingOrder])).toEqual([
      ["b0", 1],
      ["b1", 0],
    ]);
  });

  it.each([-1, 1.5, "2", null, { nested: true }])(
    "never rejects a request for a malformed readingOrder (%s)",
    (readingOrder) => {
      expect(translateRequestSchema.safeParse(request([{ readingOrder }])).success).toBe(true);
      expect(translationBlockSchema.safeParse({ id: "b", text: "Kulak", readingOrder }).success).toBe(true);
    },
  );

  it("accepts duplicate readingOrder values (the helper, not the schema, rejects them)", () => {
    const parsed = translateRequestSchema.parse(request([{ readingOrder: 0 }, { readingOrder: 0 }]));
    expect(validatedReadingOrder(parsed.blocks)).toBeUndefined();
  });
});

class EchoProvider implements TranslationProvider {
  readonly name = "echo";
  readonly model = "echo";
  readonly texts: string[] = [];
  async checkReadiness() {
    return { ok: true as const, provider: this.name, model: this.model };
  }
  async translate(request: Parameters<TranslationProvider["translate"]>[0]) {
    this.texts.push(request.userPrompt);
    return { translations: request.blocks.map(({ id, text }) => ({ id, translated: text })) };
  }
}

const R3 = [
  { id: "local-block-1", text: "12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz." },
  { id: "local-block-2", text: "13) 5 sıra 16x" },
];

describe("translateBlocks ignores readingOrder", () => {
  it("never reads the field", async () => {
    const trapped = R3.map((block) =>
      Object.defineProperty({ ...block }, "readingOrder", {
        enumerable: true,
        get: () => {
          throw new Error("readingOrder was read during translation.");
        },
      }),
    );
    const results = await translateBlocks(trapped, "en", { provider: new EchoProvider() });
    expect(results.map(({ translated }) => translated)).toEqual([
      "12) At the end of each row, ch 1 and turn.",
      "13) 16sc for 5 rounds",
    ]);
  });

  it.each([
    ["in reading order", [0, 1]],
    ["reversed", [1, 0]],
    ["malformed", [-1, "x"]],
    ["duplicated", [3, 3]],
  ] as const)("gives identical results and provider prompts with readingOrder %s (R3 stays rounds)", async (_label, orders) => {
    const plainProvider = new EchoProvider();
    const plain = await translateBlocks(R3, "en", { provider: plainProvider });
    const taggedProvider = new EchoProvider();
    const tagged = await translateBlocks(
      R3.map((block, index) => ({ ...block, readingOrder: orders[index] })),
      "en",
      { provider: taggedProvider },
    );
    expect(tagged).toEqual(plain);
    expect(taggedProvider.texts).toEqual(plainProvider.texts);
    expect(tagged.map(({ id }) => id)).toEqual(["local-block-1", "local-block-2"]);
    expect(tagged[1]?.translated).toBe("13) 16sc for 5 rounds");
  });
});
