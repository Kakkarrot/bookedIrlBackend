import test = require("node:test");
import * as assert from "node:assert/strict";
import { buildDecodedToken, createTestApp } from "./helpers/testApp";
import {
  createPhoto,
  createService,
  createUserWithIdentity
} from "./helpers/factories";

async function createUsersTestContext() {
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

  const viewer = await createUserWithIdentity(testApp.pool, {
    uid: "viewer-firebase-uid",
    email: "viewer@example.com",
    displayName: "Viewer Person",
    username: "viewer"
  });

  return { testApp, viewer };
}

test("GET /users/:userId returns the full self profile including private fields and inactive services", async () => {
  const { testApp, viewer } = await createUsersTestContext();

  try {
    await createPhoto(testApp.pool, {
      userId: viewer.userId,
      url: "https://example.com/viewer-1.jpg",
      sortOrder: 0
    });
    await createPhoto(testApp.pool, {
      userId: viewer.userId,
      url: "https://example.com/viewer-2.jpg",
      sortOrder: 1
    });

    const activeService = await createService(testApp.pool, {
      userId: viewer.userId,
      title: "Active Service",
      isActive: true
    });
    const inactiveService = await createService(testApp.pool, {
      userId: viewer.userId,
      title: "Inactive Service",
      isActive: false
    });

    const response = await testApp.app.inject({
      method: "GET",
      url: `/users/${viewer.userId}`,
      headers: {
        authorization: "Bearer viewer-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      id: string;
      email?: string;
      photos: Array<{ url: string; sort_order: number }>;
      services: Array<{ id: string; title: string; is_active: boolean }>;
    };

    assert.equal(body.id, viewer.userId);
    assert.equal(body.email, "viewer@example.com");
    assert.equal(body.photos.length, 2);
    assert.equal(body.photos[0].url, "https://example.com/viewer-1.jpg");
    assert.equal(body.photos[1].url, "https://example.com/viewer-2.jpg");

    const returnedServiceIds = new Set(body.services.map((service) => service.id));
    assert.ok(returnedServiceIds.has(activeService.serviceId));
    assert.ok(returnedServiceIds.has(inactiveService.serviceId));
  } finally {
    await testApp.close();
  }
});

test("GET /users/:userId hides private fields and inactive services from other users, including non-discoverable profiles", async () => {
  const { testApp, viewer } = await createUsersTestContext();

  try {
    const qualifiedTarget = await createUserWithIdentity(testApp.pool, {
      email: "qualified-target@example.com",
      displayName: "Qualified Target",
      username: "qualifiedtarget"
    });
    await createPhoto(testApp.pool, {
      userId: qualifiedTarget.userId,
      url: "https://example.com/qualified-target.jpg"
    });
    const activeService = await createService(testApp.pool, {
      userId: qualifiedTarget.userId,
      title: "Qualified Active Service",
      isActive: true
    });
    await createService(testApp.pool, {
      userId: qualifiedTarget.userId,
      title: "Qualified Inactive Service",
      isActive: false
    });

    const hiddenTarget = await createUserWithIdentity(testApp.pool, {
      email: "hidden-target@example.com",
      displayName: "Hidden Target",
      username: "hiddentarget"
    });
    await createService(testApp.pool, {
      userId: hiddenTarget.userId,
      title: "No Photo Service",
      isActive: true
    });

    const publicResponse = await testApp.app.inject({
      method: "GET",
      url: `/users/${qualifiedTarget.userId}`,
      headers: {
        authorization: "Bearer viewer-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(publicResponse.statusCode, 200);
    const publicBody = publicResponse.json() as {
      id: string;
      email?: string;
      services: Array<{ id: string; title: string; is_active: boolean }>;
      photos: Array<{ url: string }>;
    };

    assert.equal(publicBody.id, qualifiedTarget.userId);
    assert.ok(!("email" in publicBody));
    assert.equal(publicBody.photos.length, 1);
    assert.equal(publicBody.photos[0].url, "https://example.com/qualified-target.jpg");
    assert.equal(publicBody.services.length, 1);
    assert.equal(publicBody.services[0].id, activeService.serviceId);
    assert.equal(publicBody.services[0].title, "Qualified Active Service");
    assert.equal(publicBody.services[0].is_active, true);

    const hiddenResponse = await testApp.app.inject({
      method: "GET",
      url: `/users/${hiddenTarget.userId}`,
      headers: {
        authorization: "Bearer viewer-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(hiddenResponse.statusCode, 200);
    const hiddenBody = hiddenResponse.json() as {
      id: string;
      email?: string;
      photos: Array<{ url: string }>;
      services: Array<{ title: string; is_active: boolean }>;
    };

    assert.equal(hiddenBody.id, hiddenTarget.userId);
    assert.ok(!("email" in hiddenBody));
    assert.equal(hiddenBody.photos.length, 0);
    assert.equal(hiddenBody.services.length, 1);
    assert.equal(hiddenBody.services[0].title, "No Photo Service");
    assert.equal(hiddenBody.services[0].is_active, true);

    assert.ok(viewer.userId !== qualifiedTarget.userId);
  } finally {
    await testApp.close();
  }
});
