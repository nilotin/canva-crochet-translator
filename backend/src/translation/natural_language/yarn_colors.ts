import type { TargetLanguage } from "../types.js";

const YARN_COLORS: Record<string, Record<TargetLanguage, string>> = {
  "açık gri": { en: "light gray", es: "gris claro" },
  siyah: { en: "black", es: "negro" },
  beyaz: { en: "white", es: "blanco" },
  kırmızı: { en: "red", es: "rojo" },
  mavi: { en: "blue", es: "azul" },
  yeşil: { en: "green", es: "verde" },
  sarı: { en: "yellow", es: "amarillo" },
  mor: { en: "purple", es: "morado" },
  lila: { en: "lilac", es: "lila" },
  turuncu: { en: "orange", es: "naranja" },
  pembe: { en: "pink", es: "rosa" },
  kahverengi: { en: "brown", es: "marrón" },
  gri: { en: "gray", es: "gris" },
  ekru: { en: "ecru", es: "crudo" },
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export const TURKISH_YARN_COLOR_PATTERN = Object.keys(YARN_COLORS)
  .sort((left, right) => right.length - left.length)
  .map((color) => color.split(/\s+/u).map(escapeRegExp).join("\\s+"))
  .join("|");

export const translateTurkishYarnColor = (
  source: string,
  targetLanguage: TargetLanguage,
): string | undefined => {
  const normalized = source
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/gu, " ")
    .trim();

  return YARN_COLORS[normalized]?.[targetLanguage];
};
