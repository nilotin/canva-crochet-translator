import "dotenv/config";
import { translateBlocks } from "./translator.js";
import {
  createTranslationProvider,
  TranslationProviderError,
} from "./providers/index.js";
import type { TargetLanguage, TranslationBlock } from "./types.js";

const QA_EXAMPLES = [
  "1. 6x ile sh oluşturuyoruz.",
  "2. Her ilmeğe v yapıyoruz. (12x)",
  "3. (1x, v) x 6",
  "Kaş — 4x uzunluğunda, aralarında 9x kalacak şekilde, gözden 4 sıra üzerinden işliyoruz.",
  "55 zn çekiyoruz. Birinci çiçeğin altından görselde görüldüğü gibi CC ile sabitliyoruz. 2 zn çekip, sabitlediğimiz yerin tam karşısından bir kez daha CC ile sabitliyoruz.",
  "İpi arkada uzun bir şekilde bırakarak, arkadan giriş yapıyoruz. Ön tarafta gözün üst iç kısmından çıkıyoruz. Sonra yine ön taraftan gözün alt iç kısmından giriş yapıyoruz.",
  "FLO örüyoruz.",
  "BLO örüyoruz.",
  "6x, v, 6x, CC",
  "hdcv, dcv, dce, escv",
  "esc, escv, escw",
] as const;

try {
  const provider = createTranslationProvider();
  const readiness = await provider.checkReadiness();
  if (!readiness.ok) {
    throw new TranslationProviderError(
      readiness.error.code,
      readiness.error.message,
    );
  }

  for (const targetLanguage of ["en", "es"] satisfies TargetLanguage[]) {
    const blocks: TranslationBlock[] = QA_EXAMPLES.map((text, index) => ({
      id: `qa-${index + 1}`,
      text,
    }));
    const results = await translateBlocks(blocks, targetLanguage, { provider });

    for (const result of results) {
      console.log("SOURCE");
      console.log(result.source);
      console.log("TARGET LANGUAGE");
      console.log(targetLanguage);
      console.log("TRANSLATION");
      console.log(result.translated);
      console.log("VALIDATION RESULT");
      console.log(
        result.valid ? "VALID" : JSON.stringify(result.errors, null, 2),
      );
      console.log("WARNINGS");
      console.log(JSON.stringify(result.warnings, null, 2));
      console.log("");
    }
  }
} catch (cause) {
  const message = cause instanceof Error ? cause.message : "Unknown error";
  console.error(`Live translation QA could not start: ${message}`);
  console.error(
    "No QA output was accepted. Configure OPENAI_API_KEY and OPENAI_MODEL locally, then check GET /health/translation.",
  );
  process.exitCode = 1;
}
