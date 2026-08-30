import type { CrochetNotationEntry } from "../glossary.js";

export type SourceNotationOccurrence = {
  entry: CrochetNotationEntry;
  start: number;
  end: number;
};

export type ProtectedNotationToken = {
  placeholder: string;
  entry: CrochetNotationEntry;
};

export type ProtectedNotationText = {
  text: string;
  tokens: ProtectedNotationToken[];
};

export type PlaceholderIntegrityCode =
  | "MISSING_PROTECTED_NOTATION"
  | "DUPLICATE_PROTECTED_NOTATION"
  | "UNEXPECTED_PROTECTED_NOTATION"
  | "MUTATED_PROTECTED_NOTATION"
  | "REORDERED_PROTECTED_NOTATION";

export type PlaceholderIntegrityDiagnostic = {
  code: PlaceholderIntegrityCode;
  message: string;
};

export type NotationRestoration = {
  text: string;
  valid: boolean;
  errors: PlaceholderIntegrityDiagnostic[];
};
