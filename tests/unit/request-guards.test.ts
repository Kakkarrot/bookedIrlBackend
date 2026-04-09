import test = require("node:test");
import * as assert from "node:assert/strict";
import { createLightweightTestApp } from "../integration/helpers/testApp";

test("protected routes reject requests with a missing API version header", async () => {
  const testApp = await createLightweightTestApp();

  try {
    const response = await testApp.app.inject({
      method: "POST",
      url: "/auth/session",
      headers: {
        authorization: "Bearer integration-test-token"
      }
    });

    assert.equal(response.statusCode, 426);
    assert.deepEqual(response.json(), {
      error: "client_out_of_date",
      current_version: testApp.apiVersion,
      client_version: null
    });
  } finally {
    await testApp.close();
  }
});

test("protected routes reject requests with an invalid API version header", async () => {
  const testApp = await createLightweightTestApp();

  try {
    const response = await testApp.app.inject({
      method: "POST",
      url: "/auth/session",
      headers: {
        authorization: "Bearer integration-test-token",
        "x-api-version": "0.0.0"
      }
    });

    assert.equal(response.statusCode, 426);
    assert.deepEqual(response.json(), {
      error: "client_out_of_date",
      current_version: testApp.apiVersion,
      client_version: "0.0.0"
    });
  } finally {
    await testApp.close();
  }
});

test("protected routes reject requests with missing auth", async () => {
  const testApp = await createLightweightTestApp();

  try {
    const response = await testApp.app.inject({
      method: "POST",
      url: "/auth/session",
      headers: {
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: "unauthorized" });
  } finally {
    await testApp.close();
  }
});

test("protected routes reject requests with invalid auth tokens", async () => {
  const testApp = await createLightweightTestApp();

  try {
    const response = await testApp.app.inject({
      method: "POST",
      url: "/auth/session",
      headers: {
        authorization: "Bearer not-a-valid-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: "unauthorized" });
  } finally {
    await testApp.close();
  }
});
