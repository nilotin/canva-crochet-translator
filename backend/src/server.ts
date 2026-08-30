import "dotenv/config";
import { createBackendApp } from "./app.js";
import { createCanvaTokenVerificationService } from "./canva/token_verification.js";
import { createConnectDependencies } from "./canva/connect/config.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const canvaAppId = process.env.CANVA_APP_ID;

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be a valid TCP port.");
}

if (!canvaAppId) {
  throw new Error(
    "CANVA_APP_ID must be configured in the backend environment.",
  );
}

const app = createBackendApp({
  canvaTokenVerification: createCanvaTokenVerificationService(canvaAppId),
  canvaConnect: createConnectDependencies(),
});

app.listen(port, () => {
  console.log(`Crochet Translator backend listening on port ${port}.`);
});
