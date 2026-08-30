import { TokenInvalidError } from "@canva/app-middleware";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveDesignContext } from "../design_context.js";
import type { CanvaTokenVerificationService } from "../token_verification.js";

const validService = (): CanvaTokenVerificationService => ({
  verifyDesignToken: vi.fn().mockResolvedValue({
    designId: "design-verified",
    appId: "app-verified",
  }),
  verifyUserToken: vi.fn().mockResolvedValue({
    userId: "user-verified",
    brandId: "brand-verified",
    appId: "app-verified",
  }),
});

const postContext = (
  service: CanvaTokenVerificationService,
  designToken = "raw.design.jwt",
) =>
  resolveDesignContext(
    service,
    { designToken },
    "Bearer raw.user.jwt",
  );

describe("POST /api/canva/design-context", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns identity only after both Canva tokens are verified", async () => {
    const service = validService();
    const response = await postContext(service);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      verified: true,
      designId: "design-verified",
      appId: "app-verified",
      userId: "user-verified",
    });
    expect(service.verifyDesignToken).toHaveBeenCalledWith("raw.design.jwt");
    expect(service.verifyUserToken).toHaveBeenCalledWith("raw.user.jwt");
    expect(JSON.stringify(response.body)).not.toContain("raw.design.jwt");
    expect(JSON.stringify(response.body)).not.toContain("raw.user.jwt");
  });

  it.each(["invalid.signature.jwt", "not-a-jwt"])(
    "returns a controlled response for invalid token %s",
    async (designToken) => {
      const service = validService();
      vi.mocked(service.verifyDesignToken).mockRejectedValue(
        new TokenInvalidError("sensitive verifier detail"),
      );

      const response = await postContext(service, designToken);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "Canva verification failed." });
      expect(JSON.stringify(response.body)).not.toContain(designToken);
      expect(JSON.stringify(response.body)).not.toContain("sensitive");
    },
  );

  it("rejects a missing user bearer token", async () => {
    const response = await resolveDesignContext(
      validService(),
      { designToken: "raw.design.jwt" },
      undefined,
    );

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Canva verification failed." });
  });

  it("returns a controlled service error without exposing raw tokens", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = validService();
    vi.mocked(service.verifyDesignToken).mockRejectedValue(
      new Error("JWKS service included raw.design.jwt"),
    );

    const response = await postContext(service);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: "Canva verification unavailable.",
    });
    expect(JSON.stringify(response.body)).not.toContain("raw.design.jwt");
    expect(console.error).toHaveBeenCalledWith(
      "Canva token verification service unavailable.",
    );
  });
});
