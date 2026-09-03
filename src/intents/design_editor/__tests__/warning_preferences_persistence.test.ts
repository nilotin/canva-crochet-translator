import {
  loadWarningPreferences,
  saveWarningPreferences,
} from "../warning_preferences_persistence";

const auth = {
  getDesignToken: jest.fn(async () => ({ token: "design-jwt" })),
  getUserToken: jest.fn(async () => "user-jwt" as never),
};

describe("warning preferences persistence", () => {
  it("loads persisted auto-acknowledged warning codes (reload/resume)", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        preferences: {
          autoAcknowledgedWarningCodes: ["MANUAL_REVIEW_RECOMMENDED"],
          updatedAt: "2026-08-30T10:00:00.000Z",
        },
      }),
    })) as unknown as typeof fetch;

    await expect(
      loadWarningPreferences({
        ...auth,
        fetch: fetcher,
        backendHost: "http://backend.test",
      }),
    ).resolves.toEqual({
      autoAcknowledgedWarningCodes: ["MANUAL_REVIEW_RECOMMENDED"],
      updatedAt: "2026-08-30T10:00:00.000Z",
    });

    const call = (
      (fetcher as unknown as jest.Mock).mock.calls as [
        string,
        RequestInit,
      ][]
    )[0];

    expect(call?.[0]).toBe(
      "http://backend.test/api/canva/warning-preferences/get",
    );
    expect((call?.[1].headers as Record<string, string>).Authorization).toBe(
      "Bearer user-jwt",
    );
  });

  it("returns an empty set when no preferences exist yet", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({ preferences: null }),
    })) as unknown as typeof fetch;

    await expect(
      loadWarningPreferences({
        ...auth,
        fetch: fetcher,
        backendHost: "",
      }),
    ).resolves.toEqual({
      autoAcknowledgedWarningCodes: [],
      updatedAt: undefined,
    });
  });

  it("saves the approved warning-family set with Canva authorization", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
    })) as unknown as typeof fetch;

    await saveWarningPreferences(new Set(["MANUAL_REVIEW_RECOMMENDED"]), {
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
      "http://backend.test/api/canva/warning-preferences/save",
    );

    expect((call?.[1].headers as Record<string, string>).Authorization).toBe(
      "Bearer user-jwt",
    );

    expect(JSON.parse(String(call?.[1].body))).toEqual({
      autoAcknowledgedWarningCodes: ["MANUAL_REVIEW_RECOMMENDED"],
      designToken: "design-jwt",
    });
  });

  it("throws when the save request fails", async () => {
    const fetcher = jest.fn(async () => ({
      ok: false,
    })) as unknown as typeof fetch;

    await expect(
      saveWarningPreferences(new Set(["MANUAL_REVIEW_RECOMMENDED"]), {
        ...auth,
        fetch: fetcher,
        backendHost: "http://backend.test",
      }),
    ).rejects.toThrow("Could not save warning preferences.");
  });
});
