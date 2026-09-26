/**
 * Regression guard for the two helpers exported from `immutable.ts` in
 * Stage 1 Task 5 (`reservedPlaceholder`, `placeholderIntegrityErrors`). The
 * export was a behavior-neutral extraction: these tests pin the exact
 * placeholder encoding, the throw, and every integrity diagnostic (code,
 * message and order), and show `restoreImmutablePattern` reports exactly what
 * the shared helper reports.
 */
import { describe, expect, it } from "vitest";
import {
  placeholderIntegrityErrors,
  protectImmutablePattern,
  reservedPlaceholder,
  reservedPlaceholdersIn,
  restoreImmutablePattern,
} from "../immutable.js";

describe("reservedPlaceholder", () => {
  it.each([
    [0, "__XQAAAAQX__"],
    [1, "__XQAAABQX__"],
    [25, "__XQAAAZQX__"],
    [26, "__XQAABAQX__"],
    [675, "__XQAAZZQX__"],
    [676, "__XQABAAQX__"],
    [456975, "__XQZZZZQX__"],
  ])("encodes index %i as %s", (index, placeholder) => {
    expect(reservedPlaceholder(index)).toBe(placeholder);
  });

  it("throws the same error past the last four-letter code", () => {
    expect(() => reservedPlaceholder(456976)).toThrow("Too many immutable tokens in one block.");
  });

  it("is exactly what protectImmutablePattern assigns, from startIndex on", () => {
    const protectedText = protectImmutablePattern("26) 20x, 6v = 26x", 40);
    expect(protectedText.tokens.map(({ placeholder }) => placeholder)).toEqual(
      protectedText.tokens.map((_token, index) => reservedPlaceholder(40 + index)),
    );
  });
});

describe("placeholderIntegrityErrors", () => {
  const a = reservedPlaceholder(0);
  const b = reservedPlaceholder(1);

  it("is empty for exactly the expected placeholders in order", () => {
    expect(placeholderIntegrityErrors(`${a} x ${b}`, [a, b])).toEqual([]);
    expect(placeholderIntegrityErrors("no tokens", [])).toEqual([]);
  });

  it("reports a missing placeholder", () => {
    expect(placeholderIntegrityErrors(`${a} only`, [a, b])).toEqual([
      { code: "MISSING_PROTECTED_NOTATION", message: `Protected immutable token ${b} is missing.` },
    ]);
  });

  it("reports a duplicated placeholder with its count", () => {
    expect(placeholderIntegrityErrors(`${a} ${a} ${b}`, [a, b])).toEqual([
      {
        code: "DUPLICATE_PROTECTED_NOTATION",
        message: `Protected immutable token ${a} was returned 2 times.`,
      },
    ]);
  });

  it("reports an unexpected placeholder", () => {
    expect(placeholderIntegrityErrors(`${a} __XQZZZZQX__`, [a])).toEqual([
      {
        code: "UNEXPECTED_PROTECTED_NOTATION",
        message: "Unexpected protected immutable token __XQZZZZQX__ was returned.",
      },
    ]);
  });

  it("reports a mutated placeholder after the missing one it replaced", () => {
    expect(placeholderIntegrityErrors("__XQAAaaQX__", [a])).toEqual([
      { code: "MISSING_PROTECTED_NOTATION", message: `Protected immutable token ${a} is missing.` },
      {
        code: "MUTATED_PROTECTED_NOTATION",
        message: "Protected immutable token was mutated: __XQAAaaQX__.",
      },
    ]);
  });

  it("reports REORDERED only when there is no other integrity error", () => {
    expect(placeholderIntegrityErrors(`${b} ${a}`, [a, b])).toEqual([
      { code: "REORDERED_PROTECTED_NOTATION", message: "Protected immutable tokens were reordered." },
    ]);
    expect(
      placeholderIntegrityErrors(`${b} ${a} __XQZZZZQX__`, [a, b]).map(({ code }) => code),
    ).toEqual(["UNEXPECTED_PROTECTED_NOTATION"]);
  });
});

describe("restoreImmutablePattern after the extraction", () => {
  const source = "26) 20x, 6v = 26x";
  const protectedText = protectImmutablePattern(source);
  const placeholders = protectedText.tokens.map(({ placeholder }) => placeholder);

  it.each([
    ["missing", protectedText.text.replace(placeholders[0]!, "")],
    ["duplicate", `${protectedText.text} ${placeholders[0]}`],
    ["unexpected", `${protectedText.text} __XQZZZZQX__`],
    ["mutated", protectedText.text.replace(placeholders[0]!, "__XQaaaaQX__")],
    ["reordered", protectedText.text.replace(placeholders[0]!, "#").replace(placeholders[1]!, placeholders[0]!).replace("#", placeholders[1]!)],
  ])("reports exactly the shared helper's diagnostics when %s", (_label, translated) => {
    const restored = restoreImmutablePattern(translated, protectedText, "en");
    expect(restored.valid).toBe(false);
    expect(restored.text).toBe(translated);
    expect(restored.errors).toEqual(placeholderIntegrityErrors(translated, placeholders));
  });

  it("still restores an intact carrier", () => {
    expect(restoreImmutablePattern(protectedText.text, protectedText, "en")).toEqual({
      text: "26) 20sc, 6inc = 26sc",
      valid: true,
      errors: [],
    });
  });
});

describe("reservedPlaceholdersIn", () => {
  it("returns every exact reserved placeholder in textual order, duplicates kept", () => {
    const [a, b] = [reservedPlaceholder(0), reservedPlaceholder(1)];
    expect(reservedPlaceholdersIn(`${b} x ${a}, ${b}`)).toEqual([b, a, b]);
  });

  it("ignores placeholder-shaped text that is not exact", () => {
    expect(reservedPlaceholdersIn("__XQaaaaQX__ __XQAAAQX__ plain")).toEqual([]);
  });

  it("matches exactly what protectImmutablePattern inserted, in order", () => {
    const protectedText = protectImmutablePattern("26) 20x, 6v = 26x", 3);
    expect(reservedPlaceholdersIn(protectedText.text)).toEqual(
      protectedText.tokens.map(({ placeholder }) => placeholder),
    );
  });

  it("is repeatable (no shared regex state)", () => {
    const text = `${reservedPlaceholder(4)} ${reservedPlaceholder(2)}`;
    expect(reservedPlaceholdersIn(text)).toEqual(reservedPlaceholdersIn(text));
  });
});
