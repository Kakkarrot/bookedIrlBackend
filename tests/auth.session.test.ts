import test from "node:test";
import assert from "node:assert/strict";
import type { DecodedIdToken } from "firebase-admin/auth";
import { createIntegrationHarness } from "./helpers/integrationHarness";

function buildDecodedToken(): DecodedIdToken {
  return {
    uid: "firebase-user-1",
    aud: "test-project",
    auth_time: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    firebase: {
      identities: {},
      sign_in_provider: "google.com"
    },
    iat: Math.floor(Date.now() / 1000),
    iss: "https://securetoken.google.com/test-project",
    sub: "firebase-user-1",
    email: "person@example.com"
  };
}

test("POST /auth/session creates a user in isolated Postgres", async () => {
  const harness = await createIntegrationHarness();

  try {
    const { buildServer } = await import("../src/server");
    const { apiVersion } = await import("../src/config/apiVersion");
    const app = buildServer({
      pool: harness.pool,
      tokenVerifier: async (token: string) => {
        assert.equal(token, "integration-test-token");
        return buildDecodedToken();
      }
    });

    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/auth/session",
      headers: {
        authorization: "Bearer integration-test-token",
        "x-api-version": apiVersion
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as { userId: string };
    assert.match(body.userId, /^[0-9a-f-]{36}$/);

    const userResult = await harness.pool.query(
      "SELECT email, onboarding_step FROM users WHERE id = $1",
      [body.userId]
    );

    assert.equal(userResult.rowCount, 1);
    assert.equal(userResult.rows[0].email, "person@example.com");
    assert.equal(userResult.rows[0].onboarding_step, "BIRTHDAY");

    await app.close();
  } finally {
    await harness.close();
  }
});
