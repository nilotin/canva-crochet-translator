import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseFrames } from "../../parser/frame_parser.js";
import { renderUnits, type RenderUnit } from "../../renderer/frame_renderer.js";
import { segmentTranslationBlock } from "../../segmentation.js";
import { FrameOwnershipError, classifyFrameOwnership } from "../frame_ownership.js";

const classify = (block: string) => classifyFrameOwnership(block, renderUnits(parseFrames(block), "en"), "en");

const summary = (block: string) =>
  classify(block).map(({ unit, segmentIndex, ownership, reasons }) => [
    unit.sourceSpan.raw,
    segmentIndex,
    ownership,
    reasons,
  ]);

describe("classifyFrameOwnership: span mapping", () => {
  it.each([
    ["a unit at the segment start", "20x örüyoruz."],
    ["a unit after prose", "İpimizi sabitliyoruz. 20x örüyoruz."],
    ["a unit after a 1) prefix", "1) 28x örüyoruz."],
    ["a unit after a 53) prefix", "53) 12x örüyoruz."],
  ])("maps %s into the segment body", (_label, block) => {
    const [result] = classify(block);
    expect(result?.segmentIndex).toBe(0);
    expect(result?.ownership).toBe("separable");
    expect(result?.reasons).toEqual([]);
  });

  it("keeps UTF-16 offsets when astral characters precede the unit", () => {
    const [result] = classify("🧶.\n6x örüyoruz.");
    expect(result?.unit.sourceSpan).toEqual({ start: 4, end: 15, raw: "6x örüyoruz" });
    expect(result?.ownership).toBe("separable");
  });

  it("classifies several units independently, in source order", () => {
    expect(summary("6x örüyoruz.\n1 zincir çekip dönüyoruz.")).toEqual([
      ["6x örüyoruz", 0, "separable", []],
      ["1 zincir çekip dönüyoruz", 0, "separable", []],
    ]);
  });

  it("reports the containing segment of a multi-segment block", () => {
    const block = `${"a ".repeat(260)}\n6x örüyoruz.\n${"b ".repeat(10)}`;
    expect(segmentTranslationBlock(block).length).toBeGreaterThan(1);
    const [result] = classify(block);
    expect(result?.unit.sourceSpan.raw).toBe("6x örüyoruz");
    expect(result?.segmentIndex).toBe(1);
  });

  it("returns nothing when there are no units", () => {
    expect(classifyFrameOwnership("Sihirli halka içine 6x", [], "en")).toEqual([]);
  });
});

describe("classifyFrameOwnership: explicit failures", () => {
  it("throws when a unit crosses a segment boundary", () => {
    const block = `${"a ".repeat(260)}\n6x örüyoruz.\n${"b ".repeat(10)}`;
    const [unit] = renderUnits(parseFrames(block), "en") as [RenderUnit];
    const crossing: RenderUnit = {
      ...unit,
      sourceSpan: { start: 515, end: unit.sourceSpan.end, raw: block.slice(515, unit.sourceSpan.end) },
    };
    expect(() => classifyFrameOwnership(block, [crossing], "en")).toThrow(FrameOwnershipError);
  });

  it("throws when the block already contains reserved placeholder syntax", () => {
    const block = "__XQAAAAQX__.\n6x örüyoruz.";
    expect(renderUnits(parseFrames(block), "en")).toHaveLength(1);
    expect(() => classify(block)).toThrow(FrameOwnershipError);
  });

  it("throws when a unit's raw text is not its block slice", () => {
    const [unit] = renderUnits(parseFrames("6x örüyoruz."), "en") as [RenderUnit];
    const wrong: RenderUnit = { ...unit, sourceSpan: { ...unit.sourceSpan, raw: "7x örüyoruz" } };
    expect(() => classifyFrameOwnership("6x örüyoruz.", [wrong], "en")).toThrow(FrameOwnershipError);
  });

  it("throws when a unit overlaps the leading instruction marker", () => {
    const [unit] = renderUnits(parseFrames("1) 28x örüyoruz."), "en") as [RenderUnit];
    const overlapping: RenderUnit = {
      ...unit,
      sourceSpan: { start: 0, end: unit.sourceSpan.end, raw: "1) 28x örüyoruz" },
    };
    expect(() => classifyFrameOwnership("1) 28x örüyoruz.", [overlapping], "en")).toThrow(FrameOwnershipError);
  });
});

describe("classifyFrameOwnership: purity", () => {
  const block = "6x örüyoruz.\n1 zincir çekip dönüyoruz.";

  it("is deterministic", () => {
    expect(classify(block)).toEqual(classify(block));
  });

  it("does not mutate its inputs", () => {
    const units = renderUnits(parseFrames(block), "en");
    const snapshot = structuredClone(units);
    classifyFrameOwnership(block, units, "en");
    expect(units).toEqual(snapshot);
  });
});

describe("frame_ownership: module contract", () => {
  const code = readFileSync(fileURLToPath(new URL("../frame_ownership.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("reuses production helpers and never imports translator, prompt, provider, formatting or validator code", () => {
    const imports = [...code.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((match) => match[1]);
    expect(imports.sort()).toEqual([
      "../instruction_marker.js",
      "../natural_language/normalizer.js",
      "../notation/immutable.js",
      "../renderer/frame_renderer.js",
      "../segmentation.js",
      "../types.js",
    ]);
    expect(code).not.toMatch(/translator|prompt|provider|formatting_projection|validator/);
  });

  it("has no own placeholder grammar", () => {
    expect(code).not.toMatch(/__XQ|QX__|fromCharCode/);
  });
});
