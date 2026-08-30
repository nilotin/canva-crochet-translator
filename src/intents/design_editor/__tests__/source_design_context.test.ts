import {
  buildDesignContextUrl,
  loadSourceDesignContext,
  SourceDesignContextError,
} from "../source_design_context";

const DESIGN_TOKEN = "design.jwt.value";
const USER_TOKEN = "user.jwt.value";

const mockResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;

const createDependencies = () => {
  const getDesignToken = jest.fn(async () => ({ token: DESIGN_TOKEN }));
  const getUserToken = jest.fn(async () => USER_TOKEN);
  const getMetadata = jest.fn(async () => ({
    title: "Ayıcık Tarifi",
    pageMetadata: [{}, {}],
  }));
  const fetchMock = jest.fn(async () =>
    mockResponse({ verified: true, designId: "verified-design" }),
  );
  const logger = {
    error: jest.fn(),
    warn: jest.fn(),
  };

  return {
    backendHost: "http://localhost:8787",
    fetch: fetchMock as typeof fetch,
    fetchMock,
    getDesignToken,
    getMetadata,
    getUserToken,
    isDevelopment: true,
    logger,
  };
};

describe("loadSourceDesignContext", () => {
  it("uses the Canva SDK design-token object and user-token string shapes", async () => {
    const dependencies = createDependencies();

    await expect(loadSourceDesignContext(dependencies)).resolves.toEqual({
      verified: true,
      title: "Ayıcık Tarifi",
      pageCount: 2,
    });
    expect(dependencies.getDesignToken).toHaveBeenCalledTimes(1);
    expect(dependencies.getUserToken).toHaveBeenCalledTimes(1);
  });

  it("does not let optional metadata failure block verification", async () => {
    const dependencies = createDependencies();
    dependencies.getMetadata.mockRejectedValue(
      new Error("metadata unavailable"),
    );

    await expect(loadSourceDesignContext(dependencies)).resolves.toEqual({
      verified: true,
      title: undefined,
      pageCount: undefined,
    });
    expect(dependencies.fetchMock).toHaveBeenCalledTimes(1);
    expect(dependencies.logger.warn).toHaveBeenCalledWith(
      "Canva source context warning",
      expect.objectContaining({ stage: "metadata_failed" }),
    );
  });

  it("stops before fetch when the design token fails", async () => {
    const dependencies = createDependencies();
    dependencies.getDesignToken.mockRejectedValue(
      new Error("design API unavailable"),
    );

    await expect(loadSourceDesignContext(dependencies)).rejects.toMatchObject({
      stage: "design_token_failed",
    });
    expect(dependencies.getUserToken).not.toHaveBeenCalled();
    expect(dependencies.fetchMock).not.toHaveBeenCalled();
  });

  it("stops before fetch when the user token fails", async () => {
    const dependencies = createDependencies();
    dependencies.getUserToken.mockRejectedValue(
      new Error("user API unavailable"),
    );

    await expect(loadSourceDesignContext(dependencies)).rejects.toMatchObject({
      stage: "user_token_failed",
    });
    expect(dependencies.fetchMock).not.toHaveBeenCalled();
  });

  it("sends the documented token contract to the configured backend", async () => {
    const dependencies = createDependencies();

    await loadSourceDesignContext(dependencies);

    expect(dependencies.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8787/api/canva/design-context",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${USER_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ designToken: DESIGN_TOKEN }),
      },
    );
  });

  it("reports non-2xx backend verification without reading its body", async () => {
    const dependencies = createDependencies();
    const response = mockResponse({ error: "internal detail" }, 401);
    const jsonSpy = jest.spyOn(response, "json");
    dependencies.fetchMock.mockResolvedValue(response);

    await expect(loadSourceDesignContext(dependencies)).rejects.toEqual(
      new SourceDesignContextError("backend_verification_failed", 401),
    );
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(dependencies.logger.error).toHaveBeenCalledWith(
      "Canva source context error",
      expect.objectContaining({
        stage: "backend_verification_failed",
        httpStatus: 401,
      }),
    );
  });

  it("redacts tokens from development diagnostics and thrown errors", async () => {
    const dependencies = createDependencies();
    dependencies.fetchMock.mockRejectedValue(
      new Error(`request failed ${DESIGN_TOKEN} ${USER_TOKEN}`),
    );

    let thrown: unknown;
    try {
      await loadSourceDesignContext(dependencies);
    } catch (cause) {
      thrown = cause;
    }

    const diagnostics = JSON.stringify(dependencies.logger.error.mock.calls);
    expect(diagnostics).not.toContain(DESIGN_TOKEN);
    expect(diagnostics).not.toContain(USER_TOKEN);
    expect(String(thrown)).not.toContain(DESIGN_TOKEN);
    expect(String(thrown)).not.toContain(USER_TOKEN);
  });

  it("builds the endpoint URL without duplicate slashes", () => {
    expect(buildDesignContextUrl("http://localhost:8787/")).toBe(
      "http://localhost:8787/api/canva/design-context",
    );
  });
});
