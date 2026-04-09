import test = require("node:test");
import { startIntegrationRuntime, stopIntegrationRuntime } from "./integrationHarness";

let hooksRegistered = false;

export function registerIntegrationSuiteHooks() {
  if (hooksRegistered) {
    return;
  }

  hooksRegistered = true;

  test.before(async () => {
    await startIntegrationRuntime();
  });

  test.after(async () => {
    await stopIntegrationRuntime();
  });
}
