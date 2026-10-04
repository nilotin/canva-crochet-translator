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

    const source = "a X b";
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
