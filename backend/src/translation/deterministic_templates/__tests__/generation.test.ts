import { describe, expect, it } from "vitest";

import {
  DeterministicTemplateGenerationError,
  buildDeterministicTemplateRecord,
  hashSourceBlockText,
  type TemplateSourceSnapshot,
} from "../generation.js";

const snapshot = (
  overrides: Partial<TemplateSourceSnapshot> = {},
): TemplateSourceSnapshot => ({
  fingerprint: "page-content-v1-abc123",
  kind: "front_cover",
  blocks: [
    { id: "block-2", order: 2, sourceText: "İkinci blok" },
    { id: "block-1", order: 1, sourceText: "Birinci blok" },
  ],
  ...overrides,
});

describe("hashSourceBlockText", () => {
  it("produces a stable sha256 hex digest for the same text", () => {
    const hash = hashSourceBlockText("Birinci blok");
    expect(hash).toBe(hashSourceBlockText("Birinci blok"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("produces different hashes for different text", () => {
    expect(hashSourceBlockText("Birinci blok")).not.toBe(
      hashSourceBlockText("İkinci blok"),
    );
  });
});

describe("buildDeterministicTemplateRecord", () => {
  const fixedNow = () => new Date("2026-01-01T00:00:00.000Z");

  it("builds a valid record with both languages supplied", () => {
    const record = buildDeterministicTemplateRecord(
      snapshot(),
      { en: ["First block", "Second block"], es: ["Primer bloque", "Segundo bloque"] },
      { approvedBy: "qa-reviewer", now: fixedNow },
    );

    expect(record.fingerprint).toBe("page-content-v1-abc123");
    expect(record.kind).toBe("front_cover");
    expect(record.translations).toEqual({
      en: ["First block", "Second block"],
      es: ["Primer bloque", "Segundo bloque"],
    });
    expect(record.schemaVersion).toBe(1);
    expect(record.sourceBlockCount).toBe(2);
    expect(record.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(record.approvedBy).toBe("qa-reviewer");
  });

  it("sorts blocks by order before building translations and hashes, regardless of input order", () => {
    const record = buildDeterministicTemplateRecord(
      snapshot(),
      { en: ["First block", "Second block"] },
      { now: fixedNow },
    );

    // snapshot() lists block-2 (order 2) before block-1 (order 1) --
    // the record must reflect order-sorted alignment, so the "First
    // block" translation corresponds to the order:1 block's hash.
    expect(record.sourceBlockHashes).toEqual([
      hashSourceBlockText("Birinci blok"),
      hashSourceBlockText("İkinci blok"),
    ]);
  });

  it("builds a valid record with only one language supplied, leaving the other an empty array", () => {
    const record = buildDeterministicTemplateRecord(
      snapshot(),
      { en: ["First block", "Second block"] },
      { now: fixedNow },
    );

    expect(record.translations.en).toEqual(["First block", "Second block"]);
    expect(record.translations.es).toEqual([]);
  });

  it("never carries raw source text anywhere in the returned record", () => {
    const record = buildDeterministicTemplateRecord(
      snapshot(),
      { en: ["First block", "Second block"] },
      { now: fixedNow },
    );

    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("Birinci blok");
    expect(serialized).not.toContain("İkinci blok");
    expect(record.sourceBlockHashes).toHaveLength(2);
    expect(record).not.toHaveProperty("blocks");
  });

  it("omits approvedBy entirely when not supplied", () => {
    const record = buildDeterministicTemplateRecord(
      snapshot(),
      { en: ["First block", "Second block"] },
      { now: fixedNow },
    );

    expect(record).not.toHaveProperty("approvedBy");
  });

  it("rejects a fingerprint that does not match the page-content-v1-* shape", () => {
    expect(() =>
      buildDeterministicTemplateRecord(
        snapshot({ fingerprint: "not-a-real-fingerprint" }),
        { en: ["First block", "Second block"] },
      ),
    ).toThrow(DeterministicTemplateGenerationError);
  });

  it("rejects an unknown template kind", () => {
    expect(() =>
      buildDeterministicTemplateRecord(
        snapshot({
          // @ts-expect-error -- deliberately invalid kind for this test
          kind: "not_a_real_kind",
        }),
        { en: ["First block", "Second block"] },
      ),
    ).toThrow(DeterministicTemplateGenerationError);
  });

  it("rejects a snapshot with no blocks", () => {
    expect(() =>
      buildDeterministicTemplateRecord(snapshot({ blocks: [] }), {
        en: [],
      }),
    ).toThrow(/no blocks/i);
  });

  it("rejects when neither en nor es translations are supplied", () => {
    expect(() => buildDeterministicTemplateRecord(snapshot(), {})).toThrow(
      /never invents/i,
    );
  });

  it("rejects when a supplied language's translation count does not match the block count", () => {
    expect(() =>
      buildDeterministicTemplateRecord(snapshot(), {
        en: ["Only one translation"],
      }),
    ).toThrow(/does not match/i);
  });

  it("rejects an es mismatch even when en is correct", () => {
    expect(() =>
      buildDeterministicTemplateRecord(snapshot(), {
        en: ["First block", "Second block"],
        es: ["Solo uno"],
      }),
    ).toThrow(/does not match/i);
  });

  it("throws DeterministicTemplateGenerationError instances specifically, never a generic Error subtype mismatch", () => {
    try {
      buildDeterministicTemplateRecord(snapshot({ blocks: [] }), { en: [] });
      expect.fail("expected buildDeterministicTemplateRecord to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DeterministicTemplateGenerationError);
      expect((error as Error).name).toBe("DeterministicTemplateGenerationError");
    }
  });
});
