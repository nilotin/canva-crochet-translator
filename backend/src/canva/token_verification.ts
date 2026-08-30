import {
  initDesignTokenVerifier,
  initUserTokenVerifier,
  type DesignTokenPayload,
  type UserTokenPayload,
} from "@canva/app-middleware";

export type VerifiedCanvaIdentity = {
  designId: string;
  appId: string;
  userId: string;
};

export interface CanvaTokenVerificationService {
  verifyDesignToken(token: string): Promise<DesignTokenPayload>;
  verifyUserToken(token: string): Promise<UserTokenPayload>;
}

export const createCanvaTokenVerificationService = (
  appId: string,
): CanvaTokenVerificationService => {
  const designVerifier = initDesignTokenVerifier({ appId });
  const userVerifier = initUserTokenVerifier({ appId });

  return {
    verifyDesignToken: (token) => designVerifier.verify(token),
    verifyUserToken: (token) => userVerifier.verify(token),
  };
};

export const verifyCanvaIdentity = async (
  service: CanvaTokenVerificationService,
  designToken: string,
  userToken: string,
): Promise<VerifiedCanvaIdentity> => {
  const [design, user] = await Promise.all([
    service.verifyDesignToken(designToken),
    service.verifyUserToken(userToken),
  ]);

  if (design.appId !== user.appId) {
    throw new Error("Verified Canva token app IDs do not match.");
  }

  return {
    designId: design.designId,
    appId: design.appId,
    userId: user.userId,
  };
};
