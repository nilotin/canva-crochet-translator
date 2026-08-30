import type { CanvaDesignCopier } from "./types.js";
import { CanvaConnectAuth } from "./auth.js";
import { CanvaConnectClient } from "./client.js";
import { CanvaCopyOperations } from "./copy_operations.js";
import { CanvaConnectDesigns } from "./designs.js";
import { JsonCopyOperationStore } from "./copy_operation_store.js";
import { JsonPageTranslationStateStore } from "../page_state/store.js";
import { JsonBulkReviewStore } from "../bulk_review/store.js";
import { JsonBulkPreferencesStore } from "../bulk_preferences/store.js";

const createMockCopier = (): CanvaDesignCopier => ({
  async copyEntireDesign(sourceDesignId, userId) {
    const id = `mock-${userId.slice(0, 8)}-${sourceDesignId.slice(0, 8)}-${Date.now()}`;
    return {
      copiedDesignId: id,
      editUrl: `https://example.invalid/canva-connect-mock/${encodeURIComponent(id)}`,
    };
  },
});

export const createConnectDependencies = () => {
  const mode = process.env.CANVA_CONNECT_MODE ?? "disabled";
  const store = new JsonCopyOperationStore(
    process.env.CANVA_COPY_STORE_PATH ?? ".data/canva-copy-operations.json",
  );
  const pageStateStore = new JsonPageTranslationStateStore(
    process.env.CANVA_PAGE_STATE_STORE_PATH ?? ".data/canva-page-states.json",
  );

  const bulkReviewStore = new JsonBulkReviewStore(
    process.env.CANVA_BULK_REVIEW_STORE_PATH ?? ".data/canva-bulk-reviews.json",
  );

  const bulkPreferencesStore = new JsonBulkPreferencesStore(
    process.env.CANVA_BULK_PREFERENCES_STORE_PATH ??
      ".data/canva-bulk-preferences.json",
  );
  if (mode === "mock")
    return {
      store,
      pageStateStore,
      bulkReviewStore,
      bulkPreferencesStore,
      operations: new CanvaCopyOperations(createMockCopier(), store),
    };
  if (mode !== "real")
    return {
      store,
      pageStateStore,
      bulkReviewStore,
      bulkPreferencesStore,
    };
  const clientId = process.env.CANVA_CONNECT_CLIENT_ID;
  const clientSecret = process.env.CANVA_CONNECT_CLIENT_SECRET;
  const redirectUri = process.env.CANVA_CONNECT_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri)
    throw new Error(
      "Real Canva Connect mode requires client ID, client secret, and redirect URI.",
    );
  const auth = new CanvaConnectAuth({ clientId, clientSecret, redirectUri });
  const designs = new CanvaConnectDesigns(new CanvaConnectClient(), auth);
  return {
    auth,
    store,
    pageStateStore,
    bulkReviewStore,
    bulkPreferencesStore,
    operations: new CanvaCopyOperations(designs, store),
  };
};
