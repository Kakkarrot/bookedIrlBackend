import test = require("node:test");
import * as assert from "node:assert/strict";
import { buildDecodedToken, createTestApp } from "./helpers/testApp";

test("POST /auth/session creates a user in isolated Postgres", async () => {
  const testApp = await createTestApp({
    tokenVerifier: async (token: string) => {
      assert.equal(token, "integration-test-token");
      return buildDecodedToken();
    }
  });

  try {
    const response = await testApp.app.inject({
      method: "POST",
      url: "/auth/session",
      headers: {
        authorization: "Bearer integration-test-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as { userId: string };
    assert.match(body.userId, /^[0-9a-f-]{36}$/);

    const userResult = await testApp.pool.query(
      "SELECT email, onboarding_step FROM users WHERE id = $1",
      [body.userId]
    );

    assert.equal(userResult.rowCount, 1);
    assert.equal(userResult.rows[0].email, "person@example.com");
    assert.equal(userResult.rows[0].onboarding_step, "BIRTHDAY");

  } finally {
    await testApp.close();
  }
});
