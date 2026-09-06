import { afterEach, describe, expect, it } from "vitest";
import { createConnectDependencies } from "../config.js";
import { JsonWarningPreferencesStore } from "../../warning_preferences/store.js";

const originalMode = process.env.CANVA_CONNECT_MODE;
const originalWarningPath = process.env.CANVA_WARNING_PREFERENCES_STORE_PATH;

afterEach(() => {
  if (originalMode === undefined) {
    delete process.env.CANVA_CONNECT_MODE;
  } else {
    process.env.CANVA_CONNECT_MODE = originalMode;
  }

  if (originalWarningPath === undefined) {
    delete process.env.CANVA_WARNING_PREFERENCES_STORE_PATH;
  } else {
    process.env.CANVA_WARNING_PREFERENCES_STORE_PATH = originalWarningPath;
  }
});

describe("createConnectDependencies warning preferences composition", () => {
  it("wires a warning preferences store in disabled mode", () => {
    process.env.CANVA_CONNECT_MODE = "disabled";
    process.env.CANVA_WARNING_PREFERENCES_STORE_PATH =
      ".data/test-warning-preferences-disabled.json";

    const dependencies = createConnectDependencies();

    expect(dependencies.warningPreferencesStore).toBeInstanceOf(
      JsonWarningPreferencesStore,
    );
    expect(dependencies.warningPreferencesStore.path).toContain(
      "test-warning-preferences-disabled.json",
    );
  });

  it("wires a warning preferences store in mock mode", () => {
    process.env.CANVA_CONNECT_MODE = "mock";
    process.env.CANVA_WARNING_PREFERENCES_STORE_PATH =
      ".data/test-warning-preferences-mock.json";

    const dependencies = createConnectDependencies();

    expect(dependencies.warningPreferencesStore).toBeInstanceOf(
      JsonWarningPreferencesStore,
    );
    expect(dependencies.warningPreferencesStore.path).toContain(
      "test-warning-preferences-mock.json",
    );
  });
});
