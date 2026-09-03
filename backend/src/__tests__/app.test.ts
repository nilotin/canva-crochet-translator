import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../translation/translator.js", () => ({
  translateBlocks: vi.fn(async () => [
    {
      id: "block-1",
      source: "Kulak",
      translated: "Ear",
      valid: true,
      errors: [],
      warnings: [],
    },
  ]),
}));
import { TokenVerificationError } from "@canva/app-middleware";
import { createBackendApp } from "../app.js";
import { MemoryCopyOperationStore } from "../canva/connect/copy_operation_store.js";
import { translateBlocks } from "../translation/translator.js";

const validBody = {
  designToken: "design-jwt",
  sourceLanguage: "tr",
  targetLanguage: "en",
  blocks: [
    {
      id: "block-1",
      text: "Kulak",
    },
  ],
};

const createVerifiedTargetStore = async () => {
  const store = new MemoryCopyOperationStore();

  await store.save({
    operationId: "22222222-2222-4222-8222-222222222222",
    userId: "user-1",
    sourceDesignId: "source-1",
    copiedDesignId: "target-1",
    targetLanguage: "en",
    sourceTitle: "Synthetic Pattern",
    editUrl: "https://example.invalid/edit",
    status: "copy_created",
    createdAt: new Date().toISOString(),
  });

  return store;
};

const deterministicRegistry = {
  findByFingerprint: vi.fn(async (fingerprint: string) =>
    fingerprint === "page-content-v1-known"
      ? {
          fingerprint,
          kind: "front_cover" as const,
          translations: {
            en: ["Private deterministic English"],
            es: ["Español determinista privado"],
          },
        }
      : undefined,
  ),
  listTemplateSummaries: vi.fn(async () => [
    {
      fingerprint: "page-content-v1-known",
      kind: "front_cover" as const,
      blockCounts: { en: 1, es: 1 },
    },
  ]),
  upsertTemplate: vi.fn(async () => undefined),
  replaceTemplateForKind: vi.fn(async () => undefined),
};

describe("/api/translate deterministic templates", () => {
  it("uses a private exact fingerprint match for a verified target copy", async () => {
    const store = await createVerifiedTargetStore();

    const app = createBackendApp({
      canvaTokenVerification: {
        verifyDesignToken: vi.fn(async () => ({
          appId: "app-1",
          designId: "target-1",
        })),
        verifyUserToken: vi.fn(async () => ({
          appId: "app-1",
          userId: "user-1",
          brandId: "brand-1",
        })),
      },
      canvaConnect: { store },
      deterministicTemplateRegistry: deterministicRegistry,
    });

    const response = await request(app)
      .post("/api/translate")
      .set("Authorization", "Bearer user-jwt")
      .send({
        ...validBody,
        templateCandidate: true,
        pageFingerprint: "page-content-v1-known",
      });

    expect(response.status).toBe(200);
    expect(response.body.translations).toEqual([
      {
        id: "block-1",
        source: "Kulak",
        translated: "Private deterministic English",
        valid: true,
        errors: [],
        warnings: [],
      },
    ]);
  });

  it("falls back to normal translation when the registry misses", async () => {
    const store = await createVerifiedTargetStore();

    const app = createBackendApp({
      canvaTokenVerification: {
        verifyDesignToken: vi.fn(async () => ({
          appId: "app-1",
          designId: "target-1",
        })),
        verifyUserToken: vi.fn(async () => ({
          appId: "app-1",
          userId: "user-1",
          brandId: "brand-1",
        })),
      },
      canvaConnect: { store },
      deterministicTemplateRegistry: deterministicRegistry,
    });

    const response = await request(app)
      .post("/api/translate")
      .set("Authorization", "Bearer user-jwt")
      .send({
        ...validBody,
        templateCandidate: true,
        pageFingerprint: "page-content-v1-unknown",
      });

    expect(response.status).toBe(200);
    expect(response.body.translations[0]?.translated).toBe("Ear");
  });

  it("does not expose private template content to an unregistered design", async () => {
    const store = await createVerifiedTargetStore();

    const app = createBackendApp({
      canvaTokenVerification: {
        verifyDesignToken: vi.fn(async () => ({
          appId: "app-1",
          designId: "unregistered-design",
        })),
        verifyUserToken: vi.fn(async () => ({
          appId: "app-1",
          userId: "user-1",
          brandId: "brand-1",
        })),
      },
      canvaConnect: { store },
      deterministicTemplateRegistry: deterministicRegistry,
    });

    const response = await request(app)
      .post("/api/translate")
      .set("Authorization", "Bearer user-jwt")
      .send({
        ...validBody,
        templateCandidate: true,
        pageFingerprint: "page-content-v1-known",
      });

    expect(response.status).toBe(200);
    expect(response.body.translations[0]?.translated).toBe("Ear");
  });

  it("includes safe targetFormattingRegions on a deterministic hit and never calls the provider", async () => {
    const store = await createVerifiedTargetStore();
    const formattingRegistry = {
      findByFingerprint: vi.fn(async (fingerprint: string) =>
        fingerprint === "page-content-v1-formatted"
          ? {
              fingerprint,
              kind: "front_cover" as const,
              translations: {
                en: ["Xxxxx, R, Yyyy"],
                es: ["Xxxxx, R, Yyyy"],
              },
            }
          : undefined,
      ),
      listTemplateSummaries: vi.fn(async () => []),
      upsertTemplate: vi.fn(async () => undefined),
      replaceTemplateForKind: vi.fn(async () => undefined),
    };

    const app = createBackendApp({
      canvaTokenVerification: {
        verifyDesignToken: vi.fn(async () => ({
          appId: "app-1",
          designId: "target-1",
        })),
        verifyUserToken: vi.fn(async () => ({
          appId: "app-1",
          userId: "user-1",
          brandId: "brand-1",
        })),
      },
      canvaConnect: { store },
      deterministicTemplateRegistry: formattingRegistry,
    });

    const callsBefore = vi.mocked(translateBlocks).mock.calls.length;

    const response = await request(app)
      .post("/api/translate")
      .set("Authorization", "Bearer user-jwt")
      .send({
        ...validBody,
        blocks: [
          {
            id: "block-1",
            text: "6x, v, 4x",
            formattingRegions: [
              { id: "fmt-0", start: 0, end: 4 },
              { id: "fmt-red", start: 4, end: 5 },
              { id: "fmt-2", start: 5, end: 9 },
            ],
          },
        ],
        templateCandidate: true,
        pageFingerprint: "page-content-v1-formatted",
      });

    expect(response.status).toBe(200);
    expect(response.body.translations).toEqual([
      {
        id: "block-1",
        source: "6x, v, 4x",
        translated: "Xxxxx, R, Yyyy",
        valid: true,
        errors: [],
        warnings: [],
        targetFormattingRegions: [
          { id: "fmt-0", start: 0, end: 5 },
          { id: "fmt-red", start: 5, end: 8 },
          { id: "fmt-2", start: 8, end: 13 },
        ],
      },
    ]);

    // Never invokes the LLM/provider for a deterministic hit.
    expect(vi.mocked(translateBlocks).mock.calls.length).toBe(callsBefore);
  });

  it("preserves source block order across multiple deterministic blocks", async () => {
    const store = await createVerifiedTargetStore();
    const orderedRegistry = {
      findByFingerprint: vi.fn(async (fingerprint: string) =>
        fingerprint === "page-content-v1-ordered"
          ? {
              fingerprint,
              kind: "materials_reference" as const,
              translations: {
                en: ["First", "Second", "Third"],
                es: ["Primero", "Segundo", "Tercero"],
              },
            }
          : undefined,
      ),
      listTemplateSummaries: vi.fn(async () => []),
      upsertTemplate: vi.fn(async () => undefined),
      replaceTemplateForKind: vi.fn(async () => undefined),
    };

    const app = createBackendApp({
      canvaTokenVerification: {
        verifyDesignToken: vi.fn(async () => ({
          appId: "app-1",
          designId: "target-1",
        })),
        verifyUserToken: vi.fn(async () => ({
          appId: "app-1",
          userId: "user-1",
          brandId: "brand-1",
        })),
      },
      canvaConnect: { store },
      deterministicTemplateRegistry: orderedRegistry,
    });

    const response = await request(app)
      .post("/api/translate")
      .set("Authorization", "Bearer user-jwt")
      .send({
        ...validBody,
        blocks: [
          { id: "b1", text: "Bir" },
          { id: "b2", text: "İki" },
          { id: "b3", text: "Üç" },
        ],
        templateCandidate: true,
        pageFingerprint: "page-content-v1-ordered",
      });

    expect(response.status).toBe(200);
    expect(
      response.body.translations.map(
        (translation: { id: string; translated: string }) => [
          translation.id,
          translation.translated,
        ],
      ),
    ).toEqual([
      ["b1", "First"],
      ["b2", "Second"],
      ["b3", "Third"],
    ]);
  });

  it("still falls back to normal translation when the block count does not match the registered translations", async () => {
    const store = await createVerifiedTargetStore();
    const mismatchRegistry = {
      findByFingerprint: vi.fn(async (fingerprint: string) =>
        fingerprint === "page-content-v1-mismatch"
          ? {
              fingerprint,
              kind: "closing" as const,
              translations: {
                en: ["Only one block registered"],
                es: ["Solo un bloque registrado"],
              },
            }
          : undefined,
      ),
      listTemplateSummaries: vi.fn(async () => []),
      upsertTemplate: vi.fn(async () => undefined),
      replaceTemplateForKind: vi.fn(async () => undefined),
    };

    const app = createBackendApp({
      canvaTokenVerification: {
        verifyDesignToken: vi.fn(async () => ({
          appId: "app-1",
          designId: "target-1",
        })),
        verifyUserToken: vi.fn(async () => ({
          appId: "app-1",
          userId: "user-1",
          brandId: "brand-1",
        })),
      },
      canvaConnect: { store },
      deterministicTemplateRegistry: mismatchRegistry,
    });

    const response = await request(app)
      .post("/api/translate")
      .set("Authorization", "Bearer user-jwt")
      .send({
        ...validBody,
        blocks: [
          { id: "b1", text: "Bir" },
          { id: "b2", text: "İki" },
        ],
        templateCandidate: true,
        pageFingerprint: "page-content-v1-mismatch",
      });

    expect(response.status).toBe(200);
    // Falls through to the normal (mocked) translator -- the deterministic
    // bypass never fires on a block-count mismatch.
    expect(response.body.translations[0]?.translated).toBe("Ear");
  });

  it("does not call the provider on a deterministic hit, and does call it on a normal translation", async () => {
    const store = await createVerifiedTargetStore();

    const app = createBackendApp({
      canvaTokenVerification: {
        verifyDesignToken: vi.fn(async () => ({
          appId: "app-1",
          designId: "target-1",
        })),
        verifyUserToken: vi.fn(async () => ({
          appId: "app-1",
          userId: "user-1",
          brandId: "brand-1",
        })),
      },
      canvaConnect: { store },
      deterministicTemplateRegistry: deterministicRegistry,
    });

    const callsBefore = vi.mocked(translateBlocks).mock.calls.length;

    await request(app)
      .post("/api/translate")
      .set("Authorization", "Bearer user-jwt")
      .send({
        ...validBody,
        templateCandidate: true,
        pageFingerprint: "page-content-v1-known",
      });

    expect(vi.mocked(translateBlocks).mock.calls.length).toBe(callsBefore);

    // A normal (non-template) request still goes through the provider path.
    await request(app)
      .post("/api/translate")
      .set("Authorization", "Bearer user-jwt")
      .send(validBody);

    expect(vi.mocked(translateBlocks).mock.calls.length).toBe(
      callsBefore + 1,
    );
  });
});

describe("/api/translate auth", () => {
  it("rejects requests without a Canva user bearer token", async () => {
    const app = createBackendApp({
      canvaTokenVerification: {
        verifyDesignToken: vi.fn(),
        verifyUserToken: vi.fn(),
      },
    });

    const response = await request(app).post("/api/translate").send(validBody);

    expect(response.status).toBe(401);
  });

  it("translates after both Canva tokens are verified", async () => {
    const verifyDesignToken = vi.fn(async () => ({
      appId: "app-1",
      designId: "design-1",
    }));

    const verifyUserToken = vi.fn(async () => ({
      appId: "app-1",
      userId: "user-1",
      brandId: "brand-1",
    }));

    const app = createBackendApp({
      canvaTokenVerification: {
        verifyDesignToken,
        verifyUserToken,
      },
    });

    const response = await request(app)
      .post("/api/translate")
      .set("Authorization", "Bearer user-jwt")
      .send(validBody);

    expect(response.status).toBe(200);
    expect(verifyDesignToken).toHaveBeenCalledWith("design-jwt");
    expect(verifyUserToken).toHaveBeenCalledWith("user-jwt");
    expect(response.body).toMatchObject({
      translations: [
        {
          id: "block-1",
          translated: "Ear",
        },
      ],
    });
  });

  it("rate limits repeated translation requests", async () => {
    const previousLimit = process.env.TRANSLATE_RATE_LIMIT_MAX;
    process.env.TRANSLATE_RATE_LIMIT_MAX = "2";

    try {
      const app = createBackendApp({
        canvaTokenVerification: {
          verifyDesignToken: vi.fn(async () => ({
            appId: "app-1",
            designId: "design-1",
          })),
          verifyUserToken: vi.fn(async () => ({
            appId: "app-1",
            userId: "user-1",
            brandId: "brand-1",
          })),
        },
      });

      const send = () =>
        request(app)
          .post("/api/translate")
          .set("Authorization", "Bearer user-jwt")
          .send(validBody);

      expect((await send()).status).toBe(200);
      expect((await send()).status).toBe(200);

      const limited = await send();

      expect(limited.status).toBe(429);
      expect(limited.body).toMatchObject({
        error: "Too many translation requests.",
      });
    } finally {
      if (previousLimit === undefined) {
        delete process.env.TRANSLATE_RATE_LIMIT_MAX;
      } else {
        process.env.TRANSLATE_RATE_LIMIT_MAX = previousLimit;
      }
    }
  });

  it("rejects invalid Canva tokens", async () => {
    const app = createBackendApp({
      canvaTokenVerification: {
        verifyDesignToken: vi
          .fn()
          .mockRejectedValue(
            new TokenVerificationError("invalid", "TOKEN_INVALID", 401),
          ),
        verifyUserToken: vi.fn(),
      },
    });

    const response = await request(app)
      .post("/api/translate")
      .set("Authorization", "Bearer user-jwt")
      .send(validBody);

    expect(response.status).toBe(401);
  });
});

describe("/api/translate content kind", () => {
  it("threads materials contentKind into the translator", async () => {
    const app = createBackendApp({
      canvaTokenVerification: {
        verifyDesignToken: vi.fn(async () => ({
          appId: "app-1",
          designId: "design-1",
        })),
        verifyUserToken: vi.fn(async () => ({
          appId: "app-1",
          userId: "user-1",
          brandId: "brand-1",
        })),
      },
    });

    const callsBefore = vi.mocked(translateBlocks).mock.calls.length;

    const response = await request(app)
      .post("/api/translate")
      .set("Authorization", "Bearer user-jwt")
      .send({
        ...validBody,
        contentKind: "materials",
      });

    expect(response.status).toBe(200);

    const call = vi.mocked(translateBlocks).mock.calls[callsBefore];
    expect(call).toEqual([
      validBody.blocks,
      "en",
      { contentKind: "materials" },
    ]);
  });
});
