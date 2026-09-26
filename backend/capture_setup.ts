/**
 * Stage 0 capture setup. Loaded ONLY by `vitest.capture.config.ts`
 * (`setupFiles`); the normal Vitest run never reads this file.
 *
 * It intercepts the public seam, `translateBlocks`, for every test file that
 * runs under the capture config, WITHOUT editing any test: `vi.mock` in a setup
 * file applies to every test file, and the mock resolves by module id, so all
 * existing spellings of the import (`../translator.js`, `../../translator.js`,
 * `./translation/translator.js`) reach the same wrapper.
 *
 * What the wrapper does is in
 * `src/translation/__tests__/corpus/capture_runtime.ts`. This file only wires:
 *  - the real `translateBlocks` (via `importOriginal`) into the wrapper;
 *  - a per-worker JSONL sink under `backend/.corpus-capture/raw/`;
 *  - the current test file and full test name, read from Vitest's own
 *    `expect.getState()` (`testPath`, `currentTestName`). If Vitest does not
 *    provide either, the record says null. Names are never invented.
 *
 * Safety, all in capture mode only:
 *  - `createTranslationProvider` (the environment-backed provider factory) is
 *    replaced by a function that throws, so no real provider can be built and
 *    no credential is read;
 *  - `fetch` is replaced by a function that throws;
 *  - a `translateBlocks` call without a provider is refused and recorded.
 *
 * Nothing under `src` is modified, and this file sits outside `src`, so
 * `npm test`, `npm run lint` and `npm run typecheck` do not see it.
 */
import { vi } from "vitest";

vi.stubGlobal("fetch", () => {
  throw new Error("corpus capture guard: network access attempted through fetch.");
});

vi.mock("./src/translation/providers/index.js", () => ({
  createTranslationProvider: () => {
    throw new Error(
      "corpus capture guard: createTranslationProvider was called. Capture never builds a real provider.",
    );
  },
}));

vi.mock("./src/translation/translator.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./src/translation/translator.js")>();
  const { expect } = await import("vitest");
  const { dirname, join, relative, sep } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { createCapturingTranslateBlocks } = await import(
    "./src/translation/__tests__/corpus/capture_runtime.js"
  );
  const { CAPTURE_DIRECTORY_NAME, createFileSink } = await import(
    "./src/translation/__tests__/corpus/capture_file_sink.js"
  );

  const backendRoot = dirname(fileURLToPath(import.meta.url));

  return {
    ...original,
    translateBlocks: createCapturingTranslateBlocks(original.translateBlocks, {
      sink: createFileSink({
        captureDirectory: join(backendRoot, CAPTURE_DIRECTORY_NAME),
      }),
      currentOrigin: () => {
        const state = expect.getState();
        return {
          file:
            state.testPath === undefined
              ? null
              : relative(backendRoot, state.testPath).split(sep).join("/"),
          testName: state.currentTestName ?? null,
        };
      },
      processInfo: () => ({
        pid: process.pid,
        workerId:
          process.env["VITEST_WORKER_ID"] ?? process.env["VITEST_POOL_ID"] ?? "0",
      }),
    }),
  };
});
