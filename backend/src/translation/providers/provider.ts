import type { TargetLanguage, TranslationBlock } from "../types.js";

export type TranslationProviderRequest = {
  targetLanguage: TargetLanguage;
  blocks: readonly TranslationBlock[];
  systemPrompt: string;
  userPrompt: string;
};

export type TranslationProviderResult = {
  translations: { id: string; translated: string }[];
};

export type TranslationProviderErrorCode =
  | "CONFIGURATION_ERROR"
  | "INVALID_RESPONSE"
  | "PROVIDER_ERROR";

export class TranslationProviderError extends Error {
  constructor(
    public readonly code: TranslationProviderErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TranslationProviderError";
  }
}

export type ProviderReadiness =
  | { ok: true; provider: string; model: string }
  | {
      ok: false;
      provider: string;
      model: string;
      error: { code: TranslationProviderErrorCode; message: string };
    };

export interface TranslationProvider {
  readonly name: string;
  readonly model: string;
  translate(
    request: TranslationProviderRequest,
  ): Promise<TranslationProviderResult>;
  checkReadiness(): Promise<ProviderReadiness>;
}
