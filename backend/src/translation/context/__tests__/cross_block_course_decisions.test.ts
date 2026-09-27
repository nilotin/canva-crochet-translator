import { describe, expect, it } from "vitest";

import {
  prepareCrossBlockCourseDecisions,
} from "../course_decisions.js";

const TURN = "12) Bütün sıra sonlarında 1 zincir çekip dönüyoruz.";
const COUNT = "13) 5 sıra 16x";

const enabled = (
  blocks: readonly { id: string; text: string }[],
  order: readonly string[],
) => {
  const result = prepareCrossBlockCourseDecisions(blocks, order);
  expect(result.status).toBe("enabled");
  if (result.status !== "enabled") throw new Error("pre-pass disabled");
  return result;
};

describe("prepareCrossBlockCourseDecisions", () => {
  it("carries row evidence into the next block", () => {
    const result = enabled(
      [
        { id: "a", text: TURN },
        { id: "b", text: COUNT },
      ],
      ["a", "b"],
    );

    expect(result.decisions.get("b")?.[0]).toMatchObject({
      courseKind: "row",
      scope: "cross_block",
      evidence: { blockId: "a" },
    });
  });

  it("uses supplied reading order instead of request array order", () => {
    const result = enabled(
      [
        { id: "b", text: COUNT },
        { id: "a", text: TURN },
      ],
      ["a", "b"],
    );

    expect(result.decisions.get("b")?.[0]).toMatchObject({
      courseKind: "row",
      scope: "cross_block",
      evidence: { blockId: "a" },
    });
  });

  it("builds exact joined text and offsets", () => {
    const result = enabled(
      [
        { id: "a", text: TURN },
        { id: "b", text: COUNT },
      ],
      ["a", "b"],
    );

    expect(result.joinedText).toBe(`${TURN}\n${COUNT}`);
    expect(result.blockStarts.get("a")).toBe(0);

    const start = result.blockStarts.get("b");
    expect(start).toBe(TURN.length + 1);
    if (start === undefined) throw new Error("missing block start");

    expect(result.joinedText.slice(start, start + COUNT.length)).toBe(COUNT);
  });

  it("labels evidence within the same block as same_block", () => {
    const result = enabled(
      [
        { id: "heading", text: "Malzemeler" },
        { id: "b", text: `${TURN}\n${COUNT}` },
      ],
      ["heading", "b"],
    );

    expect(result.decisions.get("b")?.[0]).toMatchObject({
      courseKind: "row",
      scope: "same_block",
      evidence: { blockId: "b" },
    });
  });

  it("resets on discontinuous numbering", () => {
    const result = enabled(
      [
        { id: "a", text: TURN },
        { id: "b", text: "14) 5 sıra 16x" },
      ],
      ["a", "b"],
    );

    expect(result.decisions.get("b")?.[0]?.courseKind).toBe("unknown");
  });

  it("resets across a blank line", () => {
    const result = enabled(
      [
        { id: "a", text: `${TURN}\n` },
        { id: "b", text: COUNT },
      ],
      ["a", "b"],
    );

    expect(result.decisions.get("b")?.[0]?.courseKind).toBe("unknown");
  });

  it("resets across yarn cut", () => {
    const result = enabled(
      [
        { id: "a", text: `${TURN}\nipimizi kesiyoruz` },
        { id: "b", text: COUNT },
      ],
      ["a", "b"],
    );

    expect(result.decisions.get("b")?.[0]?.courseKind).toBe("unknown");
  });

  it("breaks context around U+2028 line-model mismatch", () => {
    const result = enabled(
      [
        { id: "a", text: TURN },
        { id: "unsafe", text: "Başlık\u2028metin" },
        { id: "b", text: COUNT },
      ],
      ["a", "unsafe", "b"],
    );

    expect(result.decisions.get("b")?.[0]?.courseKind).toBe("unknown");
  });

  it("rejects incomplete order", () => {
    expect(
      prepareCrossBlockCourseDecisions(
        [
          { id: "a", text: TURN },
          { id: "b", text: COUNT },
        ],
        ["a"],
      ),
    ).toMatchObject({
      status: "disabled",
      reason: "invalid_reading_order",
    });
  });

  it("rejects duplicate block ids", () => {
    expect(
      prepareCrossBlockCourseDecisions(
        [
          { id: "a", text: TURN },
          { id: "a", text: COUNT },
        ],
        ["a", "a"],
      ),
    ).toMatchObject({
      status: "disabled",
      reason: "duplicate_block_id",
    });
  });

  it("does not mutate inputs", () => {
    const blocks = [
      { id: "a", text: TURN },
      { id: "b", text: COUNT },
    ] as const;

    const before = JSON.stringify(blocks);
    prepareCrossBlockCourseDecisions(blocks, ["a", "b"]);
    expect(JSON.stringify(blocks)).toBe(before);
  });
});
