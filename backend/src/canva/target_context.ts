import { TokenVerificationError } from "@canva/app-middleware";
import { z } from "zod";
import type { CopyOperationStore } from "./connect/copy_operation_store.js";
import type { CanvaTokenVerificationService } from "./token_verification.js";
import { verifyCanvaIdentity } from "./token_verification.js";

const schema = z.object({ designToken: z.string().min(1) }).strict();
const bearer = (value: string | undefined) =>
  /^Bearer\s+(\S+)$/u.exec(value ?? "")?.[1];

export const resolveTargetContext = async (
  verification: CanvaTokenVerificationService,
  store: CopyOperationStore | undefined,
  body: unknown,
  authorization: string | undefined,
) => {
  const userToken = bearer(authorization);
  const input = schema.safeParse(body);
  if (!userToken || !input.success) {
    return {
      status: userToken ? 400 : 401,
      body: { error: "Canva verification failed." },
    };
  }
  try {
    const identity = await verifyCanvaIdentity(
      verification,
      input.data.designToken,
      userToken,
    );
    const target = await store?.findByTargetDesign({
      userId: identity.userId,
      targetDesignId: identity.designId,
    });
    if (!target || target.sourceDesignId === target.copiedDesignId)
      return { status: 200, body: { isTranslationTarget: false } };
    return {
      status: 200,
      body: {
        isTranslationTarget: true,
        language: target.targetLanguage,
        sourceTitle: target.sourceTitle,
        contextId: target.operationId,
      },
    };
  } catch (cause) {
    if (cause instanceof TokenVerificationError) {
      return { status: 401, body: { error: "Canva verification failed." } };
    }
    return { status: 503, body: { error: "Canva verification unavailable." } };
  }
};
