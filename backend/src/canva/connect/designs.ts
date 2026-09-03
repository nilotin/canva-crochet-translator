import { z } from "zod";
import { CanvaConnectApiError, CanvaConnectClient } from "./client.js";
import type { CanvaConnectTokenProvider, CanvaDesignCopier } from "./types.js";

const responseSchema = z.object({
  design: z.object({
    id: z.string().min(1),
    urls: z.object({ edit_url: z.string().url() }),
  }),
});

export class CanvaConnectDesigns implements CanvaDesignCopier {
  constructor(
    private readonly client: CanvaConnectClient,
    private readonly tokens: CanvaConnectTokenProvider,
  ) {}

  async getDesign(designId: string, userId: string) {
    const accessToken = await this.tokens.getAccessToken(userId);

    const response = await this.client.get(
      `/rest/v1/designs/${encodeURIComponent(designId)}`,
      accessToken,
    );

    const parsed = responseSchema.safeParse(response);

    if (!parsed.success)
      throw new CanvaConnectApiError("INVALID_CANVA_RESPONSE", 502);

    return {
      copiedDesignId: parsed.data.design.id,
      editUrl: parsed.data.design.urls.edit_url,
    };
  }

  async copyEntireDesign(sourceDesignId: string, userId: string) {
    const accessToken = await this.tokens.getAccessToken(userId);
    const response = await this.client.post("/rest/v1/designs", accessToken, {
      type: "design",
      design_id: sourceDesignId,
    });
    const parsed = responseSchema.safeParse(response);
    if (!parsed.success)
      throw new CanvaConnectApiError("INVALID_CANVA_RESPONSE", 502);
    return {
      copiedDesignId: parsed.data.design.id,
      editUrl: parsed.data.design.urls.edit_url,
    };
  }

}
