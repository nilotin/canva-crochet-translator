/**
 * Stage 0 capture configuration. Used only when passed explicitly:
 *
 *   npx vitest run --config vitest.capture.config.ts
 *
 * Vitest never discovers this file on its own (its name is not
 * `vitest.config.*` / `vite.config.*`), so `npm test` is unaffected.
 *
 * Runs the existing tests that reach `translateBlocks` through the capture
 * wrapper installed by `capture_setup.ts`. The list is explicit, not a glob:
 * it is every test file that imports the real `translateBlocks` (verified by
 * searching `src` for the symbol). Other files (provider unit tests,
 * normalizer/validator unit tests, the frontend, `app.test.ts` which mocks the
 * translator itself, and the corpus tests) are deliberately not run here.
 *
 * Provider credentials are blanked for the run as an extra guard; the setup
 * file also makes provider creation and `fetch` throw.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export const CAPTURE_TEST_FILES = [
  "src/translation/__tests__/translator.test.ts",
  "src/translation/natural_language/__tests__/round_references.test.ts",
  "src/translation/__tests__/measurements.test.ts",
];

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    include: CAPTURE_TEST_FILES,
    setupFiles: ["./capture_setup.ts"],
    env: {
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "",
    },
  },
});
