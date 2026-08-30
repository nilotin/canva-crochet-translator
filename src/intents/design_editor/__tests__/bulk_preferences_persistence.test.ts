import {
  loadBulkPreferences,
  saveBulkPreferences,
} from "../bulk_preferences_persistence";

const auth = {
  getDesignToken: jest.fn(async () => ({ token: "design-jwt" })),
  getUserToken: jest.fn(async () => "user-jwt" as never),
};

describe("bulk preferences persistence", () => {
  it("loads persisted excluded page IDs", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        preferences: {
          excludedPageIds: ["page-3", "page-7"],
          updatedAt: "2026-08-30T10:00:00.000Z",
        },
      }),
    })) as unknown as typeof fetch;

    await expect(
      loadBulkPreferences({
        ...auth,
        fetch: fetcher,
        backendHost: "http://backend.test",
      }),
    ).resolves.toEqual({
      excludedPageIds: ["page-3", "page-7"],
      updatedAt: "2026-08-30T10:00:00.000Z",
    });

    const call = (
      (fetcher as unknown as jest.Mock).mock.calls as [
        string,
        RequestInit,
      ][]
    )[0];

    expect(call?.[0]).toBe(
      "http://backend.test/api/canva/bulk-preferences/get",
    );
    expect((call?.[1].headers as Record<string, string>).Authorization).toBe(
      "Bearer user-jwt",
    );
  });

  it("returns empty exclusions when no preferences exist", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({ preferences: null }),
    })) as unknown as typeof fetch;

    await expect(
      loadBulkPreferences({
        ...auth,
        fetch: fetcher,
        backendHost: "",
      }),
    ).resolves.toEqual({
      excludedPageIds: [],
      updatedAt: undefined,
    });
  });

  it("saves excluded page IDs with Canva authorization", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
    })) as unknown as typeof fetch;

    await saveBulkPreferences(new Set(["page-3", "page-7"]), {
      ...auth,
      fetch: fetcher,
      backendHost: "http://backend.test/",
    });

    const call = (
      (fetcher as unknown as jest.Mock).mock.calls as [
        string,
        RequestInit,
      ][]
    )[0];

    expect(call?.[0]).toBe(
      "http://backend.test/api/canva/bulk-preferences/save",
    );

    expect((call?.[1].headers as Record<string, string>).Authorization).toBe(
      "Bearer user-jwt",
    );

    expect(JSON.parse(String(call?.[1].body))).toEqual({
      excludedPageIds: ["page-3", "page-7"],
      designToken: "design-jwt",
    });
  });
});
