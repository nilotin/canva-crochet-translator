import { TokenVerificationError } from "@canva/app-middleware";
import { z } from "zod";
import {
  type CanvaTokenVerificationService,
  verifyCanvaIdentity,
} from "./token_verification.js";

const requestSchema = z.object({
  designToken: z.string().min(1),
});

type DesignContextControllerResult = {
  status: number;
  body: Record<string, unknown>;
};

const extractBearerToken = (authorization: string | undefined) => {
  const match = /^Bearer\s+(\S+)$/u.exec(authorization ?? "");
  return match?.[1];
};

export const resolveDesignContext = async (
  service: CanvaTokenVerificationService,
  body: unknown,
  authorization: string | undefined,
): Promise<DesignContextControllerResult> => {
  const userToken = extractBearerToken(authorization);
  if (!userToken) {
    return { status: 401, body: { error: "Canva verification failed." } };
  }

  const input = requestSchema.safeParse(body);
  if (!input.success) {
    return { status: 400, body: { error: "Invalid request body." } };
  }

  try {
    const identity = await verifyCanvaIdentity(
      service,
      input.data.designToken,
      userToken,
    );
    return { status: 200, body: { verified: true, ...identity } };
  } catch (cause) {
    if (cause instanceof TokenVerificationError) {
      return { status: 401, body: { error: "Canva verification failed." } };
    }

    console.error("Canva token verification service unavailable.");
    return {
      status: 503,
      body: { error: "Canva verification unavailable." },
    };
  }
};
