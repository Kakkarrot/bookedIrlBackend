import test = require("node:test");
import * as assert from "node:assert/strict";
import { createLightweightTestApp } from "./helpers/testApp";
import { headlineOptions } from "../../src/config/headlines";

test("GET /headlines returns the configured headline options", async () => {
  const testApp = await createLightweightTestApp();

  try {
    const response = await testApp.app.inject({
      method: "GET",
      url: "/headlines",
      headers: {
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as { headlines: string[] };
    assert.deepEqual(body, { headlines: headlineOptions });
  } finally {
    await testApp.close();
  }
});
