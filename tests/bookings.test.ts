import test = require("node:test");
import * as assert from "node:assert/strict";
import { createTestApp, buildDecodedToken } from "./helpers/testApp";
import { createService, createUserWithIdentity } from "./helpers/factories";

async function createBookingsTestContext() {
  const tokenToUid = new Map([
    ["buyer-token", "buyer-firebase-uid"],
    ["seller-token", "seller-firebase-uid"]
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

  const buyer = await createUserWithIdentity(testApp.pool, {
    uid: "buyer-firebase-uid",
    email: "buyer@example.com",
    username: "buyer"
  });
  const seller = await createUserWithIdentity(testApp.pool, {
    uid: "seller-firebase-uid",
    email: "seller@example.com",
    username: "seller"
  });
  const service = await createService(testApp.pool, {
    userId: seller.userId,
    title: "Portrait Session",
    priceDollars: 175,
    durationMinutes: 90,
    isActive: true
  });

  return {
    testApp,
    buyer,
    seller,
    service
  };
}

test("POST /bookings rejects duplicate open bookings between the same buyer and seller", async () => {
  const { testApp, buyer, seller, service } = await createBookingsTestContext();

  try {
    const firstResponse = await testApp.app.inject({
      method: "POST",
      url: "/bookings",
      headers: {
        authorization: "Bearer buyer-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        serviceId: service.serviceId,
        requestedDate: "2026-04-15",
        timeOfDay: "evening",
        note: "First request"
      }
    });

    assert.equal(firstResponse.statusCode, 201);
    const firstBody = firstResponse.json() as { id: string };
    assert.match(firstBody.id, /^[0-9a-f-]{36}$/);

    const duplicateResponse = await testApp.app.inject({
      method: "POST",
      url: "/bookings",
      headers: {
        authorization: "Bearer buyer-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        serviceId: service.serviceId,
        requestedDate: "2026-04-16",
        timeOfDay: "morning",
        note: "Duplicate request"
      }
    });

    assert.equal(duplicateResponse.statusCode, 409);
    assert.deepEqual(duplicateResponse.json(), { error: "booking_already_exists" });

    const bookings = await testApp.pool.query(
      `
      SELECT
        buyer_id,
        seller_id,
        service_id,
        status,
        requested_date::text AS requested_date,
        time_of_day,
        note,
        service_title,
        service_price_dollars,
        service_duration_minutes
      FROM bookings
      ORDER BY created_at ASC
      `
    );

    assert.equal(bookings.rowCount, 1);
    assert.equal(bookings.rows[0].buyer_id, buyer.userId);
    assert.equal(bookings.rows[0].seller_id, seller.userId);
    assert.equal(bookings.rows[0].service_id, service.serviceId);
    assert.equal(bookings.rows[0].status, "requested");
    assert.equal(bookings.rows[0].requested_date, "2026-04-15");
    assert.equal(bookings.rows[0].time_of_day, "evening");
    assert.equal(bookings.rows[0].note, "First request");
    assert.equal(bookings.rows[0].service_title, "Portrait Session");
    assert.equal(bookings.rows[0].service_price_dollars, 175);
    assert.equal(bookings.rows[0].service_duration_minutes, 90);
  } finally {
    await testApp.close();
  }
});

test("PATCH /bookings/:bookingId only allows the seller to accept and blocks later transitions", async () => {
  const { testApp, buyer, service } = await createBookingsTestContext();

  try {
    const createResponse = await testApp.app.inject({
      method: "POST",
      url: "/bookings",
      headers: {
        authorization: "Bearer buyer-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        serviceId: service.serviceId,
        requestedDate: "2026-04-20",
        timeOfDay: "afternoon",
        note: "Please confirm"
      }
    });

    assert.equal(createResponse.statusCode, 201);
    const { id: bookingId } = createResponse.json() as { id: string };

    const buyerUpdateResponse = await testApp.app.inject({
      method: "PATCH",
      url: `/bookings/${bookingId}`,
      headers: {
        authorization: "Bearer buyer-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        status: "accepted"
      }
    });

    assert.equal(buyerUpdateResponse.statusCode, 403);
    assert.deepEqual(buyerUpdateResponse.json(), { error: "forbidden" });

    const sellerAcceptResponse = await testApp.app.inject({
      method: "PATCH",
      url: `/bookings/${bookingId}`,
      headers: {
        authorization: "Bearer seller-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        status: "accepted"
      }
    });

    assert.equal(sellerAcceptResponse.statusCode, 200);
    assert.deepEqual(sellerAcceptResponse.json(), { ok: true });

    const secondTransitionResponse = await testApp.app.inject({
      method: "PATCH",
      url: `/bookings/${bookingId}`,
      headers: {
        authorization: "Bearer seller-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        status: "declined"
      }
    });

    assert.equal(secondTransitionResponse.statusCode, 400);
    assert.deepEqual(secondTransitionResponse.json(), { error: "invalid_status_transition" });

    const bookingResult = await testApp.pool.query(
      `
      SELECT buyer_id, status, requested_date::text AS requested_date, time_of_day, note
      FROM bookings
      WHERE id = $1
      `,
      [bookingId]
    );

    assert.equal(bookingResult.rowCount, 1);
    assert.equal(bookingResult.rows[0].buyer_id, buyer.userId);
    assert.equal(bookingResult.rows[0].status, "accepted");
    assert.equal(bookingResult.rows[0].requested_date, "2026-04-20");
    assert.equal(bookingResult.rows[0].time_of_day, "afternoon");
    assert.equal(bookingResult.rows[0].note, "Please confirm");
  } finally {
    await testApp.close();
  }
});
