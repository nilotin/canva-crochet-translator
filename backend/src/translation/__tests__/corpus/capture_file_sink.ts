/**
 * Worker-safe JSONL sink for capture records (test support only, Stage 0 Step 6).
 *
 * Vitest may run test files in parallel processes or threads. Appending from
 * several workers to one file is not safe, so every writer owns its file:
 *
 *   raw-<pid>-<workerId>-<hash10 of test file>.jsonl
 *
 * Within one Vitest run a test file is executed once, by one worker, so no two
 * writers ever share a name. The first write to a name uses the exclusive flag
 * ("wx"): if the file already exists the run is not starting from a clean
 * capture directory (or a pid was reused), and the sink stops with a clear
 * message instead of mixing two runs. Clearing the directory is the operator's
 * explicit first step.
 *
 * The capture directory is made self-ignoring with a `.gitignore` containing
 * `*`, so captured records never show up in `git status` and no tracked
 * ignore file has to change.
 *
 * Import rules: node:fs, node:path and `./canonicalize.js`, `./capture_record.js`
 * (type only). No clocks, no randomness.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "./canonicalize.js";
import type { CaptureRecord } from "./capture_record.js";
import type { CaptureSink } from "./capture_runtime.js";

export const CAPTURE_DIRECTORY_NAME = ".corpus-capture";

/** Creates `<captureDirectory>/raw` and a self-ignoring `.gitignore`. Idempotent and race-safe. */
export const ensureCaptureDirectory = (captureDirectory: string): string => {
  const rawDirectory = join(captureDirectory, "raw");
  mkdirSync(rawDirectory, { recursive: true });
  try {
    writeFileSync(join(captureDirectory, ".gitignore"), "*\n", { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
  return rawDirectory;
};

export const rawFileName = (
  pid: number,
  workerId: string,
  testFile: string | null,
): string =>
  `raw-${pid}-${workerId.replace(/[^A-Za-z0-9_-]/g, "_")}-${sha256Hex(testFile ?? "unknown").slice(0, 10)}.jsonl`;

export const createFileSink = (options: {
  captureDirectory: string;
}): CaptureSink => {
  const opened = new Set<string>();
  return {
    emit(record: CaptureRecord): void {
      const rawDirectory = ensureCaptureDirectory(options.captureDirectory);
      const name = rawFileName(record.debug.pid, record.debug.workerId, record.origin.file);
      const path = join(rawDirectory, name);
      const line = `${JSON.stringify(record)}\n`;
      if (opened.has(name)) {
        appendFileSync(path, line);
        return;
      }
      try {
        writeFileSync(path, line, { flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error(
            `${path} already exists. The capture directory must be cleared before a capture run.`,
            { cause: error },
          );
        }
        throw error;
      }
      opened.add(name);
    },
  };
};
