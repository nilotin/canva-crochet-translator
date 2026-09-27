import { describe, expect, it } from "vitest";

import {
  prepareCourseDecisions,
  prepareCrossBlockCourseDecisions,
  resolveCourseUnitWithReason,
} from "../course_unit_resolution.js";
import { legacyCourseUnitResolver } from "../natural_language/bare_round_count.js";
import type {
  ProviderReadiness,
  TranslationProvider,
  TranslationProviderRequest,
  TranslationProviderResult,
} from "../providers/provider.js";
import { pageReadingOrder } from "../reading_order.js";
import { translateBlocks } from "../translator.js";

const TURN = "12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.";
const TURN_EN = "12) At the end of each row, ch 1 and turn.";
const COUNT = "13) 5 sıra 16x";

class EchoProvider implements TranslationProvider {
  readonly name = "echo";
  readonly model = "echo";

  async checkReadiness(): Promise<ProviderReadiness> {
    return { ok: true, provider: this.name, model: this.model };
  }

  async translate(
    request: TranslationProviderRequest,
  ): Promise<TranslationProviderResult> {
    return {
      translations: request.blocks.map(({ id, text }) => ({
        id,
        translated: text,
      })),
    };
  }
}

const trusted = [
  { id: "a", text: TURN, readingOrder: 0 },
  { id: "b", text: COUNT, readingOrder: 1 },
] as const;

describe("trusted cross-block translator integration", () => {
  it("fixes R3 with dense trusted reading order", async () => {
    const results = await translateBlocks(trusted, "en", {
      provider: new EchoProvider(),
    });

    expect(results.map(({ translated }) => translated)).toEqual([
      TURN_EN,
      "13) 16sc for 5 rows",
    ]);
    expect(results[1]?.valid).toBe(true);
    expect(results[1]?.errors).toEqual([]);
  });

  it("keeps request result order when request array is reversed", async () => {
    const results = await translateBlocks(
      [trusted[1], trusted[0]],
      "en",
      { provider: new EchoProvider() },
    );

    expect(results.map(({ id }) => id)).toEqual(["b", "a"]);
    expect(results[0]?.translated).toBe("13) 16sc for 5 rows");
    expect(results[0]?.valid).toBe(true);
  });

  it("reports typed_cross_block from the pure resolver", () => {
    const blocks = [...trusted];
    const same = prepareCourseDecisions(blocks);
    const order = pageReadingOrder(blocks);

    expect(order).toEqual(["a", "b"]);
    if (order === undefined) throw new Error("missing order");

    const cross = prepareCrossBlockCourseDecisions(blocks, order);

    expect(
      resolveCourseUnitWithReason(
        same,
        "b",
        COUNT,
        COUNT.indexOf("5 sıra"),
        legacyCourseUnitResolver,
        cross,
      ),
    ).toEqual({
      unit: "row",
      source: "typed_cross_block",
      typedUnit: "row",
    });
  });

  it("rejects unsafe N-dot cross-block override", () => {
    const first = {
      id: "a",
      text: "11) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.",
      readingOrder: 0,
    };
    const second = {
      id: "b",
      text: "12. ♦ Başlık\n13) 5 sıra 16x",
      readingOrder: 1,
    };

    const blocks = [first, second];
    const same = prepareCourseDecisions(blocks);
    const order = pageReadingOrder(blocks);

    expect(order).toEqual(["a", "b"]);
    if (order === undefined) throw new Error("missing order");

    const cross = prepareCrossBlockCourseDecisions(blocks, order);

    expect(
      resolveCourseUnitWithReason(
        same,
        "b",
        second.text,
        second.text.indexOf("5 sıra"),
        legacyCourseUnitResolver,
        cross,
      ),
    ).toMatchObject({
      unit: "round",
      source: "fallback",
      reason: "cross_block_disagrees_with_joined_legacy",
      typedUnit: "row",
    });
  });

  it.each([
    [
      "no metadata",
      [
        { id: "a", text: TURN },
        { id: "b", text: COUNT },
      ],
    ],
    [
      "one missing",
      [
        { id: "a", text: TURN, readingOrder: 0 },
        { id: "b", text: COUNT },
      ],
    ],
    [
      "duplicate",
      [
        { id: "a", text: TURN, readingOrder: 0 },
        { id: "b", text: COUNT, readingOrder: 0 },
      ],
    ],
    [
      "gap",
      [
        { id: "a", text: TURN, readingOrder: 0 },
        { id: "b", text: COUNT, readingOrder: 2 },
      ],
    ],
    [
      "not zero based",
      [
        { id: "a", text: TURN, readingOrder: 1 },
        { id: "b", text: COUNT, readingOrder: 2 },
      ],
    ],
  ] as const)("%s keeps block-local rounds", async (_label, blocks) => {
    const results = await translateBlocks(blocks, "en", {
      provider: new EchoProvider(),
    });

    expect(results[1]?.translated).toBe("13) 16sc for 5 rounds");
    expect(results[1]?.valid).toBe(true);
  });

  it("does not activate for materials", async () => {
    const results = await translateBlocks(trusted, "en", {
      provider: new EchoProvider(),
      contentKind: "materials",
    });

    expect(results[1]?.translated).toBe("13) 16sc for 5 rounds");
  });

  it("discontinuous numbering does not carry context", async () => {
    const results = await translateBlocks(
      [
        { id: "a", text: TURN, readingOrder: 0 },
        { id: "b", text: "14) 5 sıra 16x", readingOrder: 1 },
      ],
      "en",
      { provider: new EchoProvider() },
    );

    expect(results[1]?.translated).toBe("14) 16sc for 5 rounds");
  });

  it("blank-line reset does not carry context", async () => {
    const results = await translateBlocks(
      [
        { id: "a", text: `${TURN}\n`, readingOrder: 0 },
        { id: "b", text: COUNT, readingOrder: 1 },
      ],
      "en",
      { provider: new EchoProvider() },
    );

    expect(results[1]?.translated).toBe("13) 16sc for 5 rounds");
  });

  it("yarn-cut reset does not carry context", async () => {
    const results = await translateBlocks(
      [
        { id: "a", text: `${TURN}\nipimizi kesiyoruz`, readingOrder: 0 },
        { id: "b", text: COUNT, readingOrder: 1 },
      ],
      "en",
      { provider: new EchoProvider() },
    );

    expect(results[1]?.translated).toBe("13) 16sc for 5 rounds");
  });

  it("valid order without evidence is byte-identical", async () => {
    const ranked = [
      { id: "a", text: "12) 3x", readingOrder: 0 },
      { id: "b", text: COUNT, readingOrder: 1 },
    ];

    const plain = await translateBlocks(
      ranked.map(({ id, text }) => ({ id, text })),
      "en",
      { provider: new EchoProvider() },
    );

    const withOrder = await translateBlocks(ranked, "en", {
      provider: new EchoProvider(),
    });

    expect(withOrder).toEqual(plain);
  });

  it("does not mutate input blocks", async () => {
    const blocks = trusted.map((block) => ({ ...block }));
    const before = JSON.stringify(blocks);

    await translateBlocks(blocks, "en", {
      provider: new EchoProvider(),
    });

    expect(JSON.stringify(blocks)).toBe(before);
  });
});
