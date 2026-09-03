export type ConnectErrorCode =
  | "AUTH_REQUIRED"
  | "SOURCE_NOT_FOUND"
  | "RATE_LIMITED"
  | "CANVA_UNAVAILABLE"
  | "INVALID_CANVA_RESPONSE";

export class CanvaConnectApiError extends Error {
  constructor(
    public readonly code: ConnectErrorCode,
    public readonly status: number,
  ) {
    super("Canva Connect API request failed.");
    this.name = "CanvaConnectApiError";
  }
}

export class CanvaConnectClient {
  constructor(
    private readonly fetcher: typeof fetch = globalThis.fetch,
    private readonly baseUrl = "https://api.canva.com",
  ) {}

  async get(path: string, accessToken: string): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.ok) return response.json();

    const code =
      response.status === 401 || response.status === 403
        ? "AUTH_REQUIRED"
        : response.status === 404
          ? "SOURCE_NOT_FOUND"
          : response.status === 429
            ? "RATE_LIMITED"
            : "CANVA_UNAVAILABLE";

    throw new CanvaConnectApiError(code, response.status);
  }

  async post(
    path: string,
    accessToken: string,
    body: unknown,
  ): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (response.ok) return response.json();
    const code =
      response.status === 401 || response.status === 403
        ? "AUTH_REQUIRED"
        : response.status === 404
          ? "SOURCE_NOT_FOUND"
          : response.status === 429
            ? "RATE_LIMITED"
            : "CANVA_UNAVAILABLE";
    throw new CanvaConnectApiError(code, response.status);
  }

}
