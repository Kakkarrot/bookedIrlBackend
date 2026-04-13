import test = require("node:test");
import * as assert from "node:assert/strict";
import { buildDecodedToken, createTestApp } from "./helpers/testApp";
import {
  createPhoto,
  createService,
  createUserWithIdentity
} from "./helpers/factories";

async function createServicesTestContext() {
  const tokenToUid = new Map([
    ["owner-token", "owner-firebase-uid"],
    ["viewer-token", "viewer-firebase-uid"],
    ["stranger-token", "stranger-firebase-uid"]
  ]);

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

  const owner = await createUserWithIdentity(testApp.pool, {
    uid: "owner-firebase-uid",
    email: "owner@example.com",
    displayName: "Owner User",
    username: "owner"
  });
  const viewer = await createUserWithIdentity(testApp.pool, {
    uid: "viewer-firebase-uid",
    email: "viewer@example.com",
    displayName: "Viewer User",
    username: "viewer"
  });
  const stranger = await createUserWithIdentity(testApp.pool, {
    uid: "stranger-firebase-uid",
    email: "stranger@example.com",
    displayName: "Stranger User",
    username: "stranger"
  });

  return { testApp, owner, viewer, stranger };
}

test("POST /service creates a service for the authenticated user", async () => {
  const { testApp, owner } = await createServicesTestContext();

  try {
    const response = await testApp.app.inject({
      method: "POST",
      url: "/service",
      headers: {
        authorization: "Bearer owner-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        title: "Portrait Session",
        description: "Studio portrait photography",
        priceDollars: 175,
        durationMinutes: 90,
        isActive: true
      }
    });

    assert.equal(response.statusCode, 201);
    const body = response.json() as { id: string };
    assert.match(body.id, /^[0-9a-f-]{36}$/);

    const created = await testApp.pool.query(
      `
      SELECT user_id, title, description, price_dollars, duration_minutes, is_active
      FROM services
      WHERE id = $1
      `,
      [body.id]
    );

    assert.equal(created.rowCount, 1);
    assert.equal(created.rows[0].user_id, owner.userId);
    assert.equal(created.rows[0].title, "Portrait Session");
    assert.equal(created.rows[0].description, "Studio portrait photography");
    assert.equal(created.rows[0].price_dollars, 175);
    assert.equal(created.rows[0].duration_minutes, 90);
    assert.equal(created.rows[0].is_active, true);
  } finally {
    await testApp.close();
  }
});

test("POST /service rejects creation after the service limit is reached", async () => {
  const { testApp, owner } = await createServicesTestContext();

  try {
    await createService(testApp.pool, { userId: owner.userId, title: "Service One" });
    await createService(testApp.pool, { userId: owner.userId, title: "Service Two" });
    await createService(testApp.pool, { userId: owner.userId, title: "Service Three" });

    const response = await testApp.app.inject({
      method: "POST",
      url: "/service",
      headers: {
        authorization: "Bearer owner-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        title: "Service Four",
        priceDollars: 200,
        durationMinutes: 60
      }
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: "service_limit_reached" });
  } finally {
    await testApp.close();
  }
});

test("GET /services returns the authenticated user's own services when userIds is omitted", async () => {
  const { testApp, owner, viewer } = await createServicesTestContext();

  try {
    const newest = await createService(testApp.pool, {
      userId: owner.userId,
      title: "Newest Owner Service",
      isActive: false
    });
    const oldest = await createService(testApp.pool, {
      userId: owner.userId,
      title: "Oldest Owner Service",
      isActive: true
    });
    await createService(testApp.pool, {
      userId: viewer.userId,
      title: "Viewer Service",
      isActive: true
    });

    const response = await testApp.app.inject({
      method: "GET",
      url: "/services",
      headers: {
        authorization: "Bearer owner-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as Array<{
      id: string;
      user_id: string;
      title: string;
      is_active: boolean;
    }>;

    assert.equal(body.length, 2);
    assert.equal(body[0].id, oldest.serviceId);
    assert.equal(body[0].title, "Oldest Owner Service");
    assert.equal(body[0].is_active, true);
    assert.equal(body[1].id, newest.serviceId);
    assert.equal(body[1].title, "Newest Owner Service");
    assert.equal(body[1].is_active, false);
    assert.ok(body.every((service) => service.user_id === owner.userId));
  } finally {
    await testApp.close();
  }
});

test("GET /services with userIds only returns active services for discoverable users in the requested set", async () => {
  const { testApp, owner, viewer, stranger } = await createServicesTestContext();

  try {
    await createPhoto(testApp.pool, {
      userId: owner.userId,
      url: "https://example.com/owner-photo.jpg"
    });
    const ownerActive = await createService(testApp.pool, {
      userId: owner.userId,
      title: "Owner Active",
      isActive: true
    });
    await createService(testApp.pool, {
      userId: owner.userId,
      title: "Owner Inactive",
      isActive: false
    });

    await createPhoto(testApp.pool, {
      userId: viewer.userId,
      url: "https://example.com/viewer-photo.jpg"
    });
    const viewerActive = await createService(testApp.pool, {
      userId: viewer.userId,
      title: "Viewer Active",
      isActive: true
    });

    await createService(testApp.pool, {
      userId: stranger.userId,
      title: "Stranger Active But Hidden",
      isActive: true
    });

    const response = await testApp.app.inject({
      method: "GET",
      url: `/services?userIds=${owner.userId},${viewer.userId},${stranger.userId}`,
      headers: {
        authorization: "Bearer owner-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as Array<{
      id: string;
      user_id: string;
      title: string;
      is_active: boolean;
    }>;

    assert.equal(body.length, 2);
    const ids = new Set(body.map((service) => service.id));
    assert.ok(ids.has(ownerActive.serviceId));
    assert.ok(ids.has(viewerActive.serviceId));
    assert.ok(body.every((service) => service.is_active === true));
    assert.ok(!body.some((service) => service.user_id === stranger.userId));
    assert.ok(!body.some((service) => service.title === "Owner Inactive"));
  } finally {
    await testApp.close();
  }
});

test("GET /service/:serviceId returns an owner's inactive service", async () => {
  const { testApp, owner } = await createServicesTestContext();

  try {
    const service = await createService(testApp.pool, {
      userId: owner.userId,
      title: "Inactive Owner Service",
      isActive: false
    });

    const response = await testApp.app.inject({
      method: "GET",
      url: `/service/${service.serviceId}`,
      headers: {
        authorization: "Bearer owner-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as { id: string; title: string; is_active: boolean };
    assert.equal(body.id, service.serviceId);
    assert.equal(body.title, "Inactive Owner Service");
    assert.equal(body.is_active, false);
  } finally {
    await testApp.close();
  }
});

test("GET /service/:serviceId returns an active public service to other users when the owner is discoverable", async () => {
  const { testApp, owner } = await createServicesTestContext();

  try {
    await createPhoto(testApp.pool, {
      userId: owner.userId,
      url: "https://example.com/owner.jpg"
    });
    const service = await createService(testApp.pool, {
      userId: owner.userId,
      title: "Public Service",
      isActive: true
    });

    const response = await testApp.app.inject({
      method: "GET",
      url: `/service/${service.serviceId}`,
      headers: {
        authorization: "Bearer viewer-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as { id: string; title: string; is_active: boolean };
    assert.equal(body.id, service.serviceId);
    assert.equal(body.title, "Public Service");
    assert.equal(body.is_active, true);
  } finally {
    await testApp.close();
  }
});

test("GET /service/:serviceId hides non-public services from other users", async () => {
  const { testApp, owner } = await createServicesTestContext();

  try {
    const hiddenService = await createService(testApp.pool, {
      userId: owner.userId,
      title: "Hidden Service",
      isActive: false
    });

    const hiddenByState = await testApp.app.inject({
      method: "GET",
      url: `/service/${hiddenService.serviceId}`,
      headers: {
        authorization: "Bearer viewer-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(hiddenByState.statusCode, 404);
    assert.deepEqual(hiddenByState.json(), { error: "service_not_found" });

    const activeService = await createService(testApp.pool, {
      userId: owner.userId,
      title: "Photo Gated Service",
      isActive: true
    });

    const hiddenByDiscoverability = await testApp.app.inject({
      method: "GET",
      url: `/service/${activeService.serviceId}`,
      headers: {
        authorization: "Bearer viewer-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(hiddenByDiscoverability.statusCode, 404);
    assert.deepEqual(hiddenByDiscoverability.json(), { error: "service_not_found" });
  } finally {
    await testApp.close();
  }
});

test("PATCH /service/:serviceId updates a service for the owner", async () => {
  const { testApp, owner } = await createServicesTestContext();

  try {
    const service = await createService(testApp.pool, {
      userId: owner.userId,
      title: "Original Title",
      description: "Original description",
      priceDollars: 100,
      durationMinutes: 45,
      isActive: true
    });

    const response = await testApp.app.inject({
      method: "PATCH",
      url: `/service/${service.serviceId}`,
      headers: {
        authorization: "Bearer owner-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        title: "Updated Title",
        description: "Updated description",
        priceDollars: 220,
        durationMinutes: 75,
        isActive: false
      }
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true });

    const updated = await testApp.pool.query(
      `
      SELECT title, description, price_dollars, duration_minutes, is_active
      FROM services
      WHERE id = $1
      `,
      [service.serviceId]
    );

    assert.equal(updated.rowCount, 1);
    assert.equal(updated.rows[0].title, "Updated Title");
    assert.equal(updated.rows[0].description, "Updated description");
    assert.equal(updated.rows[0].price_dollars, 220);
    assert.equal(updated.rows[0].duration_minutes, 75);
    assert.equal(updated.rows[0].is_active, false);
  } finally {
    await testApp.close();
  }
});

test("PATCH /service/:serviceId rejects non-owner updates", async () => {
  const { testApp, owner, stranger } = await createServicesTestContext();

  try {
    const service = await createService(testApp.pool, {
      userId: owner.userId,
      title: "Owner Service"
    });

    const response = await testApp.app.inject({
      method: "PATCH",
      url: `/service/${service.serviceId}`,
      headers: {
        authorization: "Bearer stranger-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        title: "Forbidden Update"
      }
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: "forbidden" });

    const persisted = await testApp.pool.query(
      "SELECT title FROM services WHERE id = $1",
      [service.serviceId]
    );

    assert.equal(persisted.rows[0].title, "Owner Service");
    assert.ok(stranger.userId !== owner.userId);
  } finally {
    await testApp.close();
  }
});

test("PATCH /service/:serviceId returns not found for a missing service", async () => {
  const { testApp } = await createServicesTestContext();

  try {
    const response = await testApp.app.inject({
      method: "PATCH",
      url: "/service/4cb26757-99cc-44b5-bcf8-278ca55f7ecf",
      headers: {
        authorization: "Bearer owner-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        title: "Missing Service"
      }
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: "service_not_found" });
  } finally {
    await testApp.close();
  }
});

test("DELETE /service/:serviceId deletes a service for the owner", async () => {
  const { testApp, owner } = await createServicesTestContext();

  try {
    const service = await createService(testApp.pool, {
      userId: owner.userId,
      title: "Delete Me"
    });

    const response = await testApp.app.inject({
      method: "DELETE",
      url: `/service/${service.serviceId}`,
      headers: {
        authorization: "Bearer owner-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true });

    const persisted = await testApp.pool.query(
      "SELECT id FROM services WHERE id = $1",
      [service.serviceId]
    );

    assert.equal(persisted.rowCount, 0);
  } finally {
    await testApp.close();
  }
});

test("DELETE /service/:serviceId rejects non-owner deletion", async () => {
  const { testApp, owner } = await createServicesTestContext();

  try {
    const service = await createService(testApp.pool, {
      userId: owner.userId,
      title: "Keep Me"
    });

    const response = await testApp.app.inject({
      method: "DELETE",
      url: `/service/${service.serviceId}`,
      headers: {
        authorization: "Bearer viewer-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: "forbidden" });

    const persisted = await testApp.pool.query(
      "SELECT id FROM services WHERE id = $1",
      [service.serviceId]
    );

    assert.equal(persisted.rowCount, 1);
  } finally {
    await testApp.close();
  }
});

test("DELETE /service/:serviceId returns not found for a missing service", async () => {
  const { testApp } = await createServicesTestContext();

  try {
    const response = await testApp.app.inject({
      method: "DELETE",
      url: "/service/6030e5ca-19f9-4b28-b0ea-a8fbb92320a1",
      headers: {
        authorization: "Bearer owner-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: "service_not_found" });
  } finally {
    await testApp.close();
  }
});
