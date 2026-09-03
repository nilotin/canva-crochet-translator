// Explicit, development-only regeneration workflow for deterministic
// template registry records.
//
// This module deliberately does not talk to Canva, an LLM/translation
// provider, or the registry file directly -- it is a pure assembly +
// validation step between two explicit inputs a human controls:
//
//   1. A "source snapshot" -- the exact current live Turkish source
//      blocks for one template_candidate page, captured from the real
//      Canva runtime in development (see the frontend's
//      captureTemplateCandidateSnapshot in whole_document_classification.ts).
//      This snapshot legitimately contains source text: it is a
//      temporary, human-facing capture artifact used to produce
//      translations from, never itself the persisted registry.
//
//   2. Human-approved EN/ES translations for that exact snapshot,
//      block-order aligned. This module never invents, guesses, or
//      fetches these -- they must be supplied. There is no LLM call
//      anywhere in this file.
//
// The output is a DeterministicTemplateDefinition (registry.ts) that
// intentionally does NOT carry the source text forward: only a
// per-block hash of it, so a human can later verify a registry record
// still corresponds to a given live page (by re-capturing and comparing
// hashes) without the private registry file ever storing raw customer
// content.
//
// A record built here does not become active until a caller explicitly
// persists it via DeterministicTemplateRegistry.upsertTemplate -- see
// ../../scripts/generate-deterministic-template.ts for the CLI that
// wires this together end to end.
import { createHash } from "node:crypto";
import {
  DETERMINISTIC_TEMPLATE_KINDS,
  DETERMINISTIC_TEMPLATE_SCHEMA_VERSION,
  type DeterministicTemplateDefinition,
} from "./registry.js";

export type DeterministicTemplateKind =
  (typeof DETERMINISTIC_TEMPLATE_KINDS)[number];

// The development-only capture artifact. Intentionally the only place in
// this whole feature that carries source text -- never persisted to the
// registry, never logged by this module.
export type TemplateSourceBlockSnapshot = {
  id: string;
  order: number;
  sourceText: string;
};

export type TemplateSourceSnapshot = {
  // Captured directly from the real Canva runtime's own
  // pageContentFingerprint computation (whole_document_classification.ts)
  // -- never recomputed or retyped by a human, so the registry key can
  // never drift from what the running app will actually look up.
  fingerprint: string;
  // The template kind a human has confirmed for this page. The
  // diagnostic guessTemplateCandidateKind() heuristic may suggest a
  // starting value, but this field is what actually gets registered --
  // it must be a deliberate human decision, not the unauthenticated
  // guess (see the safety note in whole_document_classification.ts).
  kind: DeterministicTemplateKind;
  blocks: TemplateSourceBlockSnapshot[];
};

// Human-approved translations, aligned by array index to
// snapshot.blocks sorted by `order`. At least one language is required;
// a missing language is left out of the resulting record entirely
// (rather than filled with an empty/placeholder array), so a partially
// translated snapshot can never silently activate a bypass for the
// language that has no approved text yet.
//
// NOTE: this deliberately does not accept hand-supplied target
// formatting ranges. See registry.ts's note on why that was removed --
// deterministic_bypass.ts computes and bounds-checks safe formatting
// ranges on its own, and blocks rather than guessing when it cannot.
export type ApprovedTemplateTranslations = {
  en?: string[];
  es?: string[];
};

export type TemplateGenerationOptions = {
  // Free-text identifier of who approved these translations (e.g. a
  // name or ticket reference). Purely a provenance note -- never
  // validated against anything, never used for authorization.
  approvedBy?: string;
  now?: () => Date;
};

export class DeterministicTemplateGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeterministicTemplateGenerationError";
  }
}

const FINGERPRINT_PATTERN = /^page-content-v1-[0-9a-f]+$/u;

// SHA-256 (not the fast FNV-style hash used for the page-level
// fingerprint -- that one is tuned for cheap change-detection, not
// provenance) of one source block's exact text. This is the only trace
// of the source text that ever reaches the persisted registry.
export const hashSourceBlockText = (sourceText: string): string =>
  createHash("sha256").update(sourceText, "utf8").digest("hex");

const sortedBlocks = (
  blocks: readonly TemplateSourceBlockSnapshot[],
): TemplateSourceBlockSnapshot[] =>
  [...blocks].sort((left, right) => left.order - right.order);

// Builds one registry-ready DeterministicTemplateDefinition from a
// captured source snapshot and human-approved translations. Throws
// DeterministicTemplateGenerationError (never silently proceeds, never
// fabricates a missing translation) when:
//   - the fingerprint is not in the expected page-content-v1-* shape;
//   - the kind is not one of the registered template kinds;
//   - no translation language was supplied at all;
//   - a supplied language's block count does not exactly match the
//     snapshot's block count;
//   - the snapshot has no blocks.
export const buildDeterministicTemplateRecord = (
  snapshot: TemplateSourceSnapshot,
  approvedTranslations: ApprovedTemplateTranslations,
  options: TemplateGenerationOptions = {},
): DeterministicTemplateDefinition => {
  if (!FINGERPRINT_PATTERN.test(snapshot.fingerprint)) {
    throw new DeterministicTemplateGenerationError(
      `Fingerprint "${snapshot.fingerprint}" does not match the expected page-content-v1-* shape. Refusing to hand-construct a registry key.`,
    );
  }

  if (!DETERMINISTIC_TEMPLATE_KINDS.includes(snapshot.kind)) {
    throw new DeterministicTemplateGenerationError(
      `Unknown template kind "${String(snapshot.kind)}". Expected one of: ${DETERMINISTIC_TEMPLATE_KINDS.join(", ")}.`,
    );
  }

  const blocks = sortedBlocks(snapshot.blocks);

  if (blocks.length === 0) {
    throw new DeterministicTemplateGenerationError(
      "Source snapshot has no blocks; refusing to register an empty deterministic template.",
    );
  }

  const languages = (["en", "es"] as const).filter(
    (language) => approvedTranslations[language] !== undefined,
  );

  if (languages.length === 0) {
    throw new DeterministicTemplateGenerationError(
      "No human-approved translations were supplied for either target language. " +
        "This tool never invents deterministic template translations -- provide " +
        "approved EN and/or ES text for every source block first.",
    );
  }

  const translations: { en: string[]; es: string[] } = { en: [], es: [] };

  for (const language of languages) {
    const provided = approvedTranslations[language]!;

    if (provided.length !== blocks.length) {
      throw new DeterministicTemplateGenerationError(
        `Approved ${language} translation count (${provided.length}) does not match the source snapshot's block count (${blocks.length}) for fingerprint "${snapshot.fingerprint}".`,
      );
    }

    translations[language] = provided;
  }

  const now = options.now ?? (() => new Date());

  return {
    fingerprint: snapshot.fingerprint,
    kind: snapshot.kind,
    translations,
    schemaVersion: DETERMINISTIC_TEMPLATE_SCHEMA_VERSION,
    sourceBlockCount: blocks.length,
    sourceBlockHashes: blocks.map((block) => hashSourceBlockText(block.sourceText)),
    generatedAt: now().toISOString(),
    ...(options.approvedBy ? { approvedBy: options.approvedBy } : {}),
  };
};
