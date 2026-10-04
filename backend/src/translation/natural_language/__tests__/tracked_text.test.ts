import { describe, expect, it } from "vitest";
import { TrackedText } from "../tracked_text.js";

const ranges = (tracked: TrackedText) =>
  tracked.spans().map(({ start, end, text }) => [start, end, text]);

describe("TrackedText records deterministic ranges when they are written (Task 23B)", () => {
  it("records the range of the rendering itself, never an earlier identical text", () => {
    for (const [source, word] of [
      ["Work 2x. çalış 3x", "Work"],
      ["In FLO, sonra içinde BLO", "In"],
      ["ch 1, zincir 2", "ch"],
    ] as const) {
      const tracked = TrackedText.of(source, true);
      const result = tracked.replace(/çalış|içinde|zincir/u, () => tracked.mark(word));
      const second = result.text.lastIndexOf(word);
      expect(result.text.indexOf(word)).toBeLessThan(second);
      expect(ranges(result)).toEqual([[second, second + word.length, word]]);
    }
  });

  it("records every one of several identical renderings, in order", () => {
    const tracked = TrackedText.of("a X b X c X", true);
    const result = tracked.replace(/X/gu, () => tracked.mark("Work"));
    expect(result.text).toBe("a Work b Work c Work");
    expect(ranges(result)).toEqual([
      [2, 6, "Work"],
      [9, 13, "Work"],
      [16, 20, "Work"],
    ]);
  });

  it("records only the marked part of a replacement", () => {
    const tracked = TrackedText.of("42x - 5 zincir", true);
    const result = tracked.replace(/(\d+)x - (\d+) zincir/u, (_match, stitches: string, chains: string) =>
      `${stitches}x, ${tracked.mark(`ch ${chains}`)}`,
    );
    expect(result.text).toBe("42x, ch 5");
    expect(ranges(result)).toEqual([[5, 9, "ch 5"]]);
  });

  it("moves recorded ranges through later edits before them, and ignores edits after them", () => {
    const tracked = TrackedText.of("a X b", true);
    const result = tracked
      .replace(/X/u, () => tracked.mark("Work"))
      .replace(/^a/u, "longer start")
      .replace(/b$/u, "end")
      .replace(/^/u, ">> ");
    expect(result.text).toBe(">> longer start Work end");
    expect(ranges(result)).toEqual([[16, 20, "Work"]]);
  });

  it("fails closed when a later edit touches a recorded range", () => {
    const tracked = TrackedText.of("a X b", true);
    const marked = tracked.replace(/X/u, () => tracked.mark("Work"));
    expect(marked.replace(/ork/u, "alk").spans()).toEqual([]);
    expect(marked.replace(/a Wo/u, "A").spans()).toEqual([]);
    expect(marked.replace(/(?<=Wo)/u, "-").spans()).toEqual([]);
    // The text is still exactly what String.prototype.replace produces.
    expect(marked.replace(/ork/u, "alk").text).toBe("a Walk b");
  });

  it("fails closed on unbalanced marks inside one replacement", () => {
    const tracked = TrackedText.of("a X b", true);
    const open = tracked.mark("Work").slice(0, -1);
    expect(tracked.replace(/X/u, () => open).spans()).toEqual([]);
  });

  it("does not record when asked not to, or when the text already holds a mark code point", () => {
    const off = TrackedText.of("a X b", false);
    const offResult = off.replace(/X/u, () => off.mark("Work"));
    expect(offResult.text).toBe("a Work b");
    expect(offResult.spans()).toEqual([]);

    const source = "a \uE000X\uE001 b";
    const guarded = TrackedText.of(source, true);
    const guardedResult = guarded.replace(/X/u, () => guarded.mark("Work"));
    expect(guardedResult.text).toBe(source.replace("X", "Work"));
    expect(guardedResult.spans()).toEqual([]);
  });

  it.each([
    [/(\d+)\s*x/gu, "$1sc"],
    [/(\d+)\s*x/gu, "[$&]"],
    [/(\d+)\s*x/gu, "$$1"],
    [/(\d+)\s*x/gu, "$10"],
    [/(\d+)\s*x/gu, "$0$2"],
    [/(?<count>\d+)\s*x/gu, "$<count>sc"],
    [/(\d+)\s*x/gu, "$<count>"],
    [/(a)?(\d+)x/gu, "<$1|$2>"],
    [/x/u, "$`|$'"],
  ] as const)("expands %s with %j exactly like String.prototype.replace", (pattern, replacement) => {
    const source = "1x, 22 x ve 3x";
    expect(TrackedText.of(source, true).replace(pattern, replacement).text).toBe(
      source.replace(pattern, replacement),
    );
  });
});

const sourceRanges = (tracked: TrackedText) =>
  tracked.sourceDataSpans().map(({ start, end, text }) => [start, end, text]);

describe("TrackedText records source-data ranges as a second, independent kind (Task 23K-1)", () => {
  it("records source data alone without creating a deterministic range", () => {
    const tracked = TrackedText.of("ip (Alize 3x) ile", true);
    const result = tracked.replace(/ip \((.+?)\) ile/u, (_match, brand: string) =>
      `yarn (${tracked.markSourceData(brand)})`,
    );
    expect(result.text).toBe("yarn (Alize 3x)");
    expect(sourceRanges(result)).toEqual([[6, 14, "Alize 3x"]]);
    expect(result.spans()).toEqual([]);
  });

  it("records source data nested inside a deterministic rendering, each in its own kind", () => {
    const tracked = TrackedText.of("> X <", true);
    const result = tracked.replace(/X/u, () =>
      tracked.mark(`Start with red yarn (${tracked.markSourceData("Alize 3x")})`),
    );
    expect(result.text).toBe("> Start with red yarn (Alize 3x) <");
    expect(ranges(result)).toEqual([[2, 32, "Start with red yarn (Alize 3x)"]]);
    expect(sourceRanges(result)).toEqual([[23, 31, "Alize 3x"]]);
  });

  it("records adjacent source-data marks as separate ranges", () => {
    const tracked = TrackedText.of("X", true);
    const result = tracked.replace(/X/u, () => `${tracked.markSourceData("3x")}${tracked.markSourceData("1v")}`);
    expect(sourceRanges(result)).toEqual([
      [0, 2, "3x"],
      [2, 4, "1v"],
    ]);
  });

  it("shifts source data through later edits before it and ignores edits after it", () => {
    const tracked = TrackedText.of("a X b", true);
    const result = tracked
      .replace(/X/u, () => tracked.markSourceData("Alize 3x"))
      .replace(/^a/u, "longer start")
      .replace(/b$/u, "end")
      .replace(/^/u, ">> ");
    expect(result.text).toBe(">> longer start Alize 3x end");
    expect(sourceRanges(result)).toEqual([[16, 24, "Alize 3x"]]);
  });

  it("breaks only the kind a later edit touches", () => {
    const tracked = TrackedText.of("D S", true);
    const marked = tracked
      .replace(/D/u, () => tracked.mark("Work"))
      .replace(/S/u, () => tracked.markSourceData("Alize 3x"));
    expect(ranges(marked)).toEqual([[0, 4, "Work"]]);
    expect(sourceRanges(marked)).toEqual([[5, 13, "Alize 3x"]]);

    const sourceTouched = marked.replace(/3x/u, "3sc");
    expect(sourceTouched.text).toBe("Work Alize 3sc");
    expect(sourceRanges(sourceTouched)).toEqual([]);
    expect(ranges(sourceTouched)).toEqual([[0, 4, "Work"]]);

    const deterministicTouched = marked.replace(/ork/u, "alk");
    expect(ranges(deterministicTouched)).toEqual([]);
    expect(sourceRanges(deterministicTouched)).toEqual([[5, 13, "Alize 3x"]]);

    // An insertion strictly inside a source range breaks it; one at its edge does not.
    expect(sourceRanges(marked.replace(/(?<=Alize)/u, "-"))).toEqual([]);
    expect(sourceRanges(marked.replace(/(?<=Alize 3x)/u, "!"))).toEqual([[5, 13, "Alize 3x"]]);
  });

  it("breaks only the kind whose marks are unbalanced", () => {
    const tracked = TrackedText.of("X Y", true);
    const brokenSource = tracked.replace(/X/u, () => tracked.mark("Work")).replace(/Y/u, () =>
      tracked.markSourceData("Alize").slice(0, -1),
    );
    expect(brokenSource.text).toBe("Work Alize");
    expect(sourceRanges(brokenSource)).toEqual([]);
    expect(ranges(brokenSource)).toEqual([[0, 4, "Work"]]);

    const brokenDeterministic = tracked
      .replace(/X/u, () => tracked.mark("Work").slice(1))
      .replace(/Y/u, () => tracked.markSourceData("Alize"));
    expect(brokenDeterministic.text).toBe("Work Alize");
    expect(ranges(brokenDeterministic)).toEqual([]);
    expect(sourceRanges(brokenDeterministic)).toEqual([[5, 10, "Alize"]]);

    const nestedSameKind = tracked.replace(/X/u, () =>
      tracked.markSourceData(`a ${tracked.markSourceData("b")}`),
    );
    expect(sourceRanges(nestedSameKind)).toEqual([]);
  });

  it("does not mark source data when not recording", () => {
    const off = TrackedText.of("a X b", false);
    expect(off.markSourceData("Alize 3x")).toBe("Alize 3x");
    const result = off.replace(/X/u, () => off.markSourceData("Alize 3x"));
    expect(result.text).toBe("a Alize 3x b");
    expect(result.sourceDataSpans()).toEqual([]);
  });

  it.each(["\uE000", "\uE001", "\uE002", "\uE003"])(
    "never reads a %j already in the text as a mark, and keeps it byte-exact",
    (sentinel) => {
      const source = `a ${sentinel}Alize 3x${sentinel} b`;
      for (const record of [true, false]) {
        const tracked = TrackedText.of(source, record);
        // The match copies the sentinels into the replacement (via a callback and `$1`).
        const viaCallback = tracked.replace(/a (.*) b/u, (_match, inner: string) =>
          tracked.markSourceData(`[${inner}]`),
        );
        const viaPattern = tracked.replace(/a (.*) b/u, "<$1>");
        expect(viaCallback.text).toBe(`[${sentinel}Alize 3x${sentinel}]`);
        expect(viaPattern.text).toBe(source.replace(/a (.*) b/u, "<$1>"));
        for (const result of [viaCallback, viaPattern]) {
          expect(result.spans()).toEqual([]);
          expect(result.sourceDataSpans()).toEqual([]);
        }
      }
    },
  );

  it("keeps the deterministic ranges of Task 23B unchanged when source data is also recorded", () => {
    const plain = TrackedText.of("a X b X", true);
    const withSource = TrackedText.of("a X b X", true);
    const deterministicOnly = plain.replace(/X/gu, () => plain.mark("Work"));
    const both = withSource
      .replace(/X/gu, () => withSource.mark("Work"))
      .replace(/b/u, () => withSource.markSourceData("b"));
    expect(both.text).toBe(deterministicOnly.text);
    expect(both.spans()).toEqual(deterministicOnly.spans());
  });
});

const positionedRanges = (tracked: TrackedText) =>
  tracked.positionedSourceDataSpans().map(({ start, end, text }) => [start, end, text]);

describe("compose places source data without marks when the text holds a mark code point (Task 23K-4)", () => {
  const brandRule = (tracked: TrackedText) =>
    tracked.replace(/\((.+?)\)/gu, (_match, brand: string) => tracked.compose`(${tracked.sourceData(brand)})`);

  it("with recording on, composes exactly the marked rendering of markSourceData", () => {
    const viaCompose = brandRule(TrackedText.of("a (Alize 3x) b", true));
    expect(viaCompose.text).toBe("a (Alize 3x) b");
    expect(sourceRanges(viaCompose)).toEqual([[3, 11, "Alize 3x"]]);
    expect(positionedRanges(viaCompose)).toEqual([]);
  });

  it.each(["\uE000", "\uE001", "\uE002", "\uE003"])(
    "with %j in the text, keeps marks off and positions every piece by construction",
    (sentinel) => {
      const source = `${sentinel} (Alize ${sentinel}3x) ve (Alize ${sentinel}3x)`;
      const result = brandRule(TrackedText.of(source, true));
      expect(result.text).toBe(source);
      expect(result.spans()).toEqual([]);
      expect(result.sourceDataSpans()).toEqual([]);
      expect(positionedRanges(result)).toEqual([
        [3, 12, `Alize ${sentinel}3x`],
        [18, 27, `Alize ${sentinel}3x`],
      ]);
    },
  );

  it("never positions when recording was not requested", () => {
    const result = brandRule(TrackedText.of("\uE000 (Alize 3x)", false));
    expect(result.text).toBe("\uE000 (Alize 3x)");
    expect(result.positionedSourceDataSpans()).toEqual([]);
  });

  it("shifts nested compositions and moves through later edits", () => {
    const tracked = TrackedText.of("\uE000 X", true);
    const result = tracked
      .replace(/X/u, () => tracked.compose`>> ${tracked.mark(tracked.compose`yarn (${tracked.sourceData("Alize 3x")})`)} <<`)
      .replace(/^/u, "start ");
    expect(result.text).toBe("start \uE000 >> yarn (Alize 3x) <<");
    expect(result.spans()).toEqual([]);
    expect(positionedRanges(result)).toEqual([[17, 25, "Alize 3x"]]);
  });

  it("fails closed when a later edit touches a positioned range", () => {
    const result = brandRule(TrackedText.of("\uE000 (Alize 3x)", true));
    expect(positionedRanges(result.replace(/3x/u, "3sc"))).toEqual([]);
    expect(result.replace(/3x/u, "3sc").text).toBe("\uE000 (Alize 3sc)");
  });

  it("keeps marks and pieces apart: a positioned rendering under recording breaks only that channel", () => {
    const tracked = TrackedText.of("X Y", true);
    const result = tracked
      .replace(/X/u, () => tracked.mark("Work"))
      .replace(/Y/u, () => ({ text: "Alize", sourceData: [{ start: 0, end: 5 }] }));
    expect(result.text).toBe("Work Alize");
    expect(ranges(result)).toEqual([[0, 4, "Work"]]);
    expect(result.positionedSourceDataSpans()).toEqual([]);
  });
});
