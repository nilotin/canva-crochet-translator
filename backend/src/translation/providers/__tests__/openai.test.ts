import { describe, expect, it, vi } from "vitest";
import { OpenAITranslationProvider } from "../openai.js";
import { TranslationProviderError } from "../provider.js";

const request = {
  targetLanguage: "en" as const,
  blocks: [{ id: "one", text: "Translate this." }],
  systemPrompt: "Translate safely.",
  userPrompt: "{}",
};

const providerWithParse = (parse: ReturnType<typeof vi.fn>) =>
  new OpenAITranslationProvider({
    apiKey: "test-secret-key",
    model: "gpt-5.4-mini",
    client: { responses: { parse } } as never,
  });

describe("OpenAITranslationProvider", () => {
  it("returns a valid structured Responses API result", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        translations: [{ id: "one", translated: "Translated." }],
      },
    });
    const provider = providerWithParse(parse);

    await expect(provider.translate(request)).resolves.toEqual({
      translations: [{ id: "one", translated: "Translated." }],
    });
    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.4-mini",
        reasoning: { effort: "none" },
        text: { format: expect.any(Object) },
      }),
    );
  });

  it("rejects malformed or unparseable structured output", async () => {
    const provider = providerWithParse(
      vi.fn().mockResolvedValue({ output_parsed: { translations: "invalid" } }),
    );

    await expect(provider.translate(request)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    } satisfies Partial<TranslationProviderError>);
  });

  it("wraps provider failures without exposing secret content", async () => {
    const provider = providerWithParse(
      vi.fn().mockRejectedValue(new Error("upstream failed")),
    );

    await expect(provider.translate(request)).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      message: "OpenAI translation request failed.",
    } satisfies Partial<TranslationProviderError>);
  });

  it("reports readiness without exposing the API key", async () => {
    const provider = providerWithParse(vi.fn());
    const readiness = await provider.checkReadiness();

    expect(readiness).toEqual({
      ok: true,
      provider: "openai",
      model: "gpt-5.4-mini",
    });
    expect(JSON.stringify(readiness)).not.toContain("test-secret-key");
  });
});
