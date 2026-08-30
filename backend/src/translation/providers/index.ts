import { z } from "zod";
import { OpenAITranslationProvider } from "./openai.js";
import {
  TranslationProviderError,
  type TranslationProvider,
} from "./provider.js";

const providerEnvironmentSchema = z.object({
  TRANSLATION_PROVIDER: z.literal("openai").default("openai"),
  OPENAI_API_KEY: z.string().trim().min(1, "OPENAI_API_KEY is required."),
  OPENAI_MODEL: z.string().trim().min(1, "OPENAI_MODEL is required."),
});

export const createTranslationProvider = (
  environment: NodeJS.ProcessEnv = process.env,
): TranslationProvider => {
  const parsed = providerEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(" ");
    throw new TranslationProviderError("CONFIGURATION_ERROR", message);
  }

  return new OpenAITranslationProvider({
    apiKey: parsed.data.OPENAI_API_KEY,
    model: parsed.data.OPENAI_MODEL,
  });
};

export type {
  ProviderReadiness,
  TranslationProvider,
  TranslationProviderRequest,
  TranslationProviderResult,
} from "./provider.js";
export { TranslationProviderError } from "./provider.js";
