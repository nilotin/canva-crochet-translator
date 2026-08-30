import { describe, expect, it, vi } from "vitest";
import { CanvaConnectApiError, CanvaConnectClient } from "../client.js";
import { CanvaConnectDesigns } from "../designs.js";

const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("Canva Connect design copying", () => {
  it("copies the entire verified design without page_numbers", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response(200, {
        design: {
          id: "copy-id",
          urls: { edit_url: "https://www.canva.com/design/copy/edit" },
        },
      }),
    );
    const designs = new CanvaConnectDesigns(new CanvaConnectClient(fetcher), {
      getAccessToken: vi.fn().mockResolvedValue("secret-access"),
    });
    const result = await designs.copyEntireDesign(
      "verified-source",
      "verified-user",
    );
    expect(result.copiedDesignId).toBe("copy-id");
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      type: "design",
      design_id: "verified-source",
    });
    expect(String(init.body)).not.toContain("page_numbers");
    expect(JSON.stringify(result)).not.toContain("secret-access");
  });

  it.each([
    [401, "AUTH_REQUIRED"],
    [403, "AUTH_REQUIRED"],
    [404, "SOURCE_NOT_FOUND"],
    [429, "RATE_LIMITED"],
    [500, "CANVA_UNAVAILABLE"],
  ] as const)("maps Canva status %s to %s", async (status, code) => {
    const client = new CanvaConnectClient(
      vi.fn().mockResolvedValue(response(status, { secret: "ignored" })),
    );
    await expect(
      client.post("/rest/v1/designs", "token", {}),
    ).rejects.toMatchObject({ code, status });
  });

  it("reads an existing copied design and returns a fresh edit URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response(200, {
        design: {
          id: "persisted-copy",
          urls: {
            edit_url: "https://www.canva.com/design/persisted-copy/edit",
          },
        },
      }),
    );

    const designs = new CanvaConnectDesigns(new CanvaConnectClient(fetcher), {
      getAccessToken: vi.fn().mockResolvedValue("secret-access"),
    });

    await expect(
      designs.getDesign("persisted-copy", "verified-user"),
    ).resolves.toEqual({
      copiedDesignId: "persisted-copy",
      editUrl: "https://www.canva.com/design/persisted-copy/edit",
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.canva.com/rest/v1/designs/persisted-copy",
      expect.objectContaining({
        method: "GET",
        headers: {
          Authorization: "Bearer secret-access",
        },
      }),
    );
  });

  it("preserves a real Canva 404 when a persisted copied design no longer exists", async () => {
    const designs = new CanvaConnectDesigns(
      new CanvaConnectClient(vi.fn().mockResolvedValue(response(404, {}))),
      {
        getAccessToken: vi.fn().mockResolvedValue("token"),
      },
    );

    await expect(
      designs.getDesign("deleted-copy", "user"),
    ).rejects.toMatchObject({
      code: "SOURCE_NOT_FOUND",
      status: 404,
    });
  });

  it("rejects malformed Canva responses", async () => {
    const designs = new CanvaConnectDesigns(
      new CanvaConnectClient(
        vi
          .fn()
          .mockResolvedValue(response(200, { design: { id: "missing-url" } })),
      ),
      { getAccessToken: vi.fn().mockResolvedValue("token") },
    );
    await expect(
      designs.copyEntireDesign("source", "user"),
    ).rejects.toBeInstanceOf(CanvaConnectApiError);
  });
});
