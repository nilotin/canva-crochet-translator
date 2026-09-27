/**
 * Production dependency path for typed course decisions (next stage, Task 8).
 *
 * The only approved path from production into the typed layer is:
 *
 *   translator.ts
 *     -> course_unit_resolution.ts
 *       -> context/course_decisions.ts
 *         -> typed lexer / parser / PatternContext
 *
 * natural_language/ and the validator still know only the
 * `CourseUnitResolver` seam. The existing shadow-isolation tests are left as
 * they are; this test pins the one production path that is allowed.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const translationRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = resolve(translationRoot, "..");

const productionFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : productionFiles(path);
    }
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });

/** Relative import/export specifiers of `path`, resolved to paths under translation/ (".js" -> ".ts"). */
const localImports = (path: string): string[] =>
  [...readFileSync(path, "utf8").matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/gu)].map(
    ([, specifier]) =>
      relative(translationRoot, resolve(dirname(path), specifier!.replace(/\.js$/u, ".ts"))).split(sep).join("/"),
  );

const inTranslation = (path: string) => relative(translationRoot, path).split(sep).join("/");
const files = productionFiles(sourceRoot);
const importersOf = (predicate: (target: string) => boolean) =>
  files.filter((path) => localImports(path).some(predicate)).map(inTranslation).sort();

const TYPED_LAYER = /^(?:context|parser|lexer)\//u;

describe("course unit integration: approved production path", () => {
  it("only course_unit_resolution.ts (outside context/) imports context/", () => {
    const importers = importersOf((target) => target.startsWith("context/")).filter(
      (path) => !path.startsWith("context/"),
    );
    expect(importers).toEqual(["course_unit_resolution.ts"]);
  });

  it("only translator.ts imports course_unit_resolution.ts", () => {
    expect(importersOf((target) => target === "course_unit_resolution.ts")).toEqual(["translator.ts"]);
  });

  it("translator.ts imports no context/, parser/ or lexer/ module directly", () => {
    const translator = files.find((path) => inTranslation(path) === "translator.ts")!;
    expect(localImports(translator).filter((target) => TYPED_LAYER.test(target))).toEqual([]);
    expect(localImports(translator)).toContain("course_unit_resolution.ts");
  });

  it("course_unit_resolution.ts imports only the pre-pass and the resolver seam", () => {
    const adapter = files.find((path) => inTranslation(path) === "course_unit_resolution.ts")!;
    expect([...new Set(localImports(adapter))].sort()).toEqual([
      "context/course_decisions.ts",
      "natural_language/bare_round_count.ts",
    ]);
  });

  it("context/course_decisions.ts imports only typed lexer / parser / context infrastructure", () => {
    const prepass = files.find((path) => inTranslation(path) === "context/course_decisions.ts")!;
    const imports = localImports(prepass);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((target) => !TYPED_LAYER.test(target))).toEqual([]);
  });
});

describe("course unit integration: the seam stays the only semantic dependency", () => {
  it("natural_language/ imports no context/, parser/, lexer/ or course_unit_resolution module", () => {
    const offenders = files
      .filter((path) => inTranslation(path).startsWith("natural_language/"))
      .filter((path) =>
        localImports(path).some((target) => TYPED_LAYER.test(target) || target === "course_unit_resolution.ts"),
      )
      .map(inTranslation);
    expect(offenders).toEqual([]);
  });

  it("validator.ts imports no context/, parser/, lexer/ or course_unit_resolution module", () => {
    const validator = files.find((path) => inTranslation(path) === "validator.ts")!;
    expect(
      localImports(validator).filter((target) => TYPED_LAYER.test(target) || target === "course_unit_resolution.ts"),
    ).toEqual([]);
  });

  it("no production module outside the approved path imports parser/ or lexer/", () => {
    const importers = importersOf((target) => /^(?:parser|lexer)\//u.test(target)).filter(
      (path) => !TYPED_LAYER.test(path) && !/^(?:renderer|assembly)\//u.test(path),
    );
    expect(importers).toEqual([]);
  });
});
