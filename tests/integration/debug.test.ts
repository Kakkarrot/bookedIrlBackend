import { registerIntegrationSuiteHooks } from "./helpers/setup";

registerIntegrationSuiteHooks();

const target = process.env.INTEGRATION_TARGET;

if (!target) {
  throw new Error("INTEGRATION_TARGET is required, for example tests/integration/auth.session.test.ts");
}

void import(`./${target.replace(/^tests\/integration\//, "")}`);
