import test = require("node:test");
import * as assert from "node:assert/strict";
import { buildDecodedToken, createTestApp } from "./helpers/testApp";
import {
  createLocation,
  createPhoto,
  createService,
  createUserWithIdentity
} from "./helpers/factories";

test("GET /users/nearby-qualified only returns other users with both a photo and an active service", async () => {
  const tokenToUid = new Map([["viewer-token", "viewer-firebase-uid"]]);

  const testApp = await createTestApp({
    tokenVerifier: async (token: string) => {
      const uid = tokenToUid.get(token);
      if (!uid) {
        throw new Error("invalid_token");
      }

      return buildDecodedToken({
        uid,
        sub: uid,
        email: `${uid}@example.com`
      });
    }
  });

  try {
    const viewer = await createUserWithIdentity(testApp.pool, {
      uid: "viewer-firebase-uid",
      email: "viewer@example.com",
      displayName: "Viewer",
      username: "viewer"
    });
    await createLocation(testApp.pool, {
      userId: viewer.userId,
      lat: 37.7749,
      lng: -122.4194
    });

    const qualified = await createUserWithIdentity(testApp.pool, {
      email: "qualified@example.com",
      displayName: "Qualified User",
      username: "qualified"
    });
    await createPhoto(testApp.pool, {
      userId: qualified.userId,
      url: "https://example.com/qualified.jpg"
    });
    await createService(testApp.pool, {
      userId: qualified.userId,
      title: "Qualified Service",
      isActive: true
    });
    await createLocation(testApp.pool, {
      userId: qualified.userId,
      lat: 37.775,
      lng: -122.4195
    });

    const onlyPhoto = await createUserWithIdentity(testApp.pool, {
      email: "photo-only@example.com",
      displayName: "Photo Only",
      username: "photoonly"
    });
    await createPhoto(testApp.pool, {
      userId: onlyPhoto.userId,
      url: "https://example.com/photo-only.jpg"
    });

    const onlyService = await createUserWithIdentity(testApp.pool, {
      email: "service-only@example.com",
      displayName: "Service Only",
      username: "serviceonly"
    });
    await createService(testApp.pool, {
      userId: onlyService.userId,
      title: "Service Only",
      isActive: true
    });

    await createPhoto(testApp.pool, {
      userId: viewer.userId,
      url: "https://example.com/viewer.jpg"
    });
    await createService(testApp.pool, {
      userId: viewer.userId,
      title: "Viewer Service",
      isActive: true
    });

    const response = await testApp.app.inject({
      method: "GET",
      url: "/users/nearby-qualified?limit=10&offset=0",
      headers: {
        authorization: "Bearer viewer-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as Array<{
      id: string;
      display_name: string | null;
      username: string | null;
      photos: Array<{ url: string; sort_order: number }>;
    }>;

    assert.equal(body.length, 1);
    assert.equal(body[0].id, qualified.userId);
    assert.equal(body[0].display_name, "Qualified User");
    assert.equal(body[0].username, "qualified");
    assert.equal(body[0].photos.length, 1);
    assert.equal(body[0].photos[0].url, "https://example.com/qualified.jpg");

    const returnedIds = new Set(body.map((user) => user.id));
    assert.ok(!returnedIds.has(viewer.userId));
    assert.ok(!returnedIds.has(onlyPhoto.userId));
    assert.ok(!returnedIds.has(onlyService.userId));
  } finally {
    await testApp.close();
  }
});
