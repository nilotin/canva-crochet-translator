/**
 * Combined-carrier integrity (Stage 1, Task 6): frame placeholders and
 * immutable placeholders in ONE carrier, checked in one pass against the
 * carrier's textual placeholder order, then restored layer by layer: frames
 * first, then the unchanged `restoreImmutablePattern`.
 */
import { describe, expect, it } from "vitest";
import {
  placeholderIntegrityErrors,
  protectImmutablePattern,
  reservedPlaceholdersIn,
  restoreImmutablePattern,
} from "../../notation/immutable.js";
import { parseFrames } from "../../parser/frame_parser.js";
import { renderUnits } from "../../renderer/frame_renderer.js";
import {
  FrameProtectionError,
  carrierPlaceholderErrors,
  protectFrames,
  restoreFrames,
  substituteFramesAfterIntegrity,
} from "../frame_protection.js";

/** Frame protection first, then immutable protection with disjoint ids. */
const combined = (source: string) => {
  const parse = parseFrames(source);
  const frames = protectFrames(parse, renderUnits(parse, "en"), 0);
  const immutable = protectImmutablePattern(frames.text, frames.tokens.length);
  return { frames, immutable, carrier: immutable.text };
};

// The immutable content comes BEFORE the frame, so the carrier interleaves
// the two id ranges: immutable ids 1.. appear before frame id 0.
const INTERLEAVED = "20x, 6v\n6x örüyoruz.";

describe("carrier placeholder order", () => {
  const { frames, immutable, carrier } = combined(INTERLEAVED);
  const framePlaceholders = frames.tokens.map(({ placeholder }) => placeholder);
  const immutablePlaceholders = immutable.tokens.map(({ placeholder }) => placeholder);

  it("really interleaves the two layers", () => {
    expect(framePlaceholders).toEqual(["__XQAAAAQX__"]);
    expect(immutablePlaceholders[0]).toBe("__XQAAABQX__");
    expect(reservedPlaceholdersIn(carrier)).toEqual([...immutablePlaceholders, ...framePlaceholders]);
  });

  it("per-layer (numeric) expected order falsely reports REORDERED", () => {
    expect(
      placeholderIntegrityErrors(carrier, [...framePlaceholders, ...immutablePlaceholders]).map(
        ({ code }) => code,
      ),
    ).toEqual(["REORDERED_PROTECTED_NOTATION"]);
  });

  it("the carrier's textual order reports nothing", () => {
    expect(carrierPlaceholderErrors(carrier, carrier)).toEqual([]);
  });
});

describe("existing restoreFrames stays strict", () => {
  it("still rejects a combined carrier: the immutable placeholders are UNEXPECTED", () => {
    const { frames, immutable, carrier } = combined(INTERLEAVED);
    const restored = restoreFrames(carrier, frames);
    expect(restored.valid).toBe(false);
    expect(restored.text).toBe(carrier);
    expect(restored.pieces).toEqual([]);
    expect(restored.errors).toEqual(
      immutable.tokens.map(({ placeholder }) => ({
        code: "UNEXPECTED_PROTECTED_NOTATION",
        message: `Unexpected protected immutable token ${placeholder} was returned.`,
      })),
    );
  });

  it("and the immutable restore alone still rejects the frame placeholder", () => {
    const { immutable, carrier } = combined(INTERLEAVED);
    expect(restoreImmutablePattern(carrier, immutable, "en").errors.map(({ code }) => code)).toEqual([
      "UNEXPECTED_PROTECTED_NOTATION",
    ]);
  });
});

describe("combined flow: integrity, frames, then unchanged immutable restore", () => {
  const { frames, immutable, carrier } = combined(INTERLEAVED);

  it("substitutes frame placeholders only and keeps immutable placeholders untouched", () => {
    const step = substituteFramesAfterIntegrity(carrier, frames, carrier);
    expect(step.valid).toBe(true);
    expect(step.errors).toEqual([]);
    expect(reservedPlaceholdersIn(step.text)).toEqual(immutable.tokens.map(({ placeholder }) => placeholder));
    expect(step.text).toBe(carrier.replace(frames.tokens[0]!.placeholder, "work 6sc"));
  });

  it("then restores with the unchanged restoreImmutablePattern", () => {
    const step = substituteFramesAfterIntegrity(carrier, frames, carrier);
    const final = restoreImmutablePattern(step.text, immutable, "en");
    expect(final).toEqual({ text: "20sc, 6inc\nwork 6sc.", valid: true, errors: [] });
    expect(reservedPlaceholdersIn(final.text)).toEqual([]);
  });

  it("keeps provider text around the placeholders exactly", () => {
    const [p1, p2, p3, p4, p5] = immutable.tokens.map(({ placeholder }) => placeholder);
    const output = `${p1}${p2}${p3} ${p4}${p5} — then:\n${frames.tokens[0]!.placeholder}!`;
    const step = substituteFramesAfterIntegrity(output, frames, carrier);
    expect(step.text).toBe(`${p1}${p2}${p3} ${p4}${p5} — then:\nwork 6sc!`);
  });
});

describe("combined flow: known piece-offset limitation (follow-up debt)", () => {
  it("pieces locate frames in the intermediate text, and immutable restoration can shift them", () => {
    const { frames, immutable, carrier } = combined(INTERLEAVED);
    const step = substituteFramesAfterIntegrity(carrier, frames, carrier);
    const [piece] = step.pieces;
    // Correct for the intermediate (post-frame, pre-immutable) text ...
    expect(step.text.slice(piece!.targetStart, piece!.targetEnd)).toBe("work 6sc");
    // ... but NOT final output offsets: the immutable placeholders before the
    // frame restore to shorter text. Remapping is intentionally not done yet.
    const final = restoreImmutablePattern(step.text, immutable, "en").text;
    expect(final.slice(piece!.targetStart, piece!.targetEnd)).not.toBe("work 6sc");
    expect(final).toContain("work 6sc");
  });
});

describe("combined flow: cross-layer corruption", () => {
  const { frames, immutable, carrier } = combined(INTERLEAVED);
  const frame = frames.tokens[0]!.placeholder;
  const [imm1, imm2] = immutable.tokens.map(({ placeholder }) => placeholder) as [string, string];
  const swap = (text: string, left: string, right: string) =>
    text.replace(left, "\u0000").replace(right, left).replace("\u0000", right);

  it.each([
    ["missing frame placeholder", carrier.replace(frame, ""), ["MISSING_PROTECTED_NOTATION"]],
    ["missing immutable placeholder", carrier.replace(imm1, ""), ["MISSING_PROTECTED_NOTATION"]],
    ["duplicate frame placeholder", `${carrier} ${frame}`, ["DUPLICATE_PROTECTED_NOTATION"]],
    ["duplicate immutable placeholder", `${carrier} ${imm2}`, ["DUPLICATE_PROTECTED_NOTATION"]],
    ["foreign reserved placeholder", `${carrier} __XQZZZZQX__`, ["UNEXPECTED_PROTECTED_NOTATION"]],
    [
      "mutated frame placeholder",
      carrier.replace(frame, "__XQAAaaQX__"),
      ["MISSING_PROTECTED_NOTATION", "MUTATED_PROTECTED_NOTATION"],
    ],
    ["frame and immutable placeholders swapped", swap(carrier, frame, imm1), ["REORDERED_PROTECTED_NOTATION"]],
  ])("%s: invalid with existing diagnostics, nothing substituted", (_label, output, codes) => {
    const step = substituteFramesAfterIntegrity(output, frames, carrier);
    expect(step.valid).toBe(false);
    expect(step.errors.map(({ code }) => code)).toEqual(codes);
    expect(step.errors).toEqual(carrierPlaceholderErrors(output, carrier));
    expect(step.text).toBe(output);
    expect(step.pieces).toEqual([]);
  });

  it("the intact carrier passes", () => {
    expect(substituteFramesAfterIntegrity(carrier, frames, carrier).valid).toBe(true);
  });
});

describe("combined flow: contract", () => {
  it("throws when the carrier was not built from these frames", () => {
    const { frames, carrier } = combined(INTERLEAVED);
    const frame = frames.tokens[0]!.placeholder;
    expect(() => substituteFramesAfterIntegrity(carrier, frames, carrier.replace(frame, ""))).toThrow(
      FrameProtectionError,
    );
    expect(() => substituteFramesAfterIntegrity(carrier, frames, `${carrier}${frame}`)).toThrow(
      FrameProtectionError,
    );
  });

  it("with no frame tokens it only checks integrity and changes nothing", () => {
    const source = "20x, 6v = 26x ile örüyoruz.";
    const { frames, immutable, carrier } = combined(source);
    expect(frames.tokens).toEqual([]);
    expect(substituteFramesAfterIntegrity(carrier, frames, carrier)).toEqual({
      text: carrier,
      valid: true,
      errors: [],
      pieces: [],
    });
    expect(restoreImmutablePattern(carrier, immutable, "en").valid).toBe(true);
  });

  it("is deterministic", () => {
    const { frames, carrier } = combined(INTERLEAVED);
    expect(substituteFramesAfterIntegrity(carrier, frames, carrier)).toEqual(
      substituteFramesAfterIntegrity(carrier, frames, carrier),
    );
  });
});
