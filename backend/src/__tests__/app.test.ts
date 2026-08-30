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
