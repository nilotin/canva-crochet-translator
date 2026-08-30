import { describe, expect, it, vi } from "vitest";
import { CanvaCopyOperations } from "../connect/copy_operations.js";
import { resolveTargetContext } from "../target_context.js";
import type { CanvaTokenVerificationService } from "../token_verification.js";

const verification = (
  designId: string,
  userId = "user-1",
): CanvaTokenVerificationService => ({
  verifyDesignToken: vi.fn().mockResolvedValue({ designId, appId: "app" }),
  verifyUserToken: vi
    .fn()
    .mockResolvedValue({ userId, brandId: "brand", appId: "app" }),
});

const recognize = (
  operations: CanvaCopyOperations,
  designId: string,
  userId = "user-1",
) =>
  resolveTargetContext(
    verification(designId, userId),
    operations.store,
    { designToken: "design-token" },
    "Bearer user-token",
  );

describe("translation target context", () => {
  it.each(["en", "es"] as const)(
    "recognizes a copied design as an %s target",
    async (language) => {
      const operations = new CanvaCopyOperations({
        copyEntireDesign: vi.fn().mockResolvedValue({
          copiedDesignId: `copy-${language}`,
          editUrl: "https://www.canva.com/edit",
        }),
      });
      await operations.create({
        designId: "source",
        userId: "user-1",
        language,
        sourceTitle: "Masal Doll Turkish",
      });
      const result = await recognize(operations, `copy-${language}`);
      expect(result).toMatchObject({
        status: 200,
        body: {
          isTranslationTarget: true,
          language,
          sourceTitle: "Masal Doll Turkish",
          contextId: expect.any(String),
        },
      });
      expect(JSON.stringify(result.body)).not.toContain("sourceDesignId");
      expect(JSON.stringify(result.body)).not.toContain(`copy-${language}`);
    },
  );

  it("does not recognize unrelated, source, or another user's designs", async () => {
    const operations = new CanvaCopyOperations({
      copyEntireDesign: vi.fn().mockResolvedValue({
        copiedDesignId: "copy",
        editUrl: "https://www.canva.com/edit",
      }),
    });
    await operations.create({
      designId: "source",
      userId: "user-1",
      language: "en",
    });
    expect((await recognize(operations, "unrelated")).body).toEqual({
      isTranslationTarget: false,
    });
    expect((await recognize(operations, "source")).body).toEqual({
      isTranslationTarget: false,
    });
    expect((await recognize(operations, "copy", "user-2")).body).toEqual({
      isTranslationTarget: false,
    });
  });
});
