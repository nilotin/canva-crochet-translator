// Explicit, case-sensitive length units. Uppercase M remains crochet notation.
// Do not consume product identifiers, ordinal dots, or partial decimal values.
const measurementPattern =
  /(?<![\p{L}\p{N}_.,])(\d+(?:[.,]\d+)?)[ \t\u00a0\u202f]*(cm|mm|m)(?![\p{L}\p{N}_])/gu;

export type Measurement = {
  source: string;
  value: string;
  unit: string;
  start: number;
  end: number;
};

export const extractMeasurements = (text: string): Measurement[] =>
  [...text.matchAll(measurementPattern)].map((match) => ({
    source: match[0],
    value: match[1]!,
    unit: match[2]!,
    start: match.index,
    end: match.index + match[0].length,
  }));

const hookNumberPattern =
  /(\d+(?:[.,]\d+)?)\s+(?:numara|no)\s+tığ(?![\p{L}\p{N}_])/giu;

const bareHookSizePattern =
  /(?<![\p{L}\p{N}_.,])(\d+(?:[.,]\d+)?)\s+tığ(?![\p{L}\p{N}_])/giu;

export const extractSourceMeasurements = (text: string): Measurement[] => {
  const explicit = extractMeasurements(text);

  const hookSizes: Measurement[] = [
    ...text.matchAll(hookNumberPattern),
    ...text.matchAll(bareHookSizePattern),
  ].map((match) => ({
    source: match[0],
    value: match[1]!,
    unit: "mm",
    start: match.index,
    end: match.index + match[0].length,
  }));

  return [...explicit, ...hookSizes].sort((left, right) => left.start - right.start);
};

// Keep the lexical value (including trailing decimal zeros) and unit unchanged.
// A space is appropriate for both supported target languages, English/Spanish.
export const renderMeasurement = (
  measurement: Pick<Measurement, "value" | "unit">,
): string => `${measurement.value} ${measurement.unit}`;

export const validateMeasurementIntegrity = (
  expected: readonly Pick<Measurement, "value" | "unit">[],
  translated: string,
) => {
  const actual = extractMeasurements(translated);
  return expected.length === actual.length &&
    expected.every(
      (measurement, index) =>
        measurement.value === actual[index]?.value &&
        measurement.unit === actual[index]?.unit,
    )
    ? []
    : [
        {
          code: "MEASUREMENT_INTEGRITY_MISMATCH" as const,
          message:
            "Measurements must retain their numeric precision, paired units, occurrence counts, and source order.",
        },
      ];
};
