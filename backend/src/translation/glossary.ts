import type { TargetLanguage } from "./types.js";

export type NotationDefinition = { abbreviation: string; description: string };

export type CrochetNotationEntry = {
  concept: string;
  tr: NotationDefinition;
  en: NotationDefinition | null;
  es: NotationDefinition | null;
};

export const PROJECT_NOTATION: readonly CrochetNotationEntry[] = [
  {
    concept: "chain",
    tr: { abbreviation: "zn", description: "zincir" },
    en: { abbreviation: "ch", description: "Chain" },
    es: { abbreviation: "cad", description: "cadena" },
  },
  {
    concept: "magic_ring",
    tr: { abbreviation: "sh", description: "sihirli halka" },
    en: { abbreviation: "mr", description: "The magic ring" },
    es: { abbreviation: "am", description: "anillo mágico" },
  },
  {
    concept: "single_crochet",
    tr: { abbreviation: "x", description: "sık iğne" },
    en: { abbreviation: "sc", description: "single crochet" },
    es: { abbreviation: "pb", description: "punto bajo" },
  },
  {
    concept: "repetitions",
    tr: { abbreviation: "*", description: "tekrar sayısı" },
    en: { abbreviation: "*", description: "Number of repetitions" },
    es: { abbreviation: "*", description: "número de repeticiones" },
  },
  {
    concept: "increase",
    tr: { abbreviation: "v", description: "arttırma" },
    en: { abbreviation: "inc", description: "increase" },
    es: { abbreviation: "aum", description: "aumentar" },
  },
  {
    concept: "decrease",
    tr: { abbreviation: "e", description: "eksiltme" },
    en: { abbreviation: "dec", description: "decrease" },
    es: { abbreviation: "dism", description: "disminuir" },
  },
  {
    concept: "three_single_crochet_same_stitch",
    tr: { abbreviation: "w", description: "tek ilmek içerisine 3 sık iğne" },
    en: { abbreviation: "w", description: "3sc in same stitch" },
    es: { abbreviation: "W", description: "hacer 3 puntos simples en 1 punto" },
  },
  {
    concept: "half_double_crochet",
    tr: { abbreviation: "hdc", description: "yarım trabzan" },
    en: { abbreviation: "hdc", description: "Half Double Crochet" },
    es: { abbreviation: "mpa", description: "medio punto alto" },
  },
  {
    concept: "half_double_crochet_increase",
    tr: { abbreviation: "hdcv", description: "yarım trabzan arttırma" },
    en: {
      abbreviation: "hdc-inc",
      description: "Half Double Crochet Increase",
    },
    es: { abbreviation: "aum-mpa", description: "aumento de medio punto alto" },
  },
  {
    concept: "double_crochet",
    tr: { abbreviation: "dc", description: "ikili trabzan" },
    en: { abbreviation: "dc", description: "Double Crochet" },
    es: { abbreviation: "pa", description: "punto alto" },
  },
  {
    concept: "double_crochet_increase",
    tr: { abbreviation: "dcv", description: "ikili trabzan arttırma" },
    en: { abbreviation: "dc-inc", description: "Double Crochet Increase" },
    es: { abbreviation: "aum-pa", description: "aumento de punto alto" },
  },
  {
    concept: "double_crochet_decrease",
    tr: { abbreviation: "dce", description: "ikili trabzan eksiltme" },
    en: { abbreviation: "dc-dec", description: "Double Crochet Decrease" },
    es: { abbreviation: "dism-pa", description: "disminución de punto alto" },
  },
  {
    concept: "slip_stitch",
    tr: { abbreviation: "CC", description: "ilmek kaydırma" },
    en: { abbreviation: "SL.ST", description: "Slip Stitch" },
    es: { abbreviation: "pd", description: "punto deslizado" },
  },
  {
    concept: "front_loop_only",
    tr: { abbreviation: "FLO", description: "ön ilmekten örme" },
    en: { abbreviation: "FLO", description: "Crochet in the Front Loop Only" },
    es: {
      abbreviation: "Flo",
      description: "tejer por hebra delantera del punto",
    },
  },
  {
    concept: "back_loop_only",
    tr: { abbreviation: "BLO", description: "arka ilmekten örme" },
    en: { abbreviation: "BLO", description: "Crochet in the Back Loop Only" },
    es: {
      abbreviation: "Blo",
      description: "tejer por hebra trasera del punto",
    },
  },
  {
    concept: "decrease_three_single_crochet",
    tr: { abbreviation: "M", description: "3 ilmek birden eksiltme" },
    en: { abbreviation: "M", description: "Decrease 3sc in one time" },
    es: {
      abbreviation: "M",
      description: "disminuir 3 puntos al mismo tiempo",
    },
  },
  {
    concept: "treble_crochet",
    tr: {
      abbreviation: "tr",
      description: "3'lü trabzan, bir ilmeği 3 defa çıkmak",
    },
    en: { abbreviation: "tr", description: "Treble crochet" },
    es: { abbreviation: "pa-tri", description: "punto alto triple" },
  },
  {
    concept: "extended_double_crochet",
    tr: {
      abbreviation: "esc",
      description: "ipi tığa dolamadan 2 defada çıkarma (yalancı trabzan)",
    },
    en: {
      abbreviation: "esc",
      description:
        "The process of taking off the hook in two attempts without wrapping the thread around it (extended double crochet stitch)",
    },
    es: { abbreviation: "pa-ex", description: "punto alto extendido" },
  },
  // Extended-stitch family: base, increase, then three stitches in one stitch.
  {
    concept: "extended_double_crochet_increase",
    tr: { abbreviation: "escv", description: "esc arttırma" },
    en: { abbreviation: "esc-inc", description: "esc increase" },
    es: {
      abbreviation: "aum-pa-ex",
      description: "aumento de punto alto extendido",
    },
  },
  {
    concept: "three_extended_double_crochet_same_stitch",
    tr: { abbreviation: "escw", description: "aynı ilmeğe 3 kere esc" },
    en: { abbreviation: "escw", description: "3 esc in the same stitch" },
    es: {
      abbreviation: "W-pa-ex",
      description: "3 pa-ex en el mismo punto",
    },
  },
] as const;

export type NaturalLanguageGlossaryEntry = {
  turkish: string;
  en: readonly string[];
  es: readonly string[];
};

export const NATURAL_LANGUAGE_GLOSSARY: readonly NaturalLanguageGlossaryEntry[] =
  [
    { turkish: "ip", en: ["yarn", "thread", "tail"], es: ["hilo", "hebra"] },
    {
      turkish: "sabitlemek",
      en: ["secure", "fasten", "fasten off", "attach", "join"],
      es: ["asegurar", "rematar", "sujetar", "unir"],
    },
    { turkish: "dikmek", en: ["sew", "stitch"], es: ["coser"] },
    { turkish: "doldurmak", en: ["stuff", "fill"], es: ["rellenar"] },
    { turkish: "doldurma", en: ["stuffing", "filling"], es: ["relleno"] },
    { turkish: "göz", en: ["eye"], es: ["ojo"] },
    { turkish: "kaş", en: ["eyebrow"], es: ["ceja"] },
    { turkish: "kirpik", en: ["eyelash"], es: ["pestaña"] },
  ] as const;

export const getTargetNotation = (
  entry: CrochetNotationEntry,
  targetLanguage: TargetLanguage,
): NotationDefinition | null => entry[targetLanguage];

export const formatNotationGlossary = (
  targetLanguage: TargetLanguage,
): string =>
  PROJECT_NOTATION.map((entry) => {
    const target = getTargetNotation(entry, targetLanguage);
    return target
      ? `${entry.tr.abbreviation} (${entry.tr.description}) -> ${target.abbreviation} (${target.description})`
      : `${entry.tr.abbreviation} (${entry.tr.description}) -> [NO CONFIGURED ${targetLanguage.toUpperCase()} MAPPING]`;
  }).join("\n");

export const formatNaturalLanguageGlossary = (
  targetLanguage: TargetLanguage,
): string =>
  NATURAL_LANGUAGE_GLOSSARY.map(
    (entry) => `${entry.turkish} = ${entry[targetLanguage].join(" / ")}`,
  ).join("\n");
