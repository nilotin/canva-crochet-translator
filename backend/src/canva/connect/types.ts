export type CopyTargetLanguage = "en" | "es";

export type CanvaConnectToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type CanvaCopyResult = {
  copiedDesignId: string;
  editUrl: string;
};

export interface CanvaConnectTokenProvider {
  getAccessToken(userId: string): Promise<string>;
}

export interface CanvaDesignCopier {
  copyEntireDesign(
    sourceDesignId: string,
    userId: string,
  ): Promise<CanvaCopyResult>;

  getDesign?(designId: string, userId: string): Promise<CanvaCopyResult>;
}

export type CopyOperationResult = CanvaCopyResult & {
  language: CopyTargetLanguage;
  desiredTitle: string;
  reused: boolean;
};
