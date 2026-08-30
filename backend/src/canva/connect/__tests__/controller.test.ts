import { TokenInvalidError } from "@canva/app-middleware";
import { describe, expect, it, vi } from "vitest";
import type { CanvaTokenVerificationService } from "../../token_verification.js";
import { copyDesign } from "../controller.js";
import { CanvaConnectApiError } from "../client.js";
import { CanvaCopyOperations } from "../copy_operations.js";

const verification = (): CanvaTokenVerificationService => ({
  verifyDesignToken: vi
    .fn()
    .mockResolvedValue({ designId: "trusted-design", appId: "app" }),
  verifyUserToken: vi.fn().mockResolvedValue({
    userId: "trusted-user",
    brandId: "brand",
    appId: "app",
  }),
});

describe("copy controller", () => {
  it.each(["en", "es"] as const)(
    "allows a verified %s copy and derives the source identity",
    async (targetLanguage) => {
      const copyEntireDesign = vi.fn().mockResolvedValue({
        copiedDesignId: `copy-${targetLanguage}`,
        editUrl: `https://www.canva.com/${targetLanguage}`,
      });
      const result = await copyDesign(
        {
          tokenVerification: verification(),
          operations: new CanvaCopyOperations({ copyEntireDesign }),
        },
        { designToken: "signed-design", targetLanguage, sourceTitle: "Source" },
        "Bearer signed-user",
      );
      expect(result.status).toBe(200);
      expect(copyEntireDesign).toHaveBeenCalledWith(
        "trusted-design",
        "trusted-user",
      );
      expect(JSON.stringify(result.body)).not.toContain("signed-");
    },
  );

  it("blocks unverified requests before copying", async () => {
    const service = verification();
    vi.mocked(service.verifyDesignToken).mockRejectedValue(
      new TokenInvalidError("invalid"),
    );
    const copyEntireDesign = vi.fn();
    const result = await copyDesign(
      {
        tokenVerification: service,
        operations: new CanvaCopyOperations({ copyEntireDesign }),
      },
      { designToken: "bad", targetLanguage: "en" },
      "Bearer bad-user",
    );
    expect(result.status).toBe(401);
    expect(copyEntireDesign).not.toHaveBeenCalled();
  });

  it("rejects attempts to override the verified source design ID", async () => {
    const copyEntireDesign = vi.fn();
    const result = await copyDesign(
      {
        tokenVerification: verification(),
        operations: new CanvaCopyOperations({ copyEntireDesign }),
      },
      {
        designToken: "signed",
        targetLanguage: "en",
        sourceDesignId: "attacker-design",
      },
      "Bearer user",
    );
    expect(result.status).toBe(400);
    expect(copyEntireDesign).not.toHaveBeenCalled();
  });

  it("reuses successful per-language operations and retries failures", async () => {
    const copier = {
      copyEntireDesign: vi.fn().mockResolvedValue({
        copiedDesignId: "one",
        editUrl: "https://www.canva.com/one",
      }),
      getDesign: vi.fn().mockResolvedValue({
        copiedDesignId: "one",
        editUrl: "https://www.canva.com/one-fresh",
      }),
    };
    const operations = new CanvaCopyOperations(copier);
    const input = {
      designId: "d",
      userId: "u",
      language: "en" as const,
      sourceTitle: "Source",
    };
    expect((await operations.create(input)).reused).toBe(false);
    expect((await operations.create(input)).reused).toBe(true);
    expect(copier.copyEntireDesign).toHaveBeenCalledTimes(1);
    expect(copier.getDesign).toHaveBeenCalledTimes(1);
  });

  it("recreates a persisted copy only when Canva confirms it was deleted", async () => {
    const copyEntireDesign = vi
      .fn()
      .mockResolvedValueOnce({
        copiedDesignId: "deleted-copy",
        editUrl: "https://www.canva.com/deleted-copy",
      })
      .mockResolvedValueOnce({
        copiedDesignId: "replacement-copy",
        editUrl: "https://www.canva.com/replacement-copy",
      });

    const getDesign = vi
      .fn()
      .mockRejectedValueOnce(new CanvaConnectApiError("SOURCE_NOT_FOUND", 404))
      .mockResolvedValueOnce({
        copiedDesignId: "replacement-copy",
        editUrl: "https://www.canva.com/replacement-copy-fresh",
      });

    const operations = new CanvaCopyOperations({
      copyEntireDesign,
      getDesign,
    });

    const input = {
      designId: "source",
      userId: "user",
      language: "en" as const,
      sourceTitle: "Source",
    };

    await expect(operations.create(input)).resolves.toMatchObject({
      copiedDesignId: "deleted-copy",
      reused: false,
    });

    await expect(operations.create(input)).resolves.toMatchObject({
      copiedDesignId: "replacement-copy",
      reused: false,
    });

    await expect(operations.create(input)).resolves.toMatchObject({
      copiedDesignId: "replacement-copy",
      editUrl: "https://www.canva.com/replacement-copy-fresh",
      reused: true,
    });

    expect(copyEntireDesign).toHaveBeenCalledTimes(2);
    expect(getDesign).toHaveBeenNthCalledWith(1, "deleted-copy", "user");
    expect(getDesign).toHaveBeenNthCalledWith(2, "replacement-copy", "user");
  });

  it.each([
    ["AUTH_REQUIRED", 401],
    ["RATE_LIMITED", 429],
    ["CANVA_UNAVAILABLE", 500],
  ] as const)(
    "does not recreate a persisted copy when lookup fails with %s",
    async (code, status) => {
      const copyEntireDesign = vi.fn().mockResolvedValue({
        copiedDesignId: "persisted-copy",
        editUrl: "https://www.canva.com/persisted-copy",
      });

      const getDesign = vi
        .fn()
        .mockRejectedValue(new CanvaConnectApiError(code, status));

      const operations = new CanvaCopyOperations({
        copyEntireDesign,
        getDesign,
      });

      const input = {
        designId: "source",
        userId: "user",
        language: "en" as const,
        sourceTitle: "Source",
      };

      await expect(operations.create(input)).resolves.toMatchObject({
        copiedDesignId: "persisted-copy",
        reused: false,
      });

      await expect(operations.create(input)).rejects.toMatchObject({
        code,
        status,
      });

      expect(copyEntireDesign).toHaveBeenCalledTimes(1);
      expect(getDesign).toHaveBeenCalledTimes(1);
    },
  );

  it("does not cache a failed operation", async () => {
    const copyEntireDesign = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({
        copiedDesignId: "retry-copy",
        editUrl: "https://www.canva.com/retry-copy",
      });
    const operations = new CanvaCopyOperations({ copyEntireDesign });
    const input = {
      designId: "d",
      userId: "u",
      language: "es" as const,
    };
    await expect(operations.create(input)).rejects.toThrow("temporary failure");
    await expect(operations.create(input)).resolves.toMatchObject({
      copiedDesignId: "retry-copy",
      language: "es",
      reused: false,
    });
    expect(copyEntireDesign).toHaveBeenCalledTimes(2);
  });
});
