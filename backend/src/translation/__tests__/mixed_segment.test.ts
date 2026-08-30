import { describe, expect, it } from "vitest";
import {
  classifySegment,
  lexMixedSegment,
  reconstructMixedSegment,
  reconstructMixedSegmentWithProjection,
  reconstructMixedSource,
  validateMixedProseSpans,
} from "../mixed_segment.js";

describe("mixed pattern segment lexer", () => {
  it.each([
    ["26) 20x, 6v, 10x = 36x", "pattern_only"],
    ["Merhaba dünya", "natural_language_only"],
    ["26) 20x, 6v = 26x", "pattern_only"],
    ["2.00 no tığ ile örüyoruz.", "mixed"],
    ["12 sıra 66x", "mixed"],
    ["25x, 1 zincir, 1x atla", "mixed"],
    ["12-23) 12 sıra 66x", "mixed"],
  ] as const)("classifies %s as %s", (source, expected) => {
    expect(classifySegment(source)).toBe(expected);
  });

  it("does not tokenize notation letters inside natural-language words", () => {
    expect(classifySegment("xenon kelimesini açıklıyoruz.")).toBe(
      "natural_language_only",
    );
  });

  it("owns every number, notation token, structural character, and boundary space", () => {
    const lexed = lexMixedSegment("12-23) 12 sıra 66x", "en", "segment");
    expect(lexed.spans).toEqual([{ id: "segment::text-span:0", text: "sıra" }]);
    expect(
      lexed.tokens.map((token) => {
        if (token.kind === "notation")
          return {
            kind: token.kind,
            source: token.source,
            target: token.target,
          };
        if (token.kind === "natural_language")
          return { kind: token.kind, id: token.id, text: token.text };
        return { kind: token.kind, text: token.text };
      }),
    ).toEqual([
      { kind: "number", text: "12" },
      { kind: "structure", text: "-" },
      { kind: "number", text: "23" },
      { kind: "structure", text: ")" },
      { kind: "whitespace", text: " " },
      { kind: "number", text: "12" },
      { kind: "whitespace", text: " " },
      {
        kind: "natural_language",
        id: "segment::text-span:0",
        text: "sıra",
      },
      { kind: "whitespace", text: " " },
      { kind: "number", text: "66" },
      { kind: "notation", source: "x", target: "sc" },
    ]);
  });

  it.each([
    "2.00 no tığ ile örüyoruz.",
    "2.5 mm tığ ile örüyoruz.",
    "12-23) 12 sıra 66x",
    "24) 25x, 1 zincir, 1x atla, 10x, 1 zincir, 1x atla, 29x",
  ])("covers and round-trips every source character exactly: %s", (source) => {
    const lexed = lexMixedSegment(source, "en", "segment");
    expect(lexed.valid).toBe(true);
    expect(lexed.errors).toEqual([]);
    expect(reconstructMixedSource(lexed.tokens)).toBe(source);
    expect(lexed.tokens[0]?.start).toBe(0);
    expect(lexed.tokens.at(-1)?.end).toBe(source.length);
    lexed.tokens.forEach((token, index) => {
      expect(token.end).toBe(lexed.tokens[index + 1]?.start ?? source.length);
      expect(source.slice(token.start, token.end)).toBe(token.sourceText);
    });
  });

  it("keeps a decimal immutable and sends only the following prose", () => {
    const lexed = lexMixedSegment("2.00 no tığ ile örüyoruz.", "en", "segment");
    expect(lexed.classification).toBe("mixed");
    expect(lexed.spans).toEqual([
      {
        id: "segment::text-span:0",
        text: "no tığ ile örüyoruz.",
      },
    ]);
    expect(lexed.spans[0]?.text).not.toContain("2.00");
  });

  it("allows ordinary prose punctuation returned by the provider", () => {
    expect(
      validateMixedProseSpans([
        {
          id: "natural-comma",
          text: "For me, the ending point of both legs",
        },
      ]),
    ).toEqual([]);
  });

  it("rejects a provider-bound prose span containing immutable content", () => {
    expect(
      validateMixedProseSpans([
        { id: "bad-number", text: "2.00 crochet" },
        { id: "bad-notation", text: "work 10x" },
      ]),
    ).toEqual([
      "Text span 1 contains immutable pattern content.",
      "Text span 2 contains immutable pattern content.",
    ]);
  });

  it.each([
    ["blo’sundan 32x", "BLO"],
    ["flo’sundan 24x", "FLO"],
  ] as const)(
    "protects FLO/BLO notation inside Turkish suffixed source forms",
    (source, expectedNotation) => {
      const lexed = lexMixedSegment(source, "en", "segment");

      expect(lexed.valid).toBe(true);
      expect(
        lexed.tokens.some(
          (token) =>
            token.kind === "notation" && token.target === expectedNotation,
        ),
      ).toBe(true);
    },
  );

  it.each([
    ["Blo’dan 32x", "from", "BLO from 32sc"],
    ["Flo’dan 24x", "from", "FLO from 24sc"],
    ["blo’sundan 16x", "from", "BLO from 16sc"],
    ["flo’sundan 12x", "from", "FLO from 12sc"],
  ] as const)(
    "keeps a target word boundary after suffixed FLO/BLO notation: %s",
    (source, translatedSuffix, expected) => {
      const lexed = lexMixedSegment(source, "en", "segment");

      expect(lexed.valid).toBe(true);
      expect(lexed.spans).toHaveLength(1);

      const span = lexed.spans[0]!;

      expect(
        reconstructMixedSegment(
          lexed.tokens,
          new Map([[span.id, translatedSuffix]]),
        ),
      ).toBe(expected);
    },
  );

  it("tracks target offsets for notation and translated prose", () => {
    const lexed = lexMixedSegment("6x örüyoruz", "en", "segment");

    expect(lexed.valid).toBe(true);
    expect(lexed.spans).toEqual([
      {
        id: "segment::text-span:0",
        text: "örüyoruz",
      },
    ]);

    const reconstructed = reconstructMixedSegmentWithProjection(
      lexed.tokens,
      new Map([["segment::text-span:0", "crochet"]]),
    );

    expect(reconstructed.text).toBe("6sc crochet");

    expect(reconstructed.pieces).toEqual([
      {
        kind: "number",
        sourceStart: 0,
        sourceEnd: 1,
        targetStart: 0,
        targetEnd: 1,
      },
      {
        kind: "notation",
        sourceStart: 1,
        sourceEnd: 2,
        targetStart: 1,
        targetEnd: 3,
      },
      {
        kind: "whitespace",
        sourceStart: 2,
        sourceEnd: 3,
        targetStart: 3,
        targetEnd: 4,
      },
      {
        kind: "natural_language",
        sourceStart: 3,
        sourceEnd: 11,
        targetStart: 4,
        targetEnd: 11,
      },
    ]);
  });

  it("groups adjacent prose while keeping structural whitespace exact", () => {
    const lexed = lexMixedSegment(
      "1x zincir ile oluşturduğumuz boşluklara, 6x",
      "en",
      "segment",
    );
    expect(lexed.spans).toEqual([
      {
        id: "segment::text-span:0",
        text: "zincir ile oluşturduğumuz boşluklara",
      },
    ]);
    expect(
      reconstructMixedSegment(
        lexed.tokens,
        new Map([["segment::text-span:0", "spaces created with the chain"]]),
      ),
    ).toBe("1sc spaces created with the chain, 6sc");
  });

  it("reconstructs multiple spans by ID and cannot concatenate adjacent numbers", () => {
    const lexed = lexMixedSegment(
      "24) 25x, 1 zincir, 1x atla, 10x, 1 zincir, 1x atla, 29x",
      "en",
      "segment",
    );
    expect(lexed.spans.map(({ text }) => text)).toEqual([
      "zincir",
      "atla",
      "zincir",
      "atla",
    ]);
    const translated = reconstructMixedSegment(
      lexed.tokens,
      new Map(
        lexed.spans.map(({ id, text }) => [
          id,
          text === "zincir" ? "ch" : "skip",
        ]),
      ),
    );
    expect(translated).toBe(
      "24) 25sc, 1 ch, 1sc skip, 10sc, 1 ch, 1sc skip, 29sc",
    );
    expect(translated).not.toContain("1266");
  });

  it("preserves parentheses and repetition operators outside provider spans", () => {
    const lexed = lexMixedSegment("(1x, v) x 6 sıra", "es", "segment");
    expect(lexed.spans).toEqual([{ id: "segment::text-span:0", text: "sıra" }]);
    expect(
      reconstructMixedSegment(
        lexed.tokens,
        new Map([["segment::text-span:0", "vueltas"]]),
      ),
    ).toBe("(1pb, aum) x 6 vueltas");
  });
});
