import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  classifySegment,
  lexMixedSegment,
  reconstructMixedSegment,
  reconstructMixedSegmentWithProjection,
  reconstructMixedSource,
  validateMixedProseSpans,
  type LexedMixedSegment,
  type MixedSegmentToken,
} from "../mixed_segment.js";
import { extractLeadingInstruction } from "../instruction_marker.js";
import { normalizeSourceNaturalLanguageDetailed } from "../natural_language/normalizer.js";
import { reservedPlaceholder, reservedPlaceholdersIn } from "../notation/immutable.js";
import { segmentTranslationBlock } from "../segmentation.js";
import { loadCorpus } from "./corpus/load_corpus.js";

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

  it("preserves compressed repetition notation literally during reconstruction", () => {
    const source = "11) FLO’ dan (9x, 1v)*66x";
    const lexed = lexMixedSegment(source, "en", "segment");

    expect(lexed.valid).toBe(true);
    expect(
      lexed.tokens.map(({ kind, sourceText, start, end }) => ({
        kind,
        sourceText,
        start,
        end,
      })),
    ).toEqual(
      expect.arrayContaining([
        { kind: "notation", sourceText: "*", start: 21, end: 22 },
        { kind: "number", sourceText: "66", start: 22, end: 24 },
        { kind: "notation", sourceText: "x", start: 24, end: 25 },
      ]),
    );

    const prose = new Map(
      lexed.spans.map(({ id, text }) => [
        id,
        text === "’ dan" ? "from" : text,
      ]),
    );
    expect(reconstructMixedSegment(lexed.tokens, prose)).toBe(
      "11) FLO from (9sc, 1inc)*66sc",
    );
  });

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

// ---------------------------------------------------------------------------
// Expected reserved placeholders (Stage 1, Task 8)
// ---------------------------------------------------------------------------

const P0 = reservedPlaceholder(0);
const P1 = reservedPlaceholder(1);
const P2 = reservedPlaceholder(2);

const lexWith = (source: string, reservedPlaceholders: readonly string[]) =>
  lexMixedSegment(source, "en", "s", { reservedPlaceholders });

/** Structural invariants of a valid mixed result. */
const expectExactTiling = (source: string, lexed: LexedMixedSegment) => {
  expect(lexed.valid).toBe(true);
  let cursor = 0;
  for (const token of lexed.tokens) {
    expect(token.start).toBe(cursor);
    expect(source.slice(token.start, token.end)).toBe(token.sourceText);
    cursor = token.end;
  }
  expect(cursor).toBe(source.length);
  expect(reconstructMixedSource(lexed.tokens)).toBe(source);
  for (const span of lexed.spans) expect(reservedPlaceholdersIn(span.text)).toEqual([]);
  expect(validateMixedProseSpans(lexed.spans)).toEqual([]);
};

describe("mixed lexer: expected reserved placeholders", () => {
  it("emits one atomic reserved_placeholder token and keeps it out of provider spans", () => {
    const source = `Önce ${P0} sonra 6x örüyoruz.`;
    const lexed = lexWith(source, [P0]);
    expectExactTiling(source, lexed);
    expect(lexed.classification).toBe("mixed");
    expect(lexed.tokens.filter(({ kind }) => kind === "reserved_placeholder")).toEqual([
      { kind: "reserved_placeholder", text: P0, start: 5, end: 17, sourceText: P0 },
    ]);
    expect(lexed.spans.map(({ text }) => text)).toEqual(["Önce", "sonra", "örüyoruz."]);
  });

  it("reconstructs the placeholder verbatim, with and without provider text", () => {
    const source = `Önce ${P0} sonra 6x örüyoruz.`;
    const lexed = lexWith(source, [P0]);
    expect(reconstructMixedSource(lexed.tokens)).toBe(source);
    const translations = new Map(lexed.spans.map(({ id, text }) => [id, text.toUpperCase()]));
    expect(reconstructMixedSegment(lexed.tokens, translations)).toBe(`ÖNCE ${P0} SONRA 6sc ÖRÜYORUZ.`);
  });

  it("emits an ordinary projection piece in carrier coordinates (not final frame provenance)", () => {
    // Source and target offsets here are positions in the carrier text that
    // holds the placeholder, not in the original block, and the placeholder is
    // still unrestored. Mapping to final provenance is deferred.
    const lexed = lexWith(`Önce ${P0} sonra 6x örüyoruz.`, [P0]);
    const { pieces } = reconstructMixedSegmentWithProjection(lexed.tokens, new Map());
    expect(pieces.filter(({ kind }) => kind === "reserved_placeholder")).toEqual([
      { kind: "reserved_placeholder", sourceStart: 5, sourceEnd: 17, targetStart: 1, targetEnd: 13 },
    ]);
  });

  it("classifies prose plus a placeholder as mixed, never as prose", () => {
    const source = `Önce ${P0} sonra devam.`;
    expect(lexMixedSegment(source, "en", "s").classification).toBe("natural_language_only");
    const lexed = lexWith(source, [P0]);
    expectExactTiling(source, lexed);
    expect(lexed.classification).toBe("mixed");
    expect(lexed.spans.map(({ text }) => text)).toEqual(["Önce", "sonra devam."]);
  });

  it("treats a placeholder like immutable content for pattern-only classification", () => {
    expect(lexWith(P0, [P0]).classification).toBe("pattern_only");
    const withPeriod = lexWith(`${P0}.`, [P0]);
    expectExactTiling(`${P0}.`, withPeriod);
    expect(withPeriod.classification).toBe("mixed");
    expect(lexMixedSegment("6x.", "en", "s").classification).toBe(withPeriod.classification);
  });
});

describe("mixed lexer: reserved placeholders never collide with immutable numbering", () => {
  it("keeps notation correct when an expected placeholder uses the first immutable id", () => {
    const source = `${P0}, 6x örüyoruz.`;
    const lexed = lexWith(source, [P0]);
    expectExactTiling(source, lexed);
    expect(lexed.tokens.map(({ kind, sourceText }) => [kind, sourceText]).slice(0, 5)).toEqual([
      ["reserved_placeholder", P0],
      ["structure", ","],
      ["whitespace", " "],
      ["number", "6"],
      ["notation", "x"],
    ]);
    expect(reconstructMixedSegment(lexed.tokens, new Map([[lexed.spans[0]!.id, "work"]]))).toBe(`${P0}, 6sc work`);
  });

  it("handles several expected placeholders that overlap the default range", () => {
    const source = `${P1} 20x, ${P0} 6v ve ${P2}.`;
    const lexed = lexWith(source, [P2, P0, P1]);
    expectExactTiling(source, lexed);
    expect(
      lexed.tokens
        .filter(
          (token): token is Extract<MixedSegmentToken, { kind: "reserved_placeholder" }> =>
            token.kind === "reserved_placeholder",
        )
        .map((token) => token.text),
    ).toEqual([
      P1,
      P0,
      P2,
    ]);
    const rebuilt = reconstructMixedSegment(lexed.tokens, new Map(lexed.spans.map(({ id, text }) => [id, text])));
    for (const placeholder of [P0, P1, P2]) expect(rebuilt.split(placeholder)).toHaveLength(2);
    expect(rebuilt).toContain("20sc");
    expect(rebuilt).toContain("6inc");
  });
});

describe("mixed lexer: invalid expected-placeholder usage", () => {
  it.each([
    [
      "an expected placeholder is missing",
      "6x örüyoruz.",
      [P0],
      [`Expected reserved placeholder ${P0} must occur exactly once in the source (found 0).`],
    ],
    [
      "an expected placeholder occurs twice",
      `${P0} ve ${P0} 6x`,
      [P0],
      [`Expected reserved placeholder ${P0} must occur exactly once in the source (found 2).`],
    ],
    ["a placeholder is listed twice", `${P0} 6x`, [P0, P0], [`Duplicate expected reserved placeholder ${P0}.`]],
    [
      "an expected value is not a canonical placeholder",
      `${P0} 6x`,
      ["__XQaaaaQX__", `${P0} `, "x"],
      [
        'Invalid expected reserved placeholder "__XQaaaaQX__".',
        `Invalid expected reserved placeholder "${P0} ".`,
        'Invalid expected reserved placeholder "x".',
        `Unexpected reserved placeholder ${P0} in the source.`,
      ],
    ],
    [
      "the source holds reserved syntax that was not declared",
      `${P1} ve ${P0} 6x`,
      [P0],
      [`Unexpected reserved placeholder ${P1} in the source.`],
    ],
  ])("is invalid when %s", (_label, source, reservedPlaceholders, errors) => {
    expect(lexWith(source, reservedPlaceholders)).toEqual({
      classification: "mixed",
      tokens: [],
      spans: [],
      valid: false,
      errors,
    });
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility: no options behaves exactly as before Task 8.
// ---------------------------------------------------------------------------

/** Fixed inputs; the digest below was computed with the pre-Task-8 lexer. */
const COMPATIBILITY_INPUTS: readonly string[] = [
  "",
  "x",
  "Merhaba dünya",
  "xenon kelimesini açıklıyoruz.",
  "26) 20x, 6v, 10x = 36x",
  "26) 20x, 6v = 26x",
  "2.00 no tığ ile örüyoruz.",
  "12 sıra 66x",
  "25x, 1 zincir, 1x atla",
  "12-23) 12 sıra 66x",
  "(1x, v) x 6 sıra",
  "(6x, v) x 6. FLO örüyoruz.",
  "24) 25x, 1 zincir, 1x atla, 10x, 1 zincir, 1x atla, 29x",
  "6x sonra duruyoruz",
  "7. sık iğneye ipimizi sabitliyoruz.",
  "Görselde görüldüğü gibi birinci parçanın bittiği yerden 6x sayıp atlıyoruz.\n7. sık iğneye ipimizi sabitliyoruz.\nBütün sıra sonlarında 1 zincir çekip dönüyoruz.",
  "13) 5 sıra 16x",
  "Sıra sonunda 1 zincir çekip dönüyoruz.",
  "6. sıranın BLO’sundan örüyoruz.",
  "55cm ip",
  "2 adet Catania TR263 - ten rengi",
  "✦ Bu sıradan sonra kol ve \ngövdeye teli takabilirsiniz.\n4) (7x, 1e)*6 = 48x",
  "Work 28x, Ch 1 and turn. At the end of each row, ch 1 and turn.",
  "Bluz kolu;\n1) As shown in the image, attach the yarn from the back of the armhole. Work 20x. This will be the beginning of the round; place a stitch marker here.",
  "Metin __XQAAAAQX__ burada.",
  "Metin __XQAAAAQX__ ile 6x örüyoruz.",
  "__XQaaaaQX__ 6x",
  "6x __XQAAAAQX____XQAAABQX__",
  "20x, 6v\n__XQAAAFQX__. Sonra devam.",
  "🧶 6x örüyoruz 🪡",
];

/**
 * Regression fingerprint, not an architectural or corpus-count invariant:
 * SHA-256 of the lexer output, source reconstruction and projection for every
 * COMPATIBILITY_INPUTS entry in both languages, recorded from the committed
 * lexer before Task 8. It proves Task 8 left the default (no-options) path
 * unchanged. A later, intentional change to the default lexer re-records it in
 * that same reviewed change; it must never be updated just to make a test pass.
 */
const PRE_TASK_8_DIGEST = "06f524f643604e5e27c72cc19f1c5117cc2378b7d2d9b6ea63539ba9f365c4a0";

const lexerDigest = (lex: (source: string, language: "en" | "es") => LexedMixedSegment): string => {
  const rows = COMPATIBILITY_INPUTS.flatMap((s) =>
    (["en", "es"] as const).map((lang) => {
      const r = lex(s, lang);
      return {
        s,
        lang,
        r,
        source: reconstructMixedSource(r.tokens),
        projection: reconstructMixedSegmentWithProjection(
          r.tokens,
          new Map(r.spans.map(({ id, text }) => [id, `<${text}>`])),
        ),
      };
    }),
  );
  return createHash("sha256").update(JSON.stringify(rows), "utf8").digest("hex");
};

/** Every corpus block, segment and normalized segment body, in both languages. */
const corpusLexerInputs = (): string[] => {
  const inputs = new Set<string>(COMPATIBILITY_INPUTS);
  for (const { value } of loadCorpus().cases) {
    for (const block of value.request.blocks) {
      inputs.add(block.text);
      for (const segment of segmentTranslationBlock(block.text)) {
        inputs.add(segment.text);
        const body = extractLeadingInstruction(segment.text)?.body ?? segment.text;
        for (const language of ["en", "es"] as const) {
          inputs.add(
            normalizeSourceNaturalLanguageDetailed(body, language, "pattern", block.text, segment.start).text,
          );
        }
      }
    }
  }
  return [...inputs];
};

describe("mixed lexer: default path is unchanged", () => {
  it("matches the pre-Task-8 digest with no options", () => {
    expect(lexerDigest((source, language) => lexMixedSegment(source, language, "p"))).toBe(PRE_TASK_8_DIGEST);
  });

  it("matches the pre-Task-8 digest with an empty options object and an empty list", () => {
    expect(lexerDigest((source, language) => lexMixedSegment(source, language, "p", {}))).toBe(PRE_TASK_8_DIGEST);
    expect(
      lexerDigest((source, language) => lexMixedSegment(source, language, "p", { reservedPlaceholders: [] })),
    ).toBe(PRE_TASK_8_DIGEST);
  });

  it("gives identical results with and without empty options for every corpus-derived input", () => {
    for (const source of corpusLexerInputs()) {
      for (const language of ["en", "es"] as const) {
        const legacy = lexMixedSegment(source, language, "p");
        expect(lexMixedSegment(source, language, "p", { reservedPlaceholders: [] })).toEqual(legacy);
        expect(lexMixedSegment(source, language, "p", {})).toEqual(legacy);
      }
    }
  });
});
