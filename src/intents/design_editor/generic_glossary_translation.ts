import type { TargetLanguage } from "./copy_designs";

type LocalizedMeaning = {
  source: readonly string[];
  en: string;
  es: string;
};

type GlossaryRule = {
  sourceAbbreviations: readonly string[];
  targetAbbreviation: {
    en: string;
    es: string;
  };
  meanings: readonly LocalizedMeaning[];
};

const normalize = (text: string): string =>
  text
    .normalize("NFKC")
    .replace(/[‘’‛]/gu, "'")
    .replace(/[“”‟]/gu, '"')
    .replace(/[–—]/gu, "-")
    .replace(/[Iİı]/gu, "i")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("tr");

const rules: readonly GlossaryRule[] = [
  {
    sourceAbbreviations: ["zn"],
    targetAbbreviation: { en: "ch", es: "cad" },
    meanings: [
      { source: ["zincir"], en: "chain", es: "cadena" },
    ],
  },
  {
    sourceAbbreviations: ["sh"],
    targetAbbreviation: { en: "mr", es: "am" },
    meanings: [
      { source: ["sihirli halka"], en: "magic ring", es: "anillo mágico" },
    ],
  },
  {
    sourceAbbreviations: ["x"],
    targetAbbreviation: { en: "sc", es: "pb" },
    meanings: [
      { source: ["sık iğne"], en: "single crochet", es: "punto bajo" },
    ],
  },
  {
    sourceAbbreviations: ["*"],
    targetAbbreviation: { en: "*", es: "*" },
    meanings: [
      {
        source: ["tekrar sayısı"],
        en: "number of repetitions",
        es: "número de repeticiones",
      },
    ],
  },
  {
    sourceAbbreviations: ["v"],
    targetAbbreviation: { en: "inc", es: "aum" },
    meanings: [
      { source: ["arttırma", "artırma"], en: "increase", es: "aumento" },
    ],
  },
  {
    sourceAbbreviations: ["e"],
    targetAbbreviation: { en: "dec", es: "dism" },
    meanings: [
      { source: ["eksiltme"], en: "decrease", es: "disminución" },
    ],
  },
  {
    sourceAbbreviations: ["w"],
    targetAbbreviation: { en: "w", es: "W" },
    meanings: [
      {
        source: [
          "tek ilmek içerisine 3 sık iğne",
          "aynı ilmeğe 3 sık iğne",
        ],
        en: "3 single crochet in the same stitch",
        es: "3 puntos bajos en el mismo punto",
      },
    ],
  },
  {
    sourceAbbreviations: ["hdc"],
    targetAbbreviation: { en: "hdc", es: "mpa" },
    meanings: [
      {
        source: ["yarım trabzan"],
        en: "half double crochet",
        es: "medio punto alto",
      },
    ],
  },
  {
    sourceAbbreviations: ["hdcv"],
    targetAbbreviation: { en: "hdc-inc", es: "aum-mpa" },
    meanings: [
      {
        source: ["yarım trabzan arttırma", "yarım trabzan artırma"],
        en: "half double crochet increase",
        es: "aumento de medio punto alto",
      },
    ],
  },
  {
    sourceAbbreviations: ["dc"],
    targetAbbreviation: { en: "dc", es: "pa" },
    meanings: [
      {
        source: ["ikili trabzan"],
        en: "double crochet",
        es: "punto alto",
      },
    ],
  },
  {
    sourceAbbreviations: ["dcv"],
    targetAbbreviation: { en: "dc-inc", es: "aum-pa" },
    meanings: [
      {
        source: ["ikili trabzan arttırma", "ikili trabzan artırma"],
        en: "double crochet increase",
        es: "aumento de punto alto",
      },
    ],
  },
  {
    sourceAbbreviations: ["dce"],
    targetAbbreviation: { en: "dc-dec", es: "dism-pa" },
    meanings: [
      {
        source: ["ikili trabzan eksiltme"],
        en: "double crochet decrease",
        es: "disminución de punto alto",
      },
    ],
  },
  {
    sourceAbbreviations: ["cc"],
    targetAbbreviation: { en: "SL.ST", es: "pd" },
    meanings: [
      {
        source: ["ilmek kaydırma"],
        en: "slip stitch",
        es: "punto deslizado",
      },
    ],
  },
  {
    sourceAbbreviations: ["flo"],
    targetAbbreviation: { en: "FLO", es: "FLO" },
    meanings: [
      {
        source: ["ön ilmekten örme"],
        en: "front loop only",
        es: "tejer solo por la hebra delantera",
      },
    ],
  },
  {
    sourceAbbreviations: ["blo"],
    targetAbbreviation: { en: "BLO", es: "BLO" },
    meanings: [
      {
        source: ["arka ilmekten örme"],
        en: "back loop only",
        es: "tejer solo por la hebra trasera",
      },
    ],
  },
  {
    sourceAbbreviations: ["m"],
    targetAbbreviation: { en: "M", es: "M" },
    meanings: [
      {
        source: ["3 ilmek birden eksiltme"],
        en: "decrease 3 stitches together",
        es: "disminuir 3 puntos juntos",
      },
    ],
  },
  {
    sourceAbbreviations: ["tr"],
    targetAbbreviation: { en: "tr", es: "pa-tri" },
    meanings: [
      {
        source: ["3'lü trabzan"],
        en: "treble crochet",
        es: "punto alto triple",
      },
      {
        source: [
          "3'lü trabzan, bir ilmeği 3 defa çıkmak",
          "3'lü trabzan bir ilmeği 3 defa çıkmak",
        ],
        en: "treble crochet, pull through the loops in 3 steps",
        es: "punto alto triple, cerrar los bucles en 3 pasos",
      },
    ],
  },
  {
    sourceAbbreviations: ["trv"],
    targetAbbreviation: { en: "tr-inc", es: "aum-pa-tri" },
    meanings: [
      {
        source: [
          "aynı sık iğne içine 2 tane 3'lü trabzan",
          "aynı ilmek içine 2 tane 3'lü trabzan",
        ],
        en: "2 treble crochet in the same stitch",
        es: "2 puntos altos triples en el mismo punto",
      },
    ],
  },
  {
    sourceAbbreviations: ["esc"],
    targetAbbreviation: { en: "esc", es: "pb-ex" },
    meanings: [
      {
        source: [
          "ipi tığa dolamadan 2 defada çıkarma (yalancı trabzan)",
        ],
        en: "extended single crochet",
        es: "punto bajo extendido",
      },
    ],
  },
  {
    sourceAbbreviations: ["escw"],
    targetAbbreviation: { en: "escw", es: "W-pb-ex" },
    meanings: [
      {
        source: ["aynı ilmeğe 3 kere esc"],
        en: "3 esc in the same stitch",
        es: "3 pb-ex en el mismo punto",
      },
    ],
  },
  {
    sourceAbbreviations: ["escv"],
    targetAbbreviation: { en: "esc-inc", es: "aum-pb-ex" },
    meanings: [
      {
        source: ["esc arttırma", "esc artırma"],
        en: "esc increase",
        es: "aumento de punto bajo extendido",
      },
    ],
  },
  {
    sourceAbbreviations: ["ydc"],
    targetAbbreviation: { en: "ydc", es: "ydc" },
    meanings: [
      {
        source: [
          "ipi tığa dolamadan 2 defada çıkarma (yalancı trabzan)",
        ],
        en: "mock double crochet; without yarning over, pull through in 2 steps",
        es: "punto alto falso; sin hacer lazada, cerrar en 2 pasos",
      },
    ],
  },
  {
    sourceAbbreviations: ["ydcw"],
    targetAbbreviation: { en: "ydcw", es: "ydcw" },
    meanings: [
      {
        source: ["aynı ilmeğe 3 kere ydc"],
        en: "3 ydc in the same stitch",
        es: "3 ydc en el mismo punto",
      },
    ],
  },
  {
    sourceAbbreviations: ["ydcv"],
    targetAbbreviation: { en: "ydc-inc", es: "ydc-aum" },
    meanings: [
      {
        source: ["ydc arttırma", "ydc artırma"],
        en: "ydc increase",
        es: "aumento de ydc",
      },
    ],
  },
] as const;

type ParsedEntry = {
  abbreviation: string;
  meaning: string;
};

const parseGlossaryEntries = (text: string): ParsedEntry[] | undefined => {
  const normalizedInput = text.replace(/\r\n?/gu, "\n").trim();

  if (!normalizedInput.includes("✦")) return undefined;

  const starts = [...normalizedInput.matchAll(/✦/gu)].map(
    (match) => match.index ?? -1,
  );

  if (starts.length === 0 || starts.some((index) => index < 0)) {
    return undefined;
  }

  const entries: ParsedEntry[] = [];

  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]!;
    const end = starts[index + 1] ?? normalizedInput.length;
    const rawEntry = normalizedInput.slice(start + 1, end).trim();

    const colonIndex = rawEntry.indexOf(":");
    if (colonIndex <= 0) return undefined;

    const abbreviation = rawEntry.slice(0, colonIndex).trim();
    const meaning = rawEntry.slice(colonIndex + 1).trim();

    if (!abbreviation || !meaning) return undefined;

    entries.push({ abbreviation, meaning });
  }

  return entries;
};

const resolveEntry = (
  entry: ParsedEntry,
  language: TargetLanguage,
): string | undefined => {
  const abbreviation = normalize(entry.abbreviation);
  const meaning = normalize(entry.meaning);

  const rule = rules.find((candidate) =>
    candidate.sourceAbbreviations.some(
      (source) => normalize(source) === abbreviation,
    ),
  );

  if (!rule) return undefined;

  const localizedMeaning = rule.meanings.find((candidate) =>
    candidate.source.some((source) => normalize(source) === meaning),
  );

  if (!localizedMeaning) return undefined;

  return `✦ ${rule.targetAbbreviation[language]}: ${localizedMeaning[language]}`;
};

export const translateGlossaryDeterministically = (
  text: string,
  language: TargetLanguage,
): string | undefined => {
  const entries = parseGlossaryEntries(text);
  if (!entries?.length) return undefined;

  const translated = entries.map((entry) => resolveEntry(entry, language));

  if (translated.some((entry) => entry === undefined)) {
    return undefined;
  }

  return translated.join("\n");
};

export const isDeterministicGlossary = (text: string): boolean =>
  translateGlossaryDeterministically(text, "en") !== undefined;
