import { remapFormattingRegions } from "../formatting_remap";

const template = [
  { id: "left", start: 0, end: 5 },
  { id: "middle", start: 5, end: 9 },
  { id: "right", start: 9, end: 14 },
];

it.each([
  ["LEFT blue RIGHT", 10],
  ["LEFT reddish RIGHT", 13],
  ["LEFT rd RIGHT", 8],
])("remaps a change inside one region: %s", (edited, boundary) => {
  expect(remapFormattingRegions("LEFT red RIGHT", edited, template)).toEqual([
    template[0],
    { id: "middle", start: 5, end: boundary },
    { id: "right", start: boundary, end: edited.length },
  ]);
});

it("removes a fully deleted region", () => {
  expect(
    remapFormattingRegions("AAAxyzBBB", "AAABBB", [
      { id: "a", start: 0, end: 3 },
      { id: "x", start: 3, end: 6 },
      { id: "b", start: 6, end: 9 },
    ]),
  ).toEqual([
    { id: "a", start: 0, end: 3 },
    { id: "b", start: 3, end: 6 },
  ]);
});

it("handles independent edits separated by unchanged text", () => {
  expect(
    remapFormattingRegions("LEFT red RIGHT", "LOFT red RIGXT", template),
  ).toEqual(template);
});

it("returns valid UTF-16 offsets around emoji", () => {
  expect(
    remapFormattingRegions("😀red|end", "😀reddish|end", [
      { id: "a", start: 0, end: 6 },
      { id: "b", start: 6, end: 9 },
    ]),
  ).toEqual([
    { id: "a", start: 0, end: 10 },
    { id: "b", start: 10, end: 13 },
  ]);
});

it("rejects an insertion exactly at a style boundary", () => {
  expect(() =>
    remapFormattingRegions("ab", "a!b", [
      { id: "a", start: 0, end: 1 },
      { id: "b", start: 1, end: 2 },
    ]),
  ).toThrow("AMBIGUOUS_INSERTION");
});

it("rejects repeated text whose optimal alignments disagree on style", () => {
  expect(() =>
    remapFormattingRegions("aa", "a", [
      { id: "a", start: 0, end: 1 },
      { id: "b", start: 1, end: 2 },
    ]),
  ).toThrow("AMBIGUOUS_ALIGNMENT");
});

it.each([
  [
    { id: "a", start: 0, end: 2 },
    { id: "b", start: 1, end: 3 },
  ],
  [
    { id: "a", start: 0, end: 1 },
    { id: "b", start: 2, end: 3 },
  ],
  [{ id: "a", start: 0, end: 4 }],
  [{ id: "a", start: 0.5, end: 3 }],
])("rejects an invalid template %j", (...regions) => {
  expect(() => remapFormattingRegions("abc", "abcd", regions)).toThrow(
    "INVALID_TEMPLATE",
  );
});

it("bounds diff work for large multi-style blocks", () => {
  expect(() =>
    remapFormattingRegions("a".repeat(1000), "b".repeat(1000), [
      { id: "a", start: 0, end: 1000 },
    ]),
  ).toThrow("DIFF_LIMIT_EXCEEDED");
});
