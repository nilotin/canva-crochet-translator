import { computeReadingOrder, type ReadingOrderBox } from "../reading_order";

const box = (
  originalIndex: number,
  top: number,
  height = 40,
  left = 20,
  width = 500,
  rotation?: number,
): ReadingOrderBox => ({
  originalIndex,
  top,
  left,
  width,
  height,
  ...(rotation === undefined ? {} : { rotation }),
});

describe("computeReadingOrder: single vertical stack", () => {
  it("ranks a single column top to bottom", () => {
    expect(
      computeReadingOrder([box(0, 10), box(1, 100), box(2, 200)]),
    ).toEqual({ trusted: true, readingOrder: [0, 1, 2] });
  });

  it("ranks by position, not by SDK order, when the raw order is reversed", () => {
    expect(
      computeReadingOrder([box(0, 200), box(1, 100), box(2, 10)]),
    ).toEqual({ trusted: true, readingOrder: [2, 1, 0] });
  });

  it("ignores horizontal position inside one column", () => {
    expect(
      computeReadingOrder([box(0, 100, 40, 300, 100), box(1, 10, 40, 0, 50)]),
    ).toEqual({ trusted: true, readingOrder: [1, 0] });
  });

  it("tolerates a small vertical overlap between stacked boxes", () => {
    // 10..50 and 45..85: each centre lies outside the other box.
    expect(computeReadingOrder([box(0, 45), box(1, 10)])).toEqual({
      trusted: true,
      readingOrder: [1, 0],
    });
  });

  it("accepts a single block and an empty page", () => {
    expect(computeReadingOrder([box(7, 10)])).toEqual({
      trusted: true,
      readingOrder: [0],
    });
    expect(computeReadingOrder([])).toEqual({ trusted: true, readingOrder: [] });
  });

  it("accepts a whole-turn rotation as unrotated", () => {
    expect(
      computeReadingOrder([box(0, 10, 40, 20, 500, 0), box(1, 100, 40, 20, 500, 360)]),
    ).toEqual({ trusted: true, readingOrder: [0, 1] });
  });

  it("is deterministic across repeated calls", () => {
    const boxes = [box(0, 300), box(1, 10), box(2, 150)];
    expect(computeReadingOrder(boxes)).toEqual(computeReadingOrder(boxes));
    expect(computeReadingOrder(boxes)).toEqual({
      trusted: true,
      readingOrder: [2, 0, 1],
    });
  });
});

describe("computeReadingOrder: ambiguous layouts fail closed", () => {
  it.each([
    [
      "two columns",
      [box(0, 10, 300, 0, 200), box(1, 10, 300, 300, 200)],
    ],
    [
      "same-row side-by-side blocks",
      [box(0, 10, 40, 0, 200), box(1, 10, 40, 300, 200)],
    ],
    [
      "slightly misaligned row blocks",
      [box(0, 10, 40, 0, 200), box(1, 14, 40, 300, 200)],
    ],
    [
      "a tall column next to a short block",
      [box(0, 0, 400, 0, 200), box(1, 250, 50, 300, 200)],
    ],
    [
      "an overlapping decorative text box",
      [box(0, 10, 100), box(1, 40, 20, 100, 50)],
    ],
    ["equal coordinates", [box(0, 10), box(1, 10)]],
  ])("%s: no reading order", (_label, boxes) => {
    expect(computeReadingOrder(boxes)).toEqual({
      trusted: false,
      reason: "ambiguous_layout",
    });
  });

  it("fails the whole page when one box among a stack is side by side with another", () => {
    expect(
      computeReadingOrder([
        box(0, 10),
        box(1, 100, 40, 0, 200),
        box(2, 100, 40, 300, 200),
        box(3, 200),
      ]),
    ).toEqual({ trusted: false, reason: "ambiguous_layout" });
  });
});

describe("computeReadingOrder: unusable geometry fails closed", () => {
  it.each([
    ["missing top", { originalIndex: 1, left: 0, width: 10, height: 10 }],
    ["missing height", { originalIndex: 1, top: 100, left: 0, width: 10 }],
    ["non-finite top", { ...box(1, 100), top: Number.NaN }],
    ["zero width", { ...box(1, 100), width: 0 }],
    ["negative height", { ...box(1, 100), height: -5 }],
  ])("%s", (_label, broken) => {
    expect(computeReadingOrder([box(0, 10), broken])).toEqual({
      trusted: false,
      reason: "missing_geometry",
    });
  });

  it.each([15, -90, Number.NaN])("rotation %s", (rotation) => {
    expect(
      computeReadingOrder([box(0, 10), box(1, 100, 40, 20, 500, rotation)]),
    ).toEqual({ trusted: false, reason: "rotated" });
  });

  it("duplicate or non-integer original indices", () => {
    expect(computeReadingOrder([box(0, 10), box(0, 100)])).toEqual({
      trusted: false,
      reason: "duplicate_index",
    });
    expect(computeReadingOrder([box(0.5, 10)])).toEqual({
      trusted: false,
      reason: "duplicate_index",
    });
  });
});
