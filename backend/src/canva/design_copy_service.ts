export type CopyTargetLanguage = "en" | "es";

export type CreateCanvaDesignCopyInput = {
  sourceDesignId: string;
  targetLanguage: CopyTargetLanguage;
  sourceTitle?: string;
};

export type CanvaDesignCopy = {
  designId: string;
  title?: string;
};

/** Contract only. No Canva Connect API mutation is implemented in Stage 3. */
export interface CanvaDesignCopyService {
  createCopy(input: CreateCanvaDesignCopyInput): Promise<CanvaDesignCopy>;
}
