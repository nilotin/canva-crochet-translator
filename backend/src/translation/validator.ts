import { validateRoundReferences } from "./natural_language/round_references.js";
import {
  extractSourceMeasurements,
  validateMeasurementIntegrity,
} from "./measurements.js";
import {
  getTargetNotation,
  NATURAL_LANGUAGE_GLOSSARY,
  type CrochetNotationEntry,
} from "./glossary.js";
import { findAmbiguousRepetitionNotation } from "./notation/ambiguous_repetition.js";
import { tokenizeSourceNotation } from "./notation/tokenizer.js";
import { validateTargetLanguageFluency } from "./natural_language/fluency.js";
import { validateSemanticAnchors } from "./natural_language/semantic_anchors.js";
import { findHighRiskInstructionConcepts } from "./review_risk.js";
import { getLeadingInstructionMarker } from "./instruction_marker.js";
import { containsReservedPlaceholder } from "./notation/immutable.js";
import { scanSourceDataRanges } from "./natural_language/normalizer.js";
import {
  ARM_JOINING_SOURCE_PATTERN,
  legacyCourseUnitResolver,
  parseBareRoundCountSourceLine,
  parseBareRoundCountTargetLine,
  parseCourseCountClauseLine,
  scanCompactChainCutSourceSpans,
  scanGenericCourseCountSourceSpans,
  scanRoundCountTrailingActionSourceSpans,
  scanRoundCountTrailingActionTargetSpans,
  scanRoundCountYarnCutSourceSpans,
  scanRoundCountYarnCutTargetSpans,
  scanWorkedChainCutSourceSpans,
  scanWrittenChainCutSourceSpans,
  splitLogicalLines,
  type CourseUnitResolver,
} from "./natural_language/bare_round_count.js";
import type {
  BlockValidation,
  TargetLanguage,
  TranslationBlock,
  ValidationCode,
  ValidationDiagnostic,
  WarningCode,
} from "./types.js";

type ReturnedTranslation = { id: string; translated: string };

const collectMatches = (text: string, pattern: RegExp): string[] =>
  [...text.matchAll(pattern)].map((match) => match[0]);

const normalizedMatches = (text: string, pattern: RegExp): string[] =>
  collectMatches(text, pattern).map((value) =>
    value.toLocaleLowerCase("tr-TR").replaceAll(/\s+/g, ""),
  );

const sameSequence = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const TURKISH_WRITTEN_CROCHET_COUNTS: Record<string, string> = {
  bir: "1",
  iki: "2",
  üç: "3",
  dört: "4",
  beş: "5",
};

type ComparableSourceNumber = {
  value: string;
  start: number;
  end: number;
};

const comparableSourceNumberTokens = (
  source: string,
): ComparableSourceNumber[] => {
  const pattern =
    /\d+(?:[.,]\d+)?|(?<!\p{L})(bir|iki|üç|dört|beş)(?!\p{L})\s+(?=(?:zincir\p{L}*|ilme(?:k|ğ)\p{L}*)(?!\p{L}))/giu;

  return [...source.matchAll(pattern)].flatMap((match) => {
    if (match.index === undefined) return [];
    const written = match[1];
    const value = written
      ? TURKISH_WRITTEN_CROCHET_COUNTS[
          written.toLocaleLowerCase("tr-TR")
        ] ?? written
      : match[0].toLocaleLowerCase("tr-TR").replaceAll(/\s+/g, "");

    return [{
      value,
      start: match.index,
      end: match.index + match[0].length,
    }];
  });
};

const comparableSourceNumbersWithWrittenCrochetCounts = (
  source: string,
): string[] => comparableSourceNumberTokens(source).map(({ value }) => value);

const expectedCrochetCountUnitWord = (
  count: string,
  sourceContext: string,
  sourcePosition: number,
  resolveCourseUnit: CourseUnitResolver,
): "round" | "rounds" | "row" | "rows" => {
  const unit = resolveCourseUnit(sourceContext, sourcePosition);

  if (Number(count) === 1) return unit;
  return unit === "row" ? "rows" : "rounds";
};

const hasValidBareCrochetCountUnits = (
  source: string,
  translated: string,
  sourceContext: string = source,
  sourceOffset = 0,
  resolveCourseUnit: CourseUnitResolver = legacyCourseUnitResolver,
): boolean => {
  const sourceLines = splitLogicalLines(source);
  const translatedLines = splitLogicalLines(translated);
  const claimedTranslatedLineIndexes = new Set<number>();

  for (const [index, sourceLine] of sourceLines.entries()) {
    const sourceMatch = parseBareRoundCountSourceLine(sourceLine.text);
    if (!sourceMatch) continue;

    const expectedUnitWord = expectedCrochetCountUnitWord(
      sourceMatch.rounds,
      sourceContext,
      sourceOffset + sourceLine.start,
      resolveCourseUnit,
    );

    let translatedLineIndex: number | undefined;

    if (sourceLines.length === translatedLines.length) {
      translatedLineIndex = index;

      if (sourceMatch.range !== undefined) {
        const marker = `${sourceMatch.range})`;
        const candidate =
          translatedLines[translatedLineIndex]?.text.trimStart() ?? "";

        if (!candidate.startsWith(marker)) {
          return false;
        }
      }
    } else if (sourceMatch.range !== undefined) {
      const marker = `${sourceMatch.range})`;
      const matchingIndexes = translatedLines
        .map((line, translatedIndex) => ({
          translatedIndex,
          matches: line.text.trimStart().startsWith(marker),
        }))
        .filter(({ matches }) => matches)
        .map(({ translatedIndex }) => translatedIndex);

      if (matchingIndexes.length !== 1) {
        return false;
      }

      translatedLineIndex = matchingIndexes[0];
    } else {
      // A bare count without a stable marker cannot be assigned safely once
      // the target line structure has changed.
      return false;
    }

    if (
      translatedLineIndex === undefined ||
      claimedTranslatedLineIndexes.has(translatedLineIndex)
    ) {
      return false;
    }

    claimedTranslatedLineIndexes.add(translatedLineIndex);

    const translatedLine = translatedLines[translatedLineIndex]?.text;
    if (translatedLine === undefined) {
      return false;
    }

    const unitPattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])${sourceMatch.rounds}\\s+(round|rounds|row|rows)(?![\\p{L}\\p{N}_])`,
      "iu",
    );

    const targetUnit = translatedLine.match(unitPattern)?.[1];

    if (
      targetUnit === undefined ||
      targetUnit.toLocaleLowerCase("en") !== expectedUnitWord
    ) {
      return false;
    }
  }

  return true;
};

type CourseCountClaim = {
  /**
   * Source offset this check asks the resolver at: the clause start (written-
   * chain, worked chain-cut), line start (arm-joining) or count start
   * (generic). It lies on the same line as the renderer's own lookup, which is
   * equivalent because resolver lookup is line-scoped; it is not necessarily
   * the identical offset (the normalizer may resolve after a stripped marker).
   */
  readonly start: number;
  readonly rounds: string;
  /** Leading `N)` / `A-B)` marker the clause captured, if any. */
  readonly prefix: string;
  /** False for counts another check already verifies (trailing-action, cut-yarn). */
  readonly checked: boolean;
};

const overlaps = (
  span: { start: number; end: number },
  claimed: readonly { start: number; end: number }[],
): boolean => claimed.some(({ start, end }) => span.start < end && start < span.end);

/**
 * The course counts of the generic, written-chain, arm-joining and worked
 * chain-cut families, plus the trailing-action and cut-yarn counts that share
 * their source text, in source order. The same shared scanners and precedence
 * as the normalizer: a generic count only where no specialized clause, bare
 * course-count line or compact chain-cut claims the text. Bare lines belong to
 * `hasValidBareCrochetCountUnits`.
 */
const clauseCourseCounts = (source: string): CourseCountClaim[] => {
  const counts: CourseCountClaim[] = [];
  const claimed: { start: number; end: number }[] = [];
  const add = (
    span: { start: number; end: number; rounds: string; prefix: string },
    checked: boolean,
  ) => {
    claimed.push(span);
    counts.push({ start: span.start, rounds: span.rounds, prefix: span.prefix, checked });
  };

  for (const line of splitLogicalLines(source)) {
    if (parseBareRoundCountSourceLine(line.text)) {
      claimed.push(line);
      continue;
    }
    const armJoining = parseCourseCountClauseLine(ARM_JOINING_SOURCE_PATTERN, line.text);
    if (armJoining) add({ ...armJoining, start: line.start, end: line.end }, true);
  }
  for (const span of scanWorkedChainCutSourceSpans(source)) add(span, true);
  for (const span of scanWrittenChainCutSourceSpans(source)) add(span, true);
  for (const span of scanRoundCountTrailingActionSourceSpans(source)) add(span, false);
  for (const span of scanRoundCountYarnCutSourceSpans(source)) add(span, false);
  claimed.push(...scanCompactChainCutSourceSpans(source));
  for (const span of scanGenericCourseCountSourceSpans(source)) {
    if (!overlaps(span, claimed)) add(span, true);
  }

  return counts.sort((left, right) => left.start - right.start);
};

/**
 * Resolver parity for the course-count clauses `hasValidBareCrochetCountUnits`
 * and the swap checks do not cover. Every checked count asks the resolver
 * once, at the offset its renderer resolves it at, and its translated line
 * must carry "<count> <unit word>" in source order. Lines pair exactly as for
 * bare counts: by index when line counts agree, otherwise only through a
 * unique leading marker; anything else fails closed.
 */
const hasValidClauseCourseCountUnits = (
  source: string,
  translated: string,
  sourceContext: string = source,
  sourceOffset = 0,
  resolveCourseUnit: CourseUnitResolver = legacyCourseUnitResolver,
): boolean => {
  const sourceLines = splitLogicalLines(source);
  const translatedLines = splitLogicalLines(translated);
  const counts = clauseCourseCounts(source);
  const claimedTranslatedLineIndexes = new Set<number>();

  for (const [index, sourceLine] of sourceLines.entries()) {
    const lineCounts = counts.filter(
      ({ start }) => start >= sourceLine.start && start <= sourceLine.end,
    );
    if (!lineCounts.some(({ checked }) => checked)) continue;

    let translatedLineIndex: number | undefined;
    if (sourceLines.length === translatedLines.length) {
      translatedLineIndex = index;
    } else {
      const lead = lineCounts.find(({ start, prefix }) =>
        prefix.trim() !== "" &&
        source.slice(sourceLine.start, start).trim() === "");
      const marker = lead?.prefix.trim() ?? getLeadingInstructionMarker(sourceLine.text);
      if (marker === undefined) return false;
      const matching = translatedLines.flatMap((line, translatedIndex) =>
        line.text.trimStart().startsWith(marker) ? [translatedIndex] : []);
      if (matching.length !== 1) return false;
      translatedLineIndex = matching[0];
    }

    if (
      translatedLineIndex === undefined ||
      claimedTranslatedLineIndexes.has(translatedLineIndex)
    ) {
      return false;
    }
    claimedTranslatedLineIndexes.add(translatedLineIndex);

    const translatedLine = translatedLines[translatedLineIndex]?.text;
    if (translatedLine === undefined) return false;

    let cursor = 0;
    for (const count of lineCounts) {
      const unitPattern = new RegExp(
        `(?<![\\p{L}\\p{N}_])${count.rounds}\\s+(round|rounds|row|rows)(?![\\p{L}\\p{N}_])`,
        "iu",
      );
      const match = unitPattern.exec(translatedLine.slice(cursor));
      if (!match) return false;
      cursor += match.index + match[0].length;
      if (!count.checked) continue;

      const expectedUnitWord = expectedCrochetCountUnitWord(
        count.rounds,
        sourceContext,
        sourceOffset + count.start,
        resolveCourseUnit,
      );
      if (match[1]?.toLocaleLowerCase("en") !== expectedUnitWord) return false;
    }
  }

  return true;
};

const comparableSourceNumbersWithVerifiedBareRoundCountSwaps = (
  source: string,
  translated: string,
  sourceContext: string = source,
  sourceOffset = 0,
  resolveCourseUnit: CourseUnitResolver = legacyCourseUnitResolver,
): string[] | undefined => {
  const sourceLines = splitLogicalLines(source);
  const translatedLines = splitLogicalLines(translated);
  if (sourceLines.length !== translatedLines.length) return undefined;

  const comparableSource = sourceLines
    .map((sourceLine, index) => {
      const sourceMatch = parseBareRoundCountSourceLine(sourceLine.text);
      const targetMatch = parseBareRoundCountTargetLine(
        translatedLines[index]?.text ?? "",
      );

      const expectedRoundWord =
        sourceMatch !== undefined
          ? expectedCrochetCountUnitWord(
              sourceMatch.rounds,
              sourceContext,
              sourceOffset + sourceLine.start,
              resolveCourseUnit,
            )
          : undefined;

      const verifiedPair =
        sourceMatch !== undefined &&
        targetMatch !== undefined &&
        sourceMatch.range === targetMatch.range &&
        sourceMatch.rounds === targetMatch.rounds &&
        sourceMatch.stitches === targetMatch.stitches &&
        targetMatch.roundWord === expectedRoundWord;

      const text = verifiedPair
        ? `${sourceMatch.prefix}${sourceMatch.stitches} sıra ${sourceMatch.rounds}x${sourceMatch.suffix}`
        : sourceLine.text;
      return text + sourceLine.separator;
    })
    .join("");

  return comparableSourceNumbersWithWrittenCrochetCounts(comparableSource);
};

const comparableSourceNumbersWithVerifiedTrailingActionSwaps = (
  source: string,
  translated: string,
  sourceContext: string = source,
  sourceOffset = 0,
  resolveCourseUnit: CourseUnitResolver = legacyCourseUnitResolver,
): string[] | undefined => {
  const sourceSpans = scanRoundCountTrailingActionSourceSpans(source);
  const targetSpans = scanRoundCountTrailingActionTargetSpans(translated);

  if (
    sourceSpans.length === 0 ||
    sourceSpans.length !== targetSpans.length
  ) {
    return undefined;
  }

  const sourceNumbers = comparableSourceNumberTokens(source);

  for (const [index, sourceSpan] of sourceSpans.entries()) {
    const targetSpan = targetSpans[index];
    const expectedRoundWord = expectedCrochetCountUnitWord(
      sourceSpan.rounds,
      sourceContext,
      sourceOffset + sourceSpan.start,
      resolveCourseUnit,
    );

    if (
      !targetSpan ||
      sourceSpan.prefix !== targetSpan.prefix ||
      sourceSpan.range !== targetSpan.range ||
      sourceSpan.rounds !== targetSpan.rounds ||
      sourceSpan.stitches !== targetSpan.stitches ||
      sourceSpan.chains !== targetSpan.chains ||
      sourceSpan.kind !== targetSpan.kind ||
      targetSpan.roundWord !== expectedRoundWord
    ) {
      return undefined;
    }

    const roundsIndex = sourceNumbers.findIndex(
      ({ start, end }) =>
        start === sourceSpan.roundsSpan.start &&
        end === sourceSpan.roundsSpan.end,
    );

    const stitchesIndex = sourceNumbers.findIndex(
      ({ start, end }) =>
        start === sourceSpan.stitchesSpan.start &&
        end === sourceSpan.stitchesSpan.end,
    );

    if (
      roundsIndex < 0 ||
      stitchesIndex < 0 ||
      roundsIndex === stitchesIndex
    ) {
      return undefined;
    }

    const rounds = sourceNumbers[roundsIndex];
    const stitches = sourceNumbers[stitchesIndex];

    if (!rounds || !stitches) return undefined;

    sourceNumbers[roundsIndex] = { ...rounds, value: stitches.value };
    sourceNumbers[stitchesIndex] = { ...stitches, value: rounds.value };
  }

  return sourceNumbers.map(({ value }) => value);
};

const comparableSourceNumbersWithVerifiedYarnCutSwaps = (
  source: string,
  translated: string,
  sourceContext: string = source,
  sourceOffset = 0,
  resolveCourseUnit: CourseUnitResolver = legacyCourseUnitResolver,
): string[] | undefined => {
  const sourceSpans = scanRoundCountYarnCutSourceSpans(source);
  const targetSpans = scanRoundCountYarnCutTargetSpans(translated);
  if (
    sourceSpans.length === 0 ||
    sourceSpans.length !== targetSpans.length
  ) {
    return undefined;
  }

  const sourceNumbers = comparableSourceNumberTokens(source);

  for (const [index, sourceSpan] of sourceSpans.entries()) {
    const targetSpan = targetSpans[index];
    const expectedRoundWord = expectedCrochetCountUnitWord(
      sourceSpan.rounds,
      sourceContext,
      sourceOffset + sourceSpan.start,
      resolveCourseUnit,
    );

    if (
      !targetSpan ||
      sourceSpan.prefix !== targetSpan.prefix ||
      sourceSpan.range !== targetSpan.range ||
      sourceSpan.rounds !== targetSpan.rounds ||
      sourceSpan.stitches !== targetSpan.stitches ||
      targetSpan.roundWord !== expectedRoundWord
    ) {
      return undefined;
    }

    const roundsIndex = sourceNumbers.findIndex(
      ({ start, end }) =>
        start === sourceSpan.roundsSpan.start &&
        end === sourceSpan.roundsSpan.end,
    );
    const stitchesIndex = sourceNumbers.findIndex(
      ({ start, end }) =>
        start === sourceSpan.stitchesSpan.start &&
        end === sourceSpan.stitchesSpan.end,
    );
    if (
      roundsIndex < 0 ||
      stitchesIndex < 0 ||
      roundsIndex === stitchesIndex
    ) {
      return undefined;
    }

    const rounds = sourceNumbers[roundsIndex];
    const stitches = sourceNumbers[stitchesIndex];
    if (!rounds || !stitches) return undefined;
    sourceNumbers[roundsIndex] = { ...rounds, value: stitches.value };
    sourceNumbers[stitchesIndex] = { ...stitches, value: rounds.value };
  }

  return sourceNumbers.map(({ value }) => value);
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const countToken = (
  text: string,
  token: string,
  caseInsensitive: boolean,
): number => {
  const pattern = new RegExp(
    `(?<![\\p{L}-])${escapeRegExp(token)}(?![\\p{L}-])`,
    caseInsensitive ? "giu" : "gu",
  );
  return collectMatches(text, pattern).length;
};

const containsSourceGlossaryTerm = (text: string, term: string): boolean => {
  // Turkish “ip” (yarn) may appear as “ipi”, but must not match inside verbs
  // such as “çekip”. Other configured terms intentionally match inflections.
  if (term === "ip") return /(?<!\p{L})ipi?(?!\p{L})/iu.test(text);
  return text.includes(term);
};

const isKnownToolMaterialIntroParenthesesRewrite = (
  source: string,
  translated: string,
): boolean => {
  const match =
    /\b\d+(?:[.,]\d+)?\s*(?:numara|no)\s+tığ\s*,\s*([^,()]+?)\s+ip\s*\(\s*([^)]+?)\s*\)\s+ile\s+örüyoruz\b/iu.exec(
      source,
    );

  if (!match) return false;

  const sourceParentheses = collectMatches(source, /[()]/gu);
  if (
    sourceParentheses.length !== 2 ||
    sourceParentheses[0] !== "(" ||
    sourceParentheses[1] !== ")"
  ) {
    return false;
  }

  const translatedParentheses = collectMatches(translated, /[()]/gu);
  if (translatedParentheses.length !== 0) return false;

  const brand = match[2]?.trim();
  if (!brand) return false;

  const normalizedBrand = brand
    .toLocaleLowerCase("tr-TR")
    .replaceAll(/\s+/gu, " ");

  const normalizedTranslated = translated
    .toLocaleLowerCase("en")
    .replaceAll(/\s+/gu, " ");

  return normalizedTranslated.includes(normalizedBrand);
};

type ConditionalLoopRequirements = {
  defaultLoop: string;
  alternativeLoop: string;
  technique: "both" | "crossed" | "regular";
};

const getKnownConditionalLoopRequirements = (
  source: string,
): ConditionalLoopRequirements | undefined => {
  const sourceWithoutLeadingInstruction = source.replace(
    /^\s*\d+\)\s*/u,
    "",
  );
  const sourceParentheses = collectMatches(
    sourceWithoutLeadingInstruction,
    /[()]/gu,
  );

  if (
    sourceParentheses.length !== 2 ||
    sourceParentheses[0] !== "(" ||
    sourceParentheses[1] !== ")"
  ) {
    return undefined;
  }

  const match =
    /\bbu\s+sırayı\s+(FLO|BLO)\s*[’'ʼ]?\s*dan\s+örüyoruz\s*\(\s*(çapraz\s+ya\s+da\s+düz|çapraz|düz)\s+sık\s+iğne(?:\s+tekniği)?\s+ile\s+örenler\s*,?\s*(FLO|BLO)\s*[’'ʼ]?\s*dan\s+örecekler\s*\)/iu.exec(
      source,
    );

  if (!match) return undefined;

  const defaultLoop = match[1]?.toUpperCase();
  const technique = match[2]
    ?.toLocaleLowerCase("tr-TR")
    .replace(/\s+/gu, " ")
    .trim();
  const alternativeLoop = match[3]?.toUpperCase();

  if (
    !defaultLoop ||
    !technique ||
    !alternativeLoop ||
    defaultLoop === alternativeLoop
  ) {
    return undefined;
  }

  return {
    defaultLoop,
    alternativeLoop,
    technique:
      technique === "çapraz ya da düz"
        ? "both"
        : technique === "çapraz"
          ? "crossed"
          : "regular",
  };
};

const preservesConditionalLoopSemantics = (
  requirements: ConditionalLoopRequirements,
  translated: string,
  targetLanguage: TargetLanguage,
): boolean => {
  const { defaultLoop, alternativeLoop, technique } = requirements;

  const techniquePattern =
    technique === "both"
      ? targetLanguage === "en"
        ? "crossed\\s+or\\s+regular\\s+single\\s+crochet"
        : "punto\\s+bajo\\s+cruzado\\s+o\\s+punto\\s+bajo\\s+normal"
      : technique === "crossed"
        ? targetLanguage === "en"
          ? "crossed\\s+single\\s+crochet"
          : "punto\\s+bajo\\s+cruzado"
        : targetLanguage === "en"
          ? "regular\\s+single\\s+crochet"
          : "punto\\s+bajo\\s+normal";

  if (targetLanguage === "en") {
    return new RegExp(
      `\\bWork\\s+in\\s+${defaultLoop}\\b[\\s\\S]*?\\bIf\\s+using\\s+${techniquePattern}\\s*,\\s*work\\s+in\\s+${alternativeLoop}\\s+instead\\b`,
      "iu",
    ).test(translated);
  }

  return new RegExp(
    `\\bTrabaja\\s+en\\s+${defaultLoop}\\b[\\s\\S]*?\\bSi\\s+usando\\s+${techniquePattern}\\s*,\\s*trabaja\\s+en\\s+${alternativeLoop}\\s+en\\s+su\\s+lugar\\b`,
    "iu",
  ).test(translated);
};

const error = (
  code: ValidationCode,
  message: string,
): ValidationDiagnostic<ValidationCode> => ({ code, message });

const warning = (
  code: WarningCode,
  message: string,
): ValidationDiagnostic<WarningCode> => ({ code, message });

export const validateTranslation = (
  source: string,
  translated: string | undefined,
  targetLanguage: TargetLanguage,
  options: {
    notationCaseInsensitive?: boolean;
    contentKind?: "pattern" | "materials";
    sourceContext?: string;
    sourceStart?: number;
    /** Row/round authority for course counts; defaults to `legacyCourseUnitResolver`. */
    resolveCourseUnit?: CourseUnitResolver;
  } = {},
): BlockValidation => {
  const errors: ValidationDiagnostic<ValidationCode>[] = [];
  const warnings: ValidationDiagnostic<WarningCode>[] = [];

  if (translated === undefined) {
    errors.push(
      error(
        "MISSING_TRANSLATION",
        "No translation was returned for this block.",
      ),
    );
    return { valid: false, errors, warnings };
  }

  if (translated.trim().length === 0) {
    errors.push(
      error("EMPTY_TRANSLATION", "The returned translation is empty."),
    );
    return { valid: false, errors, warnings };
  }

  if (containsReservedPlaceholder(translated)) {
    errors.push(
      error(
        "RESERVED_PLACEHOLDER_LEAK",
        "Internal translation placeholder syntax was found in the output.",
      ),
    );
  }

  errors.push(
    ...validateMeasurementIntegrity(
      extractSourceMeasurements(source),
      translated,
    ),
  );

  const sourceNumbers = normalizedMatches(source, /\d+(?:[.,]\d+)?/gu);
  const translatedNumbers = normalizedMatches(translated, /\d+(?:[.,]\d+)?/gu);

  const numericSequenceMatches =
    sameSequence(sourceNumbers, translatedNumbers) ||
    (options.contentKind !== "materials" &&
      sameSequence(
        comparableSourceNumbersWithWrittenCrochetCounts(source),
        translatedNumbers,
      )) ||
    (options.contentKind !== "materials" &&
      sameSequence(
        comparableSourceNumbersWithVerifiedBareRoundCountSwaps(
          source,
          translated,
          options.sourceContext ?? source,
          options.sourceStart ?? 0,
          options.resolveCourseUnit,
        ) ?? [],
        translatedNumbers,
      )) ||
    (options.contentKind !== "materials" &&
      sameSequence(
        comparableSourceNumbersWithVerifiedYarnCutSwaps(
          source,
          translated,
          options.sourceContext ?? source,
          options.sourceStart ?? 0,
          options.resolveCourseUnit,
        ) ?? [],
        translatedNumbers,
      )) ||
    (options.contentKind !== "materials" &&
      sameSequence(
        comparableSourceNumbersWithVerifiedTrailingActionSwaps(
          source,
          translated,
          options.sourceContext ?? source,
          options.sourceStart ?? 0,
          options.resolveCourseUnit,
        ) ?? [],
        translatedNumbers,
      ));

  const courseCountUnitsValid =
    options.contentKind === "materials" ||
    targetLanguage !== "en" ||
    (hasValidBareCrochetCountUnits(
      source,
      translated,
      options.sourceContext ?? source,
      options.sourceStart ?? 0,
      options.resolveCourseUnit,
    ) &&
      hasValidClauseCourseCountUnits(
        source,
        translated,
        options.sourceContext ?? source,
        options.sourceStart ?? 0,
        options.resolveCourseUnit,
      ));

  if (!numericSequenceMatches || !courseCountUnitsValid) {
    errors.push(
      error(
        "NUMBER_MISMATCH",
        !numericSequenceMatches
          ? `Numeric values changed: expected [${sourceNumbers.join(", ")}], received [${translatedNumbers.join(", ")}].`
          : "Crochet row/round terminology does not match the source construction.",
      ),
    );
  }

  if (options.contentKind === "materials") {
    const sourceLength = source.trim().length;
    const translatedLength = translated.trim().length;

    if (sourceLength >= 20 && translatedLength < sourceLength * 0.35) {
      warnings.push(
        warning(
          "SUSPICIOUSLY_SHORT_TRANSLATION",
          "The translation is unusually short compared with the source.",
        ),
      );
    }

    if (sourceLength > 0 && translatedLength > sourceLength * 3) {
      warnings.push(
        warning(
          "UNUSUALLY_LARGE_EXPANSION",
          "The translation is unusually long compared with the source.",
        ),
      );
    }

    warnings.push(...validateTargetLanguageFluency(translated, targetLanguage));

    return { valid: errors.length === 0, errors, warnings };
  }

  errors.push(...validateRoundReferences(source, translated, targetLanguage));

  for (const ambiguity of findAmbiguousRepetitionNotation(source)) {
    warnings.push(
      warning(
        "AMBIGUOUS_REPETITION_NOTATION",
        `Ambiguous repetition notation detected in the source: ${source.slice(ambiguity.start, ambiguity.end)}. Please review this instruction.`,
      ),
    );
  }

  const repetitionPattern = /\bx\s+\d+\b/giu;
  const sourceRepetitions = normalizedMatches(source, repetitionPattern);
  const translatedRepetitions = normalizedMatches(
    translated,
    repetitionPattern,
  );
  if (!sameSequence(sourceRepetitions, translatedRepetitions)) {
    errors.push(
      error(
        "REPETITION_COUNT_MISMATCH",
        `Repetition notation changed: expected [${sourceRepetitions.join(", ")}], received [${translatedRepetitions.join(", ")}].`,
      ),
    );
  }

  // Source data the normalizer copies verbatim (e.g. a yarn brand such as
  // "Alize 3x") is not crochet notation, so it creates no notation
  // requirement -- but only while it really is a verbatim copy: the target
  // must hold its exact text at least as often as the source does. Otherwise
  // its notation counts as before, so a rewritten brand can never stand in
  // for a lost instruction. The target side needs no exclusion: the exact
  // copy adds the same target abbreviations (e.g. "Brand sc") that the
  // pre-existing count below already finds in the source.
  const textCount = (text: string, needle: string) => text.split(needle).length - 1;
  const sourceData = scanSourceDataRanges(source, targetLanguage).filter(
    ({ text }) => textCount(translated, text) >= textCount(source, text),
  );
  const notationOccurrences = tokenizeSourceNotation(source).filter(
    (occurrence) =>
      !sourceData.some(
        ({ sourceStart, sourceEnd }) => occurrence.start < sourceEnd && occurrence.end > sourceStart,
      ) &&
      !(
        targetLanguage === "en" &&
        occurrence.entry.tr.abbreviation === "x" &&
        (
          (
            /\d+\s+zincir\s*,?\s*\d+\s*$/iu.test(
              source.slice(0, occurrence.start),
            ) &&
            /^\s+atla\b/iu.test(source.slice(occurrence.end))
          ) ||
          (
            /\d+\s+zincir\s+çekip\s+\d+\s*$/iu.test(
              source.slice(0, occurrence.start),
            ) &&
            /^\s+atlıyoruz\b/iu.test(source.slice(occurrence.end))
          )
        )
      ),
  );
  const occurrencesByConcept = new Map<
    string,
    { entry: CrochetNotationEntry }[]
  >();
  for (const occurrence of notationOccurrences) {
    const existing = occurrencesByConcept.get(occurrence.entry.concept) ?? [];
    existing.push(occurrence);
    occurrencesByConcept.set(occurrence.entry.concept, existing);
  }

  for (const occurrences of occurrencesByConcept.values()) {
    const entry = occurrences[0]?.entry;
    if (!entry) continue;

    const target = getTargetNotation(entry, targetLanguage);
    if (!target) {
      errors.push(
        error(
          "MISSING_TARGET_NOTATION_MAPPING",
          `No ${targetLanguage} notation mapping is configured for Turkish “${entry.tr.abbreviation}” (${entry.concept}).`,
        ),
      );
      continue;
    }

    const notationCaseInsensitive =
      options.notationCaseInsensitive === true;

    const sourceCanonicalTargetPattern = new RegExp(
      `(?<![\\p{L}-])${escapeRegExp(target.abbreviation)}(?![\\p{L}-])`,
      notationCaseInsensitive ? "giu" : "gu",
    );

    const preExistingCanonicalTargetCount = [
      ...source.matchAll(sourceCanonicalTargetPattern),
    ].filter((match) => {
      if (match.index === undefined) return false;

      const start = match.index;
      const end = start + match[0].length;

      return !notationOccurrences.some(
        (occurrence) =>
          occurrence.start === start &&
          occurrence.end === end,
      );
    }).length;

    const expectedCount =
      occurrences.length + preExistingCanonicalTargetCount;

    const actualCount = countToken(
      translated,
      target.abbreviation,
      notationCaseInsensitive,
    );

    if (actualCount !== expectedCount) {
      errors.push(
        error(
          "LOST_PATTERN_NOTATION",
          `Notation conversion mismatch for “${entry.tr.abbreviation}”: expected ${expectedCount} occurrence(s) of “${target.abbreviation}”, received ${actualCount}.`,
        ),
      );
    }
  }

  const sourceLeadingMarker = getLeadingInstructionMarker(source);
  const translatedLeadingMarker = getLeadingInstructionMarker(translated);
  if (sourceLeadingMarker && sourceLeadingMarker !== translatedLeadingMarker) {
    errors.push(
      error(
        "LOST_PATTERN_NOTATION",
        `Leading instruction marker changed: expected “${sourceLeadingMarker}”.`,
      ),
    );
  }

  const sourceParentheses = collectMatches(source, /[()]/gu);
  const translatedParentheses = collectMatches(translated, /[()]/gu);
  const conditionalLoopRequirements =
    getKnownConditionalLoopRequirements(source);
  const preservesConditionalLoop = conditionalLoopRequirements
    ? preservesConditionalLoopSemantics(
        conditionalLoopRequirements,
        translated,
        targetLanguage,
      )
    : undefined;
  const translatedConditionalParentheses = collectMatches(
    translated.replace(/^\s*\d+\)\s*/u, ""),
    /[()]/gu,
  );
  const allowsConditionalLoopParenthesesRewrite =
    preservesConditionalLoop === true &&
    translatedConditionalParentheses.length === 0;
  const allowsToolMaterialIntroParenthesesRewrite =
    isKnownToolMaterialIntroParenthesesRewrite(source, translated);

  if (
    preservesConditionalLoop === false ||
    (!sameSequence(sourceParentheses, translatedParentheses) &&
      !allowsConditionalLoopParenthesesRewrite &&
      !allowsToolMaterialIntroParenthesesRewrite)
  ) {
    errors.push(
      error(
        "PARENTHESES_MISMATCH",
        "Parentheses were added, removed, or reordered.",
      ),
    );
  }

  const sourceLength = source.trim().length;
  const translatedLength = translated.trim().length;
  if (sourceLength >= 20 && translatedLength < sourceLength * 0.35) {
    warnings.push(
      warning(
        "SUSPICIOUSLY_SHORT_TRANSLATION",
        "The translation is unusually short compared with the source.",
      ),
    );
  }
  if (sourceLength > 0 && translatedLength > sourceLength * 3) {
    warnings.push(
      warning(
        "UNUSUALLY_LARGE_EXPANSION",
        "The translation is unusually long compared with the source.",
      ),
    );
  }

  const sourceLower = source.toLocaleLowerCase("tr-TR");
  const translatedLower = translated.toLocaleLowerCase(
    targetLanguage === "es" ? "es" : "en",
  );
  for (const entry of NATURAL_LANGUAGE_GLOSSARY) {
    if (
      containsSourceGlossaryTerm(sourceLower, entry.turkish) &&
      !entry[targetLanguage].some((term) =>
        translatedLower.includes(term.toLocaleLowerCase()),
      )
    ) {
      warnings.push(
        warning(
          "POSSIBLE_GLOSSARY_MISMATCH",
          `Expected terminology related to “${entry.turkish}” was not found.`,
        ),
      );
    }
  }

  const semanticAnchors = validateSemanticAnchors(
    source,
    translated,
    targetLanguage,
  );
  errors.push(...semanticAnchors.errors);
  warnings.push(...semanticAnchors.warnings);
  warnings.push(...validateTargetLanguageFluency(translated, targetLanguage));

  const highRiskConcepts = findHighRiskInstructionConcepts(source);
  if (highRiskConcepts.length >= 2) {
    warnings.push(
      warning(
        "MANUAL_REVIEW_RECOMMENDED",
        `Manual review recommended because the source combines spatial or directional concepts: ${highRiskConcepts.join(", ")}.`,
      ),
    );
  }

  return { valid: errors.length === 0, errors, warnings };
};

export const validateReturnedBlockIds = (
  sourceBlocks: readonly TranslationBlock[],
  returned: readonly ReturnedTranslation[],
): Map<string, ValidationDiagnostic<ValidationCode>[]> => {
  const diagnostics = new Map<string, ValidationDiagnostic<ValidationCode>[]>();
  const expectedIds = new Set(sourceBlocks.map((block) => block.id));
  const returnedCounts = new Map<string, number>();

  for (const item of returned) {
    returnedCounts.set(item.id, (returnedCounts.get(item.id) ?? 0) + 1);
    if (!expectedIds.has(item.id)) {
      diagnostics.set(item.id, [
        error(
          "UNEXPECTED_RETURNED_BLOCK_ID",
          `Unexpected returned block ID: ${item.id}.`,
        ),
      ]);
    }
  }

  for (const block of sourceBlocks) {
    const count = returnedCounts.get(block.id) ?? 0;
    const blockDiagnostics: ValidationDiagnostic<ValidationCode>[] = [];
    if (count === 0) {
      blockDiagnostics.push(
        error(
          "MISSING_RETURNED_BLOCK_ID",
          `No result was returned for block ID: ${block.id}.`,
        ),
      );
    } else if (count > 1) {
      blockDiagnostics.push(
        error(
          "DUPLICATE_RETURNED_BLOCK_ID",
          `Block ID ${block.id} was returned ${count} times.`,
        ),
      );
    }
    if (blockDiagnostics.length > 0)
      diagnostics.set(block.id, blockDiagnostics);
  }

  return diagnostics;
};
