import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { CanvaConnectToken, CanvaConnectTokenProvider } from "./types.js";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
});

export class CanvaConnectAuthError extends Error {
  constructor(public readonly code: "AUTH_REQUIRED" | "AUTH_FAILED") {
    super(
      code === "AUTH_REQUIRED"
        ? "Canva authorization is required."
        : "Canva authorization failed.",
    );
    this.name = "CanvaConnectAuthError";
  }
}

type PendingAuthorization = {
  userId: string;
  verifier: string;
  expiresAt: number;
};

export class CanvaConnectAuth implements CanvaConnectTokenProvider {
  private readonly pending = new Map<string, PendingAuthorization>();
  private readonly tokens = new Map<string, CanvaConnectToken>();

  constructor(
    private readonly config: {
      clientId: string;
      clientSecret: string;
      redirectUri: string;
    },
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {}

  start(userId: string) {
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(64).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    this.pending.set(state, {
      userId,
      verifier,
      expiresAt: Date.now() + 10 * 60_000,
    });
    const url = new URL("https://www.canva.com/api/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: "design:content:write design:meta:read",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }

  async complete(code: string, state: string) {
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (!pending || pending.expiresAt < Date.now())
      throw new CanvaConnectAuthError("AUTH_FAILED");
    const token = await this.exchange(
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: pending.verifier,
        redirect_uri: this.config.redirectUri,
      }),
    );
    this.tokens.set(pending.userId, token);
  }

  async getAccessToken(userId: string) {
    const token = this.tokens.get(userId);
    if (!token) throw new CanvaConnectAuthError("AUTH_REQUIRED");
    if (token.expiresAt > Date.now() + 60_000) return token.accessToken;
    const refreshed = await this.exchange(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
    );
    this.tokens.set(userId, refreshed);
    return refreshed.accessToken;
  }

  private async exchange(body: URLSearchParams): Promise<CanvaConnectToken> {
    const basic = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`,
    ).toString("base64");
    const response = await this.fetcher(
      "https://api.canva.com/rest/v1/oauth/token",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );
    if (!response.ok) throw new CanvaConnectAuthError("AUTH_FAILED");
    const parsed = tokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new CanvaConnectAuthError("AUTH_FAILED");
    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      expiresAt: Date.now() + parsed.data.expires_in * 1000,
    };
  }
}
