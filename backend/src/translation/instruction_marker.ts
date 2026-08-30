export type LeadingInstruction = {
  leadingWhitespace: string;
  marker: string;
  separator: string;
  body: string;
};

// A period is an instruction delimiter only when followed by whitespace/end.
// This deliberately excludes decimal values such as 2.00, 2.5, and 1.75.
const leadingInstructionPattern = /^(\s*)(\d+[.)])(?=\s|$)(\s*)/u;

export const extractLeadingInstruction = (
  source: string,
): LeadingInstruction | undefined => {
  const match = source.match(leadingInstructionPattern);
  if (!match) return undefined;

  const matched = match[0];
  return {
    leadingWhitespace: match[1] ?? "",
    marker: match[2] ?? "",
    separator: match[3] ?? "",
    body: source.slice(matched.length),
  };
};

export const getLeadingInstructionMarker = (
  source: string,
): string | undefined => extractLeadingInstruction(source)?.marker;

export const restoreLeadingInstruction = (
  instruction: LeadingInstruction | undefined,
  translatedBody: string,
): string =>
  instruction
    ? `${instruction.leadingWhitespace}${instruction.marker}${instruction.separator}${translatedBody}`
    : translatedBody;
