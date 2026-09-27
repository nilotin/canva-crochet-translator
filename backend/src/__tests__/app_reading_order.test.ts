/**
 * `/api/translate` with optional `readingOrder` metadata (next stage, Task 10).
 *
 * The metadata never changes routing: the deterministic template bypass still
 * aligns registered translations by ARRAY index, malformed values never fail
 * a request, and the translator receives the blocks in the array order.
 */
import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../translation/translator.js", () => ({
  translateBlocks: vi.fn(async (blocks: { id: string; text: string }[]) =>
    blocks.map(({ id, text }) => ({
      id,
      source: text,
      translated: `${text}-en`,
      valid: true,
      errors: [],
      warnings: [],
    })),
  ),
}));
import { createBackendApp } from "../app.js";
import { MemoryCopyOperationStore } from "../canva/connect/copy_operation_store.js";
import { translateBlocks } from "../translation/translator.js";

const verification = {
  verifyDesignToken: vi.fn(async () => ({ appId: "app-1", designId: "target-1" })),
  verifyUserToken: vi.fn(async () => ({ appId: "app-1", userId: "user-1", brandId: "brand-1" })),
};

const verifiedStore = async () => {
  const store = new MemoryCopyOperationStore();
  await store.save({
    operationId: "33333333-3333-4333-8333-333333333333",
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

const registry = {
  findByFingerprint: vi.fn(async (fingerprint: string) =>
    fingerprint === "page-content-v1-ordered"
      ? {
          fingerprint,
          kind: "materials_reference" as const,
          translations: { en: ["First", "Second", "Third"], es: ["Primero", "Segundo", "Tercero"] },
        }
      : undefined,
  ),
  listTemplateSummaries: vi.fn(async () => []),
  upsertTemplate: vi.fn(async () => undefined),
  replaceTemplateForKind: vi.fn(async () => undefined),
};

const body = (blocks: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({
  designToken: "design-jwt",
  sourceLanguage: "tr",
  targetLanguage: "en",
  blocks,
  ...extra,
});

describe("/api/translate readingOrder metadata", () => {
  it("keeps the deterministic bypass aligned by array index when readingOrder is reversed", async () => {
    const app = createBackendApp({
      canvaTokenVerification: verification,
      canvaConnect: { store: await verifiedStore() },
      deterministicTemplateRegistry: registry,
    });

    const response = await request(app)
      .post("/api/translate")
      .set("Authorization", "Bearer user-jwt")
      .send(
        body(
          [
            { id: "b1", text: "Bir", readingOrder: 2 },
            { id: "b2", text: "İki", readingOrder: 1 },
            { id: "b3", text: "Üç", readingOrder: 0 },
          ],
          { templateCandidate: true, pageFingerprint: "page-content-v1-ordered" },
        ),
      );

    expect(response.status).toBe(200);
    expect(
      response.body.translations.map(({ id, translated }: { id: string; translated: string }) => [id, translated]),
    ).toEqual([
      ["b1", "First"],
      ["b2", "Second"],
      ["b3", "Third"],
    ]);
  });

  it.each([
    ["reversed", [2, 1, 0]],
    ["malformed", [-1, "x", 1.5]],
    ["duplicated", [0, 0, 0]],
    ["partial", [0, undefined, 2]],
  ])("passes %s readingOrder through without rejecting or reordering", async (_label, orders) => {
    vi.mocked(translateBlocks).mockClear();
    const app = createBackendApp({ canvaTokenVerification: verification });
    const blocks = ["Bir", "İki", "Üç"].map((text, index) => ({
      id: `b${index + 1}`,
      text,
      ...(orders[index] === undefined ? {} : { readingOrder: orders[index] }),
    }));

    const response = await request(app).post("/api/translate").set("Authorization", "Bearer user-jwt").send(body(blocks));

    expect(response.status).toBe(200);
    expect(response.body.translations.map(({ id }: { id: string }) => id)).toEqual(["b1", "b2", "b3"]);
    const [received] = vi.mocked(translateBlocks).mock.calls[0]!;
    expect(received.map(({ id }) => id)).toEqual(["b1", "b2", "b3"]);
  });

  it("returns response entries without any readingOrder field", async () => {
    const app = createBackendApp({ canvaTokenVerification: verification });
    const response = await request(app)
      .post("/api/translate")
      .set("Authorization", "Bearer user-jwt")
      .send(body([{ id: "b1", text: "Bir", readingOrder: 0 }]));

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain("readingOrder");
  });
});
