import type { RegisteredTemplateSummary } from "./registry.js";

export type RegistryFingerprintComparison = {
  // Fingerprints seen in real translate requests (e.g. collected from the
  // "fingerprint_not_registered" dev diagnostics in app.ts) that do not
  // correspond to any entry currently in the registry.
  unregisteredFingerprints: string[];
  // Registry entries whose fingerprint was never observed in the supplied
  // set of real fingerprints -- i.e. templates that may be stale, or were
  // never matched by a live page.
  orphanedTemplates: RegisteredTemplateSummary[];
};

// Pure, content-free comparison: takes only fingerprint/kind/block-count
// metadata (never translations or source text) and never invents or
// guesses a correspondence between an unregistered fingerprint and any
// existing template -- it only reports the two disjoint sets so a human
// can decide what, if anything, needs regenerating. This deliberately does
// NOT attempt fuzzy or best-effort matching: exact-match is the safety
// property the deterministic bypass depends on, and this utility exists to
// make an exact-match miss diagnosable, not to work around it.
export const compareRegistryFingerprints = (
  registeredTemplates: readonly RegisteredTemplateSummary[],
  observedFingerprints: readonly string[],
): RegistryFingerprintComparison => {
  const registeredFingerprints = new Set(
    registeredTemplates.map((template) => template.fingerprint),
  );
  const observedSet = new Set(observedFingerprints);

  return {
    unregisteredFingerprints: [...observedSet].filter(
      (fingerprint) => !registeredFingerprints.has(fingerprint),
    ),
    orphanedTemplates: registeredTemplates.filter(
      (template) => !observedSet.has(template.fingerprint),
    ),
  };
};
