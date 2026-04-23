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

test("POST /auth/session allows duplicate emails across distinct auth identities", async () => {
  const tokens = new Map([
    [
      "google-token",
      buildDecodedToken({
        uid: "google-user-1",
        sub: "google-user-1",
        email: "shared@example.com",
        firebase: {
          identities: {},
          sign_in_provider: "google.com"
        }
      })
    ],
    [
      "apple-token",
      buildDecodedToken({
        uid: "apple-user-1",
        sub: "apple-user-1",
        email: "shared@example.com",
        firebase: {
          identities: {},
          sign_in_provider: "apple.com"
        }
      })
    ]
  ]);

  const testApp = await createTestApp({
    tokenVerifier: async (token: string) => {
      const decoded = tokens.get(token);
      assert.ok(decoded);
      return decoded;
    }
  });

  try {
    const googleResponse = await testApp.app.inject({
      method: "POST",
      url: "/auth/session",
      headers: {
        authorization: "Bearer google-token",
        "x-api-version": testApp.apiVersion
      }
    });

    const appleResponse = await testApp.app.inject({
      method: "POST",
      url: "/auth/session",
      headers: {
        authorization: "Bearer apple-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(googleResponse.statusCode, 200);
    assert.equal(appleResponse.statusCode, 200);

    const googleBody = googleResponse.json() as { userId: string };
    const appleBody = appleResponse.json() as { userId: string };
    assert.notEqual(googleBody.userId, appleBody.userId);

    const userResult = await testApp.pool.query<{ id: string; email: string }>(
      "SELECT id, email FROM users WHERE email = $1 ORDER BY id",
      ["shared@example.com"]
    );

    assert.equal(userResult.rowCount, 2);
    assert.deepEqual(
      userResult.rows.map((row) => row.id),
      [googleBody.userId, appleBody.userId].sort()
    );
  } finally {
    await testApp.close();
  }
});
