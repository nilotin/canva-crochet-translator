/**
 * Merge raw capture records into review candidates (Stage 0, Step 6).
 *
 *   npx tsx scripts/corpus_capture_merge.ts [--raw <dir>] [--out <dir>] [--no-verify]
 *
 * Reads   backend/.corpus-capture/raw/*.jsonl
 * Writes  backend/.corpus-capture/merged/   (candidates/, needs-review/,
 *                                            conflicts/, summary.json)
 *
 * It NEVER writes to `src/translation/__tests__/corpus/cases/`. Both
 * directories must be inside `.corpus-capture/`, and the output directory is
 * cleared first (only after that check), so a rerun replaces its own previous
 * output and nothing else. Scenarios (request + replay provider config) already
 * committed in the harvested lane are skipped, never overwritten.
 *
 * By default every candidate is replayed through the real `translateBlocks`
 * with a recording double (no network, no environment) and only candidates
 * that reproduce their capture count as replayable. `--no-verify` skips that.
 *
 * Exit status: 1 for unreadable input, an empty capture, or a broken
 * committed corpus; 0 otherwise (conflicts and needs-review are reported, not
 * errors).
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalScenarioJson,
  compareStrings,
} from "../src/translation/__tests__/corpus/canonicalize.js";
import {
  CaptureInputError,
  formatSummary,
  mergeCapture,
  type RawCaptureFile,
} from "../src/translation/__tests__/corpus/capture_merge.js";
import { CAPTURE_DIRECTORY_NAME } from "../src/translation/__tests__/corpus/capture_file_sink.js";
import { verifyCandidate } from "../src/translation/__tests__/corpus/capture_verify.js";
import { loadCorpus } from "../src/translation/__tests__/corpus/load_corpus.js";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const captureRoot = join(backendRoot, CAPTURE_DIRECTORY_NAME);

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const argValue = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

const insideCaptureRoot = (path: string): boolean => {
  const relation = relative(captureRoot, path);
  return relation !== "" && !relation.startsWith("..") && !relation.startsWith(sep);
};

const rawDirectory = resolve(argValue("--raw") ?? join(captureRoot, "raw"));
const outDirectory = resolve(argValue("--out") ?? join(captureRoot, "merged"));
const verify = !process.argv.includes("--no-verify");

if (!insideCaptureRoot(rawDirectory) || !insideCaptureRoot(outDirectory)) {
  fail(`--raw and --out must be inside ${captureRoot}. Refusing to read or write anywhere else.`);
}
if (outDirectory === rawDirectory || rawDirectory.startsWith(`${outDirectory}${sep}`)) {
  fail("--out must not contain the raw directory.");
}

const readRawFiles = (): RawCaptureFile[] => {
  let names: string[];
  try {
    names = readdirSync(rawDirectory).sort(compareStrings);
  } catch {
    return fail(`No raw capture directory at ${rawDirectory}. Run the capture first.`);
  }
  const files: RawCaptureFile[] = [];
  for (const name of names) {
    if (name.startsWith(".")) {
      continue;
    }
    if (!name.endsWith(".jsonl")) {
      fail(`Unexpected file in the raw capture directory: ${name}`);
    }
    files.push({ name, text: readFileSync(join(rawDirectory, name), "utf8") });
  }
  return files;
};

const main = async (): Promise<void> => {
  const files = readRawFiles();
  if (files.length === 0) {
    fail(
      "There are no raw capture files. Either the capture did not run or the interception is not active " +
        "(no translateBlocks call reached the wrapper).",
    );
  }

  let committedHarvestedScenarios: Set<string>;
  try {
    committedHarvestedScenarios = new Set(
      loadCorpus()
        .cases.filter((entry) => entry.lane === "harvested")
        .map((entry) => canonicalScenarioJson(entry.value.request, entry.value.provider)),
    );
  } catch (error) {
    return fail(`The committed corpus does not load, so nothing can be merged safely:\n${(error as Error).message}`);
  }

  let verifyOption: Parameters<typeof mergeCapture>[1] = { committedHarvestedScenarios };
  if (verify) {
    // Belt and braces: verification always supplies its own provider, and any
    // stray network use fails loudly.
    globalThis.fetch = () => {
      throw new Error("corpus capture merge: network access attempted through fetch.");
    };
    const { translateBlocks } = await import("../src/translation/translator.js");
    verifyOption = {
      committedHarvestedScenarios,
      verify: (candidate) => verifyCandidate(translateBlocks, candidate),
    };
  }

  let output;
  try {
    output = await mergeCapture(files, verifyOption);
  } catch (error) {
    if (error instanceof CaptureInputError) {
      return fail(error.message);
    }
    throw error;
  }

  if (output.summary.rawRecords === 0) {
    fail("The raw capture files contain no records. The interception is not active.");
  }

  rmSync(outDirectory, { recursive: true, force: true });
  for (const file of output.files) {
    const path = join(outDirectory, ...file.path.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.content);
  }

  process.stdout.write(formatSummary(output.summary));
  process.stdout.write(`verification against the real pipeline: ${verify ? "on" : "off"}\n`);
  process.stdout.write(`wrote ${output.files.length} file(s) under ${outDirectory}\n`);
  process.stdout.write("committed corpus cases were not touched.\n");
};

await main();
