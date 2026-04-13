import test = require("node:test");
import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

test("GET /bookings returns the seller inbox with buyer preview data", async () => {
  const tokenToUid = new Map([
    ["seller-token", "seller-firebase-uid"],
    ["buyer-one-token", "buyer-one-firebase-uid"],
    ["buyer-two-token", "buyer-two-firebase-uid"],
    ["other-seller-token", "other-seller-firebase-uid"]
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

  try {
    const seller = await createUserWithIdentity(testApp.pool, {
      uid: "seller-firebase-uid",
      email: "seller@example.com",
      username: "seller"
    });
    const otherSeller = await createUserWithIdentity(testApp.pool, {
      uid: "other-seller-firebase-uid",
      email: "other-seller@example.com",
      username: "other-seller"
    });
    const buyerOne = await createUserWithIdentity(testApp.pool, {
      uid: "buyer-one-firebase-uid",
      email: "buyer-one@example.com",
      username: "buyer-one",
      displayName: "Buyer One"
    });
    const buyerTwo = await createUserWithIdentity(testApp.pool, {
      uid: "buyer-two-firebase-uid",
      email: "buyer-two@example.com",
      username: "buyer-two",
      displayName: "Buyer Two"
    });

    await testApp.pool.query(
      "INSERT INTO user_photos (id, user_id, url, sort_order) VALUES ($1, $2, $3, 0)",
      [randomUUID(), buyerOne.userId, "https://example.com/buyer-one.jpg"]
    );

    const sellerService = await createService(testApp.pool, {
      userId: seller.userId,
      title: "Seller Service",
      priceDollars: 175,
      durationMinutes: 90,
      isActive: true
    });
    const otherSellerService = await createService(testApp.pool, {
      userId: otherSeller.userId,
      title: "Other Seller Service",
      priceDollars: 220,
      durationMinutes: 60,
      isActive: true
    });

    const firstCreateResponse = await testApp.app.inject({
      method: "POST",
      url: "/booking",
      headers: {
        authorization: "Bearer buyer-one-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        serviceId: sellerService.serviceId,
        requestedDate: "2026-04-10",
        timeOfDay: "morning",
        note: "First seller booking"
      }
    });

    assert.equal(firstCreateResponse.statusCode, 201);

    const secondCreateResponse = await testApp.app.inject({
      method: "POST",
      url: "/booking",
      headers: {
        authorization: "Bearer buyer-two-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        serviceId: otherSellerService.serviceId,
        requestedDate: "2026-04-11",
        timeOfDay: "afternoon",
        note: "Other seller booking"
      }
    });

    assert.equal(secondCreateResponse.statusCode, 201);

    const inboxResponse = await testApp.app.inject({
      method: "GET",
      url: "/bookings?limit=10&offset=0",
      headers: {
        authorization: "Bearer seller-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(inboxResponse.statusCode, 200);
    const inbox = inboxResponse.json() as Array<{
      buyer: {
        id: string;
        display_name: string | null;
        username: string | null;
        photo_url: string | null;
      };
      buyer_id: string;
      seller_id: string;
      service_id: string;
      service_title: string;
      service_price_dollars: number;
      service_duration_minutes: number;
      status: string;
      requested_date: string;
      time_of_day: string;
      note: string | null;
    }>;

    assert.equal(inbox.length, 1, inboxResponse.body);
    assert.equal(inbox[0].buyer_id, buyerOne.userId);
    assert.equal(inbox[0].seller_id, seller.userId);
    assert.equal(inbox[0].service_id, sellerService.serviceId);
    assert.equal(inbox[0].service_title, "Seller Service");
    assert.equal(inbox[0].service_price_dollars, 175);
    assert.equal(inbox[0].service_duration_minutes, 90);
    assert.equal(inbox[0].status, "requested");
    assert.equal(inbox[0].requested_date, "2026-04-10");
    assert.equal(inbox[0].time_of_day, "morning");
    assert.equal(inbox[0].note, "First seller booking");
    assert.equal(inbox[0].buyer.id, buyerOne.userId);
    assert.equal(inbox[0].buyer.display_name, "Buyer One");
    assert.equal(inbox[0].buyer.username, "buyer-one");
    assert.equal(inbox[0].buyer.photo_url, "https://example.com/buyer-one.jpg");
  } finally {
    await testApp.close();
  }
});

test("POST /booking rejects duplicate open bookings between the same buyer and seller", async () => {
  const { testApp, buyer, seller, service } = await createBookingsTestContext();

  try {
    const firstResponse = await testApp.app.inject({
      method: "POST",
      url: "/booking",
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
      url: "/booking",
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

test("POST /booking returns cannot_book_own_service before generic availability errors", async () => {
  const tokenToUid = new Map([["seller-token", "seller-firebase-uid"]]);

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
    const seller = await createUserWithIdentity(testApp.pool, {
      uid: "seller-firebase-uid",
      email: "seller@example.com",
      username: "seller"
    });
    const service = await createService(testApp.pool, {
      userId: seller.userId,
      title: "Inactive Self Service",
      isActive: false
    });

    const response = await testApp.app.inject({
      method: "POST",
      url: "/booking",
      headers: {
        authorization: "Bearer seller-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        serviceId: service.serviceId,
        requestedDate: "2026-04-30",
        timeOfDay: "morning"
      }
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: "cannot_book_own_service" });
  } finally {
    await testApp.close();
  }
});

test("PATCH /booking/:bookingId only allows the seller to accept and blocks later transitions", async () => {
  const { testApp, buyer, service } = await createBookingsTestContext();

  try {
    const createResponse = await testApp.app.inject({
      method: "POST",
      url: "/booking",
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
      url: `/booking/${bookingId}`,
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
      url: `/booking/${bookingId}`,
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
      url: `/booking/${bookingId}`,
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

test("PATCH /booking/:bookingId creates a chat when the seller accepts the booking", async () => {
  const { testApp, buyer, seller, service } = await createBookingsTestContext();

  try {
    const createResponse = await testApp.app.inject({
      method: "POST",
      url: "/booking",
      headers: {
        authorization: "Bearer buyer-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        serviceId: service.serviceId,
        requestedDate: "2026-04-22",
        timeOfDay: "night",
        note: "Let's lock this in"
      }
    });

    assert.equal(createResponse.statusCode, 201);
    const { id: bookingId } = createResponse.json() as { id: string };

    const acceptResponse = await testApp.app.inject({
      method: "PATCH",
      url: `/booking/${bookingId}`,
      headers: {
        authorization: "Bearer seller-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        status: "accepted"
      }
    });

    assert.equal(acceptResponse.statusCode, 200);
    assert.deepEqual(acceptResponse.json(), { ok: true });

    const chatsResult = await testApp.pool.query(
      `
      SELECT booking_id, participant_a, participant_b
      FROM chats
      ORDER BY created_at ASC
      `
    );

    assert.equal(chatsResult.rowCount, 1);
    assert.equal(chatsResult.rows[0].booking_id, bookingId);

    const orderedParticipants = [buyer.userId, seller.userId].sort();
    assert.equal(chatsResult.rows[0].participant_a, orderedParticipants[0]);
    assert.equal(chatsResult.rows[0].participant_b, orderedParticipants[1]);

    const bookingResult = await testApp.pool.query(
      "SELECT status FROM bookings WHERE id = $1",
      [bookingId]
    );

    assert.equal(bookingResult.rowCount, 1);
    assert.equal(bookingResult.rows[0].status, "accepted");
  } finally {
    await testApp.close();
  }
});

test("PATCH /booking/:bookingId keeps chat creation idempotent after acceptance", async () => {
  const { testApp, buyer, seller, service } = await createBookingsTestContext();

  try {
    const createResponse = await testApp.app.inject({
      method: "POST",
      url: "/booking",
      headers: {
        authorization: "Bearer buyer-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        serviceId: service.serviceId,
        requestedDate: "2026-04-24",
        timeOfDay: "morning",
        note: "Please accept"
      }
    });

    assert.equal(createResponse.statusCode, 201);
    const { id: bookingId } = createResponse.json() as { id: string };

    const firstAcceptResponse = await testApp.app.inject({
      method: "PATCH",
      url: `/booking/${bookingId}`,
      headers: {
        authorization: "Bearer seller-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        status: "accepted"
      }
    });

    assert.equal(firstAcceptResponse.statusCode, 200);
    assert.deepEqual(firstAcceptResponse.json(), { ok: true });

    const chatsAfterFirstAccept = await testApp.pool.query(
      `
      SELECT id, booking_id, participant_a, participant_b
      FROM chats
      ORDER BY created_at ASC
      `
    );

    assert.equal(chatsAfterFirstAccept.rowCount, 1);
    const createdChat = chatsAfterFirstAccept.rows[0];
    assert.equal(createdChat.booking_id, bookingId);
    const orderedParticipants = [buyer.userId, seller.userId].sort();
    assert.equal(createdChat.participant_a, orderedParticipants[0]);
    assert.equal(createdChat.participant_b, orderedParticipants[1]);

    const repeatedAcceptResponse = await testApp.app.inject({
      method: "PATCH",
      url: `/booking/${bookingId}`,
      headers: {
        authorization: "Bearer seller-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        status: "accepted"
      }
    });

    assert.equal(repeatedAcceptResponse.statusCode, 400);
    assert.deepEqual(repeatedAcceptResponse.json(), { error: "invalid_status_transition" });

    const chatsAfterRepeatedAccept = await testApp.pool.query(
      `
      SELECT id, booking_id, participant_a, participant_b
      FROM chats
      ORDER BY created_at ASC
      `
    );

    assert.equal(chatsAfterRepeatedAccept.rowCount, 1);
    assert.equal(chatsAfterRepeatedAccept.rows[0].id, createdChat.id);
    assert.equal(chatsAfterRepeatedAccept.rows[0].booking_id, bookingId);
    assert.equal(chatsAfterRepeatedAccept.rows[0].participant_a, orderedParticipants[0]);
    assert.equal(chatsAfterRepeatedAccept.rows[0].participant_b, orderedParticipants[1]);

    const bookingResult = await testApp.pool.query(
      "SELECT status FROM bookings WHERE id = $1",
      [bookingId]
    );

    assert.equal(bookingResult.rowCount, 1);
    assert.equal(bookingResult.rows[0].status, "accepted");
  } finally {
    await testApp.close();
  }
});

test("PATCH /booking/:bookingId rejects acceptance when a chat already exists for the pair", async () => {
  const { testApp, buyer, seller, service } = await createBookingsTestContext();

  try {
    const orderedParticipants = [buyer.userId, seller.userId].sort();
    const existingBookingId = "22222222-2222-2222-2222-222222222222";
    await testApp.pool.query(
      `
      INSERT INTO bookings (
        id, buyer_id, seller_id, participant_a, participant_b, service_id,
        service_title, service_price_dollars, service_duration_minutes,
        status, requested_date, time_of_day, note
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'declined', $10, $11, $12)
      `,
      [
        existingBookingId,
        buyer.userId,
        seller.userId,
        orderedParticipants[0],
        orderedParticipants[1],
        service.serviceId,
        "Portrait Session",
        175,
        90,
        "2026-04-20",
        "morning",
        "Historical booking"
      ]
    );
    await testApp.pool.query(
      `
      INSERT INTO chats (id, booking_id, participant_a, participant_b, last_message_at)
      VALUES ($1, $2, $3, $4, now())
      `,
      [
        "11111111-1111-1111-1111-111111111111",
        existingBookingId,
        orderedParticipants[0],
        orderedParticipants[1]
      ]
    );

    const createResponse = await testApp.app.inject({
      method: "POST",
      url: "/booking",
      headers: {
        authorization: "Bearer buyer-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        serviceId: service.serviceId,
        requestedDate: "2026-04-26",
        timeOfDay: "evening",
        note: "Should fail on accept"
      }
    });

    assert.equal(createResponse.statusCode, 201);
    const { id: bookingId } = createResponse.json() as { id: string };

    const acceptResponse = await testApp.app.inject({
      method: "PATCH",
      url: `/booking/${bookingId}`,
      headers: {
        authorization: "Bearer seller-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        status: "accepted"
      }
    });

    assert.equal(acceptResponse.statusCode, 409);
    assert.deepEqual(acceptResponse.json(), { error: "chat_already_exists" });

    const bookingResult = await testApp.pool.query(
      "SELECT status FROM bookings WHERE id = $1",
      [bookingId]
    );

    assert.equal(bookingResult.rowCount, 1);
    assert.equal(bookingResult.rows[0].status, "requested");
  } finally {
    await testApp.close();
  }
});
