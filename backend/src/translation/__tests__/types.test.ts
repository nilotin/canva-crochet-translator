import { describe, expect, it } from "vitest";
import { translateRequestSchema, translationBlockSchema } from "../types.js";

describe("translation block formatting regions", () => {
  it("accepts valid formatting regions", () => {
    const result = translationBlockSchema.safeParse({
      id: "block-1",
      text: "6x, v, 4x",
      formattingRegions: [
        { id: "fmt-0", start: 0, end: 4 },
        { id: "fmt-1", start: 4, end: 5 },
        { id: "fmt-2", start: 5, end: 9 },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects formatting regions that exceed source text length", () => {
    const result = translationBlockSchema.safeParse({
      id: "block-1",
      text: "6x",
      formattingRegions: [{ id: "fmt-0", start: 0, end: 99 }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects formatting regions whose end is before start", () => {
    const result = translationBlockSchema.safeParse({
      id: "block-1",
      text: "6x",
      formattingRegions: [{ id: "fmt-0", start: 2, end: 1 }],
    });

    expect(result.success).toBe(false);
  });
});


describe("translation request template metadata", () => {
  const baseRequest = {
    designToken: "design-jwt",
    sourceLanguage: "tr" as const,
    targetLanguage: "en" as const,
    blocks: [{ id: "block-1", text: "Synthetic source" }],
  };

  it("accepts a normal translation request without template metadata", () => {
    expect(translateRequestSchema.safeParse(baseRequest).success).toBe(true);
  });

  it("accepts template metadata only when candidate and fingerprint are both present", () => {
    const result = translateRequestSchema.safeParse({
      ...baseRequest,
      templateCandidate: true,
      pageFingerprint: "page-content-v1-known",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a template candidate without a page fingerprint", () => {
    const result = translateRequestSchema.safeParse({
      ...baseRequest,
      templateCandidate: true,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a page fingerprint without templateCandidate true", () => {
    const result = translateRequestSchema.safeParse({
      ...baseRequest,
      pageFingerprint: "page-content-v1-known",
    });

    expect(result.success).toBe(false);
  });

  it("rejects templateCandidate false with a page fingerprint", () => {
    const result = translateRequestSchema.safeParse({
      ...baseRequest,
      templateCandidate: false,
      pageFingerprint: "page-content-v1-known",
    });

    expect(result.success).toBe(false);
  });
});
