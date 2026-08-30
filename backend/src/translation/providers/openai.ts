import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { modelTranslationSchema } from "../types.js";
import {
  TranslationProviderError,
  type ProviderReadiness,
  type TranslationProvider,
  type TranslationProviderRequest,
  type TranslationProviderResult,
} from "./provider.js";

type ResponsesClient = Pick<OpenAI, "responses">;

export type OpenAIProviderOptions = {
  apiKey: string;
  model: string;
  client?: ResponsesClient;
};

export class OpenAITranslationProvider implements TranslationProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly client: ResponsesClient;

  constructor(options: OpenAIProviderOptions) {
    this.model = options.model;
    this.client = options.client ?? new OpenAI({ apiKey: options.apiKey });
  }

  async translate(
    request: TranslationProviderRequest,
  ): Promise<TranslationProviderResult> {
    try {
      const response = await this.client.responses.parse({
        model: this.model,
        reasoning: { effort: "none" },
        input: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt },
        ],
        text: {
          format: zodTextFormat(modelTranslationSchema, "crochet_translations"),
        },
      });

      const parsed = modelTranslationSchema.safeParse(response.output_parsed);
      if (!parsed.success) {
        throw new TranslationProviderError(
          "INVALID_RESPONSE",
          "OpenAI returned an invalid structured translation response.",
          { cause: parsed.error },
        );
      }
      return parsed.data;
    } catch (cause) {
      if (cause instanceof TranslationProviderError) throw cause;
      const diagnostic =
        cause instanceof OpenAI.APIError
          ? `OpenAI translation request failed with status ${cause.status}${cause.code ? ` (${cause.code})` : ""}.`
          : "OpenAI translation request failed.";
      throw new TranslationProviderError("PROVIDER_ERROR", diagnostic, {
        cause,
      });
    }
  }

  async checkReadiness(): Promise<ProviderReadiness> {
    return { ok: true, provider: this.name, model: this.model };
  }
}
