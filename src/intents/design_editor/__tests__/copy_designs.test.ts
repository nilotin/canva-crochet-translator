import { createDesignCopy } from "../copy_designs";

describe("createDesignCopy", () => {
  it("sends fresh signed tokens, target intent, and no source design ID", async () => {
    const fetcher = jest.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        ({
          ok: true,
          json: async () => ({
            language: "en",
            copiedDesignId: "copy",
            editUrl: "https://www.canva.com/exact",
            desiredTitle: "Source - EN",
            reused: false,
          }),
        }) as Response,
    );
    await createDesignCopy("en", "Source", {
      backendHost: "http://127.0.0.1:8787/",
      getDesignToken: async () => ({ token: "design-token" }),
      getUserToken: async () => "user-token",
      fetch: fetcher as typeof fetch,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const call = fetcher.mock.calls[0];
    if (!call) throw new Error("Copy request was not sent.");
    const [url, init] = call;
    expect(url).toBe("http://127.0.0.1:8787/api/canva/designs/copy");
    expect(init?.headers).toEqual({
      Authorization: "Bearer user-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      designToken: "design-token",
      targetLanguage: "en",
      sourceTitle: "Source",
    });
    expect(String(init?.body)).not.toContain("sourceDesignId");
    expect(url).not.toContain("translate");
  });
});
