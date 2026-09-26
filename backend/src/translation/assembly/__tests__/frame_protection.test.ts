import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { projectFormattingRegionsFromPieces } from "../../formatting_projection.js";
import {
  placeholderIntegrityErrors,
  protectImmutablePattern,
  reservedPlaceholder,
} from "../../notation/immutable.js";
import { parseFrames } from "../../parser/frame_parser.js";
import { renderUnits, type RenderUnit } from "../../renderer/frame_renderer.js";
import {
  FrameProtectionError,
  protectFrames,
  restoreFrames,
  type FramePiece,
} from "../frame_protection.js";

const protect = (source: string, startIndex = 0) => {
  const parse = parseFrames(source);
  return protectFrames(parse, renderUnits(parse, "en"), startIndex);
};

const TWO_UNITS = "6x örüyoruz. 1 zincir çekip dönüyoruz.";

describe("protectFrames", () => {
  it("replaces each unit span with one canonical placeholder and keeps everything else", () => {
    const frames = protect(TWO_UNITS);
    expect(frames.source).toBe(TWO_UNITS);
    expect(frames.text).toBe("__XQAAAAQX__. __XQAAABQX__.");
    expect(
      frames.tokens.map(({ placeholder, meaning, unit }) => [placeholder, meaning, unit.sourceSpan.raw]),
    ).toEqual([
      ["__XQAAAAQX__", "work 6sc", "6x örüyoruz"],
      ["__XQAAABQX__", "ch 1 and turn", "1 zincir çekip dönüyoruz"],
    ]);
  });

  it("keeps the chain+turn pair as ONE placeholder", () => {
    const frames = protect("1 zincir çekip dönüyoruz");
    expect(frames.text).toBe(reservedPlaceholder(0));
    expect(frames.tokens).toHaveLength(1);
  });

  it("numbers placeholders from startIndex, in source order", () => {
    const frames = protect(TWO_UNITS, 30);
    expect(frames.tokens.map(({ placeholder }) => placeholder)).toEqual([
      reservedPlaceholder(30),
      reservedPlaceholder(31),
    ]);
  });

  it("returns the source unchanged when there are no units", () => {
    const source = "Sihirli halka içine 6x";
    expect(protect(source)).toEqual({ source, text: source, tokens: [] });
    expect(protect("")).toEqual({ source: "", text: "", tokens: [] });
  });

  it("keeps text around the spans code unit for code unit, Unicode included", () => {
    const source = "🧶 ✦\u00a0\n6x örüyoruz.\n🪡";
    const frames = protect(source);
    expect(frames.text).toBe("🧶 ✦\u00a0\n__XQAAAAQX__.\n🪡");
  });

  it("is deterministic", () => {
    expect(protect(TWO_UNITS, 5)).toEqual(protect(TWO_UNITS, 5));
  });
});

describe("protectFrames: malformed input fails explicitly", () => {
  const parse = parseFrames(TWO_UNITS);
  const [stitch, pair] = renderUnits(parse, "en") as [RenderUnit, RenderUnit];

  it.each([
    ["units out of order", () => protectFrames(parse, [pair, stitch])],
    ["overlapping units", () => protectFrames(parse, [stitch, stitch])],
    [
      "a span outside the source",
      () => protectFrames(parse, [{ ...stitch, sourceSpan: { start: 0, end: 999, raw: TWO_UNITS } }]),
    ],
    [
      "raw text that is not the source slice",
      () => protectFrames(parse, [{ ...stitch, sourceSpan: { ...stitch.sourceSpan, raw: "7x örüyoruz" } }]),
    ],
    [
      "a unit covering only part of a frame",
      () => protectFrames(parse, [{ ...stitch, sourceSpan: { start: 0, end: 2, raw: "6x" } }]),
    ],
    [
      "a unit covering Opaque text",
      () =>
        protectFrames(parse, [
          { ...stitch, sourceSpan: { start: 0, end: 37, raw: TWO_UNITS.slice(0, 37) } },
        ]),
    ],
    ["a negative startIndex", () => protectFrames(parse, [stitch], -1)],
    ["a fractional startIndex", () => protectFrames(parse, [stitch], 1.5)],
  ])("throws for %s", (_label, run) => {
    expect(run).toThrow(FrameProtectionError);
  });

  it("throws when the source already contains reserved placeholder syntax", () => {
    const withPlaceholder = parseFrames("__XQAAAAQX__.\n6x örüyoruz.");
    expect(renderUnits(withPlaceholder, "en")).toHaveLength(1);
    expect(() => protectFrames(withPlaceholder, renderUnits(withPlaceholder, "en"))).toThrow(
      FrameProtectionError,
    );
  });
});

describe("restoreFrames", () => {
  it("restores canonical meanings and emits exact provenance pieces", () => {
    const frames = protect(TWO_UNITS);
    const restored = restoreFrames(frames.text, frames);
    expect(restored).toEqual({
      text: "work 6sc. ch 1 and turn.",
      valid: true,
      errors: [],
      pieces: [
        { sourceStart: 0, sourceEnd: 11, targetStart: 0, targetEnd: 8 },
        { sourceStart: 13, sourceEnd: 37, targetStart: 10, targetEnd: 23 },
      ],
    });
    for (const piece of restored.pieces) {
      const token = frames.tokens.find(({ unit }) => unit.sourceSpan.start === piece.sourceStart);
      expect(restored.text.slice(piece.targetStart, piece.targetEnd)).toBe(token?.meaning);
    }
  });

  it("follows the provider's surrounding text, whatever its length", () => {
    const frames = protect(TWO_UNITS);
    const translated = `Önce ${frames.tokens[0]!.placeholder} ve sonra ${frames.tokens[1]!.placeholder}!`;
    const restored = restoreFrames(translated, frames);
    expect(restored.text).toBe("Önce work 6sc ve sonra ch 1 and turn!");
    expect(restored.pieces.map(({ targetStart, targetEnd }) => restored.text.slice(targetStart, targetEnd))).toEqual([
      "work 6sc",
      "ch 1 and turn",
    ]);
  });

  it("uses UTF-16 target offsets", () => {
    const frames = protect("🧶\n6x örüyoruz.\n🪡");
    const restored = restoreFrames(frames.text, frames);
    expect(restored.text).toBe("🧶\nwork 6sc.\n🪡");
    expect(restored.pieces).toEqual([{ sourceStart: 3, sourceEnd: 14, targetStart: 3, targetEnd: 11 }]);
  });

  it("is the identity with no tokens", () => {
    const frames = protect("Normal Türkçe metin.");
    expect(restoreFrames("Normal Turkish text.", frames)).toEqual({
      text: "Normal Turkish text.",
      valid: true,
      errors: [],
      pieces: [],
    });
  });

  it("works with a non-zero startIndex", () => {
    const frames = protect(TWO_UNITS, 7);
    expect(restoreFrames(frames.text, frames).text).toBe("work 6sc. ch 1 and turn.");
  });
});

describe("restoreFrames: integrity failures use the canonical diagnostics", () => {
  const frames = protect(TWO_UNITS);
  const [a, b] = frames.tokens.map(({ placeholder }) => placeholder) as [string, string];

  it.each([
    ["missing", `${a}.`, "MISSING_PROTECTED_NOTATION"],
    ["duplicate", `${a}. ${b}. ${b}`, "DUPLICATE_PROTECTED_NOTATION"],
    ["unexpected", `${a}. ${b}. __XQZZZZQX__`, "UNEXPECTED_PROTECTED_NOTATION"],
    ["mutated", `__XQAAaaQX__. ${b}.`, "MUTATED_PROTECTED_NOTATION"],
    ["reordered", `${b}. ${a}.`, "REORDERED_PROTECTED_NOTATION"],
  ])("%s placeholder: invalid, no pieces, text unchanged", (_label, translated, code) => {
    const restored = restoreFrames(translated, frames);
    expect(restored.valid).toBe(false);
    expect(restored.text).toBe(translated);
    expect(restored.pieces).toEqual([]);
    expect(restored.errors.map((error) => error.code)).toContain(code);
    expect(restored.errors).toEqual(placeholderIntegrityErrors(translated, [a, b]));
  });
});

describe("composition with protectImmutablePattern", () => {
  const source = "6x örüyoruz. 1 zincir çekip dönüyoruz, 20x, 6v = 26x";
  const frames = protect(source, 0);
  const immutable = protectImmutablePattern(frames.text, frames.tokens.length);
  const framePlaceholders = frames.tokens.map(({ placeholder }) => placeholder);
  const immutablePlaceholders = immutable.tokens.map(({ placeholder }) => placeholder);

  it("gives the immutable layer a disjoint id range after the frame ids", () => {
    expect(framePlaceholders).toEqual([reservedPlaceholder(0), reservedPlaceholder(1)]);
    expect(immutablePlaceholders[0]).toBe(reservedPlaceholder(2));
    expect(new Set([...framePlaceholders, ...immutablePlaceholders]).size).toBe(
      framePlaceholders.length + immutablePlaceholders.length,
    );
  });

  it("never consumes or mutates a frame placeholder", () => {
    for (const token of immutable.tokens) {
      expect(token.source).not.toMatch(/__XQ/);
    }
    for (const placeholder of framePlaceholders) {
      expect(immutable.text.split(placeholder)).toHaveLength(2);
    }
  });

  it("keeps the frame placeholders in source order", () => {
    const positions = framePlaceholders.map((placeholder) => immutable.text.indexOf(placeholder));
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });
});

describe("frame_protection: module contract", () => {
  it("emits pieces the existing projection function accepts (type-level only, never called)", () => {
    const pieces: FramePiece[] = restoreFrames(protect(TWO_UNITS).text, protect(TWO_UNITS)).pieces.slice();
    const accepted: Parameters<typeof projectFormattingRegionsFromPieces>[1] = pieces;
    expect(accepted).toHaveLength(2);
  });

  const code = readFileSync(fileURLToPath(new URL("../frame_protection.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("imports only the immutable placeholder helpers at runtime", () => {
    const runtime = [...code.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)].map(
      (match) => match[1],
    );
    expect(runtime).toEqual(["../notation/immutable.js"]);
    expect(code).not.toMatch(/translator|prompt|provider|formatting_projection|validator|normalizer/);
  });

  it("has no own placeholder grammar", () => {
    expect(code).not.toMatch(/__XQ|QX__|fromCharCode/);
  });
});
