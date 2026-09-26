/**
 * Strict, deterministic loader for the Stage 0 golden corpus (test support only).
 *
 * Reads `cases/*.json` and returns validated, frozen cases. It never repairs,
 * skips or guesses. Anything it cannot fully trust becomes an issue, and every
 * issue found across the whole corpus is reported together in one
 * `CorpusLoadError`, each carrying the file name and (when it could be read)
 * the case id.
 *
 * What is enforced per file:
 *  - the name is `<id>.json` and the bytes are valid UTF-8 without a BOM;
 *  - the text is JSON and passes the Step 2 zod schema (no partial acceptance);
 *  - the id's lane prefix and 10-hex hash match the canonical request
 *    (Step 2 `caseIdMatchesRequest`, so page numbers and file order never
 *    influence an id). In the harvested lane the id must also carry the
 *    8-hex scenario hash of request plus replay provider config
 *    (`caseIdMatchesScenario`), because one request can legitimately appear
 *    under several provider behaviors;
 *  - the file is byte-for-byte the canonical form (Step 2 `canonicalizeCase`
 *    plus `canonicalJsonPretty`), so a hand edit that reorders keys is refused
 *    and diffs stay minimal;
 *  - formatting rules the schema cannot express (see `checkFormattingRules`).
 *    Formatting region ids are BLOCK-LOCAL (the frontend derives `fmt-N` per
 *    block from its own snapshot list), so the same id may legally repeat in
 *    another block; only within one block must ids stay unique (schema.ts).
 *    `regionStyles` is optional: a case whose request has formatting regions but
 *    no `regionStyles` loads, and its style-dependent frontend verdict is simply
 *    not evaluated at replay (`formatting_replay.ts`). When `regionStyles` ARE
 *    provided they must cover every (blockId, regionId) pair of every block.
 *
 * What is enforced across files:
 *  - case ids are unique;
 *  - within one lane, no two cases share a canonical request. The same request
 *    in different lanes is allowed (a repro and a curated case may share one).
 *    In the harvested lane the unit is the scenario: the same request under a
 *    different replay provider config is a different case, but the same
 *    request AND config twice is a duplicate.
 *
 * Determinism: input files are sorted by UTF-16 code unit, issues are ordered
 * by file name, nothing reads a clock, the environment or randomness.
 *
 * Pending-approval cases load and are listed under `pending`. They are never
 * `executable`, and `requireExecutable` refuses them, so a case a human has not
 * approved can never be replayed as if it were.
 *
 * Import rules: only node:fs, node:path, node:url, `./canonicalize.js` and
 * `./schema.js`. No translator or provider code.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  canonicalJsonPretty,
  canonicalizeCase,
  canonicalScenarioJson,
  canonicalizeRequest,
  caseIdMatchesRequest,
  caseIdMatchesScenario,
  compareStrings,
  deriveCaseId,
  deriveHarvestedCaseId,
} from "./canonicalize.js";
import {
  corpusCaseSchema,
  type CorpusCase,
  type CorpusLane,
} from "./schema.js";

export const CASES_DIRECTORY = fileURLToPath(new URL("./cases/", import.meta.url));

export type CorpusIssue = {
  /** File name inside the cases directory. */
  file: string;
  /** The case id, when the file was readable far enough to know it. */
  caseId?: string;
  message: string;
};

const describeIssue = (issue: CorpusIssue): string =>
  `  ${issue.file}${issue.caseId === undefined ? "" : ` (${issue.caseId})`}: ${issue.message}`;

export class CorpusLoadError extends Error {
  readonly issues: readonly CorpusIssue[];

  constructor(issues: readonly CorpusIssue[]) {
    const ordered = [...issues].sort((left, right) =>
      compareStrings(left.file, right.file),
    );
    super(
      `Corpus load failed with ${ordered.length} issue(s):\n${ordered
        .map(describeIssue)
        .join("\n")}`,
    );
    this.name = "CorpusLoadError";
    this.issues = ordered;
  }
}

export type CorpusFileInput = {
  name: string;
  bytes: Uint8Array | string;
};

export type LoadedCorpusCase = {
  file: string;
  caseId: string;
  lane: CorpusLane;
  /** False only for pending-approval cases. */
  executable: boolean;
  /** Deeply frozen. Copy before handing any part of it to code that may mutate. */
  value: CorpusCase;
};

/** A loaded case that is safe to replay: it has stored expected and trace. */
export type ExecutableCase = LoadedCorpusCase & {
  value: CorpusCase & {
    expected: NonNullable<CorpusCase["expected"]>;
    trace: NonNullable<CorpusCase["trace"]>;
  };
};

export type LoadedCorpus = {
  /** Every case, sorted by file name. */
  cases: readonly LoadedCorpusCase[];
  executable: readonly ExecutableCase[];
  pending: readonly LoadedCorpusCase[];
};

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const MAX_SCHEMA_ISSUES_PER_FILE = 8;

/** Rules the zod schema does not (and should not) express. */
const checkFormattingRules = (value: CorpusCase): string[] => {
  const problems: string[] = [];

  // Formatting region ids are block-local (the schema already rejects a
  // duplicate id WITHIN one block). The same id in two different blocks is
  // legal frontend behavior, not a collision, so nothing is checked here
  // across blocks.
  const hasAnyRegion = value.request.blocks.some(
    (block) => (block.formattingRegions ?? []).length > 0,
  );

  // Only PROVIDED styles are checked for coverage. Absent styles are allowed
  // and mean "unknown", never "uniform"; an empty array is still provided.
  // Coverage is checked per (blockId, regionId) pair, so two blocks that both
  // have an "fmt-0" need their own, separate style entries.
  if (hasAnyRegion && value.regionStyles !== undefined) {
    const styled = new Set(
      value.regionStyles.map((entry) => `${entry.blockId}\u0000${entry.regionId}`),
    );
    const missing = value.request.blocks.flatMap((block) =>
      (block.formattingRegions ?? [])
        .filter((region) => !styled.has(`${block.id}\u0000${region.id}`))
        .map((region) => `${block.id}/${region.id}`),
    );
    if (missing.length > 0) {
      problems.push(
        `regionStyles has no entry for source region(s): ${missing.join(", ")}. ` +
          "Provided regionStyles must cover every source region of every block (omit regionStyles entirely when the styles are unknown).",
      );
    }
  }

  const hasTargetRegions = (value.expected?.results ?? []).some(
    (result) => result.targetFormattingRegions !== undefined,
  );
  if (hasTargetRegions && value.expected?.styledSlices === undefined) {
    problems.push(
      "expected results carry targetFormattingRegions but expected.styledSlices is missing, so the styled text would be unpinned.",
    );
  }

  return problems;
};

type FileOutcome = {
  issues: CorpusIssue[];
  value?: CorpusCase;
  /** Lane-scoped duplicate key (harvested: request plus replay provider config), when it could be built. */
  requestKey?: string;
};

const decodeText = (bytes: Uint8Array | string): string => {
  if (typeof bytes === "string") {
    return bytes;
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
};

const loadOne = (input: CorpusFileInput): FileOutcome => {
  const file = input.name;
  const issues: CorpusIssue[] = [];
  let caseId: string | undefined;
  const report = (message: string): void => {
    issues.push(caseId === undefined ? { file, message } : { file, caseId, message });
  };

  if (!file.endsWith(".json") || file.length <= ".json".length) {
    report('Only "<case id>.json" files are allowed in the corpus cases directory.');
    return { issues };
  }

  let text: string;
  try {
    text = decodeText(input.bytes);
  } catch (error) {
    report(`File is not valid UTF-8: ${errorMessage(error)}`);
    return { issues };
  }
  if (text.charCodeAt(0) === 0xfeff) {
    report("File starts with a byte order mark.");
    return { issues };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch (error) {
    report(`Invalid JSON: ${errorMessage(error)}`);
    return { issues };
  }

  if (typeof parsedJson === "object" && parsedJson !== null && !Array.isArray(parsedJson)) {
    const idHint: unknown = (parsedJson as Record<string, unknown>)["id"];
    if (typeof idHint === "string") {
      caseId = idHint;
    }
  }

  const parsed = corpusCaseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const all = parsed.error.issues;
    for (const issue of all.slice(0, MAX_SCHEMA_ISSUES_PER_FILE)) {
      report(`Schema: ${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`);
    }
    if (all.length > MAX_SCHEMA_ISSUES_PER_FILE) {
      report(`Schema: ${all.length - MAX_SCHEMA_ISSUES_PER_FILE} more issue(s) not shown.`);
    }
    return { issues };
  }

  const value = parsed.data;
  caseId = value.id;

  if (file !== `${value.id}.json`) {
    report(`File name must be "${value.id}.json".`);
  }

  let requestKey: string | undefined;
  try {
    if (value.lane === "harvested") {
      requestKey = `harvested:${canonicalScenarioJson(value.request, value.provider)}`;
      if (!caseIdMatchesScenario(value)) {
        report(
          `Case id does not match its request and replay provider config. Expected id to start with "${deriveHarvestedCaseId(value.request, value.provider)}".`,
        );
      }
    } else {
      requestKey = `${value.lane}:${canonicalJson(canonicalizeRequest(value.request))}`;
      if (!caseIdMatchesRequest(value)) {
        report(
          `Case id does not match its request. Expected id to start with "${deriveCaseId(value.lane, value.request)}".`,
        );
      }
    }
  } catch (error) {
    report(`Request cannot be canonicalized: ${errorMessage(error)}`);
  }

  try {
    if (canonicalJsonPretty(canonicalizeCase(parsedJson)) !== text) {
      report(
        "File is not in canonical form (key order, indentation, NFC or trailing newline). Regenerate it with the corpus canonicalizer instead of editing by hand.",
      );
    }
  } catch (error) {
    report(`Case cannot be canonicalized: ${errorMessage(error)}`);
  }

  for (const problem of checkFormattingRules(value)) {
    report(problem);
  }

  return {
    issues,
    value,
    ...(requestKey === undefined ? {} : { requestKey }),
  };
};

/**
 * Pure loader over in-memory files. Input order does not matter: files are
 * sorted first. Throws `CorpusLoadError` listing every issue.
 */
export const loadCorpusFiles = (files: readonly CorpusFileInput[]): LoadedCorpus => {
  const ordered = [...files].sort((left, right) => compareStrings(left.name, right.name));
  const issues: CorpusIssue[] = [];
  const loaded: LoadedCorpusCase[] = [];
  const idOwner = new Map<string, string>();
  const requestOwner = new Map<string, string>();

  for (const input of ordered) {
    const outcome = loadOne(input);
    issues.push(...outcome.issues);
    const { value } = outcome;
    if (value === undefined) {
      continue;
    }

    const earlierId = idOwner.get(value.id);
    if (earlierId !== undefined) {
      issues.push({
        file: input.name,
        caseId: value.id,
        message: `Duplicate case id, already used by ${earlierId}.`,
      });
    } else {
      idOwner.set(value.id, input.name);
    }

    if (outcome.requestKey !== undefined) {
      const earlierRequest = requestOwner.get(outcome.requestKey);
      if (earlierRequest !== undefined) {
        issues.push({
          file: input.name,
          caseId: value.id,
          message: `Duplicate canonical request in lane "${value.lane}"${
            value.lane === "harvested" ? " with the same replay provider config" : ""
          }, same as ${earlierRequest}.`,
        });
      } else {
        requestOwner.set(outcome.requestKey, input.name);
      }
    }

    loaded.push({
      file: input.name,
      caseId: value.id,
      lane: value.lane,
      executable: value.status !== "pending-approval",
      value: deepFreeze(value),
    });
  }

  if (issues.length > 0) {
    throw new CorpusLoadError(issues);
  }

  const executable: ExecutableCase[] = [];
  const pending: LoadedCorpusCase[] = [];
  for (const entry of loaded) {
    if (entry.executable) {
      executable.push(requireExecutable(entry));
    } else {
      pending.push(entry);
    }
  }
  return { cases: loaded, executable, pending };
};

/**
 * Narrow a loaded case to one that may be replayed. A pending-approval case is
 * refused, so it can never be executed as if a human had approved it.
 */
export const requireExecutable = (loaded: LoadedCorpusCase): ExecutableCase => {
  if (!loaded.executable || loaded.value.status === "pending-approval") {
    throw new Error(
      `Case ${loaded.caseId} is pending-approval and must not be executed as approved.`,
    );
  }
  if (loaded.value.expected === undefined || loaded.value.trace === undefined) {
    throw new Error(`Case ${loaded.caseId} has no stored expected/trace.`);
  }
  // Both fields were just checked, and the value is left untouched (frozen).
  return loaded as ExecutableCase;
};

/**
 * Every regular file in the directory, sorted by name. Dot files (`.DS_Store`
 * and friends) are ignored; anything else that is not a regular file is an
 * error, not a skip.
 */
export const readCorpusDirectory = (directory: string): CorpusFileInput[] => {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    compareStrings(left.name, right.name),
  );
  const files: CorpusFileInput[] = [];
  const issues: CorpusIssue[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (!entry.isFile()) {
      issues.push({
        file: entry.name,
        message: "Not a regular file. Directories and links are not allowed in the corpus.",
      });
      continue;
    }
    files.push({ name: entry.name, bytes: readFileSync(join(directory, entry.name)) });
  }
  if (issues.length > 0) {
    throw new CorpusLoadError(issues);
  }
  return files;
};

export const loadCorpus = (directory: string = CASES_DIRECTORY): LoadedCorpus =>
  loadCorpusFiles(readCorpusDirectory(directory));
