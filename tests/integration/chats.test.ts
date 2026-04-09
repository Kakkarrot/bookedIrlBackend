import test = require("node:test");
import * as assert from "node:assert/strict";
import { buildDecodedToken, createTestApp } from "./helpers/testApp";
import { createService, createUserWithIdentity } from "./helpers/factories";

async function createChatsTestContext() {
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

  const createResponse = await testApp.app.inject({
    method: "POST",
    url: "/bookings",
    headers: {
      authorization: "Bearer buyer-token",
      "x-api-version": testApp.apiVersion
    },
    payload: {
      serviceId: service.serviceId,
      requestedDate: "2026-04-25",
      timeOfDay: "afternoon"
    }
  });

  assert.equal(createResponse.statusCode, 201);
  const { id: bookingId } = createResponse.json() as { id: string };

  const acceptResponse = await testApp.app.inject({
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

  assert.equal(acceptResponse.statusCode, 200);

  const chatResult = await testApp.pool.query<{ id: string }>(
    "SELECT id FROM chats WHERE buyer_id = $1 AND seller_id = $2",
    [buyer.userId, seller.userId]
  );

  assert.equal(chatResult.rowCount, 1);

  return {
    testApp,
    buyer,
    seller,
    chatId: chatResult.rows[0].id
  };
}

test("GET /chats exposes unseen state for newly created chats and clears it after read", async () => {
  const { testApp, chatId } = await createChatsTestContext();

  try {
    const buyerChatsResponse = await testApp.app.inject({
      method: "GET",
      url: "/chats",
      headers: {
        authorization: "Bearer buyer-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(buyerChatsResponse.statusCode, 200);
    const buyerChats = buyerChatsResponse.json() as Array<{
      id: string;
      unread_count: number;
      is_unseen: boolean;
    }>;

    assert.equal(buyerChats.length, 1, buyerChatsResponse.body);
    assert.equal(buyerChats[0].id, chatId);
    assert.equal(buyerChats[0].unread_count, 0);
    assert.equal(buyerChats[0].is_unseen, true);

    const markReadResponse = await testApp.app.inject({
      method: "POST",
      url: `/chats/${chatId}/read`,
      headers: {
        authorization: "Bearer buyer-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(markReadResponse.statusCode, 200);

    const buyerChatsAfterReadResponse = await testApp.app.inject({
      method: "GET",
      url: "/chats",
      headers: {
        authorization: "Bearer buyer-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(buyerChatsAfterReadResponse.statusCode, 200);
    const buyerChatsAfterRead = buyerChatsAfterReadResponse.json() as Array<{
      id: string;
      unread_count: number;
      is_unseen: boolean;
    }>;

    assert.equal(buyerChatsAfterRead.length, 1, buyerChatsAfterReadResponse.body);
    assert.equal(buyerChatsAfterRead[0].id, chatId);
    assert.equal(buyerChatsAfterRead[0].unread_count, 0);
    assert.equal(buyerChatsAfterRead[0].is_unseen, false);
  } finally {
    await testApp.close();
  }
});

test("GET /chats reflects unread message counts for the other participant only", async () => {
  const { testApp, chatId } = await createChatsTestContext();

  try {
    const sendMessageResponse = await testApp.app.inject({
      method: "POST",
      url: `/chats/${chatId}/messages`,
      headers: {
        authorization: "Bearer buyer-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        body: "Hello from the buyer"
      }
    });

    assert.equal(sendMessageResponse.statusCode, 201);

    const sellerChatsResponse = await testApp.app.inject({
      method: "GET",
      url: "/chats",
      headers: {
        authorization: "Bearer seller-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(sellerChatsResponse.statusCode, 200);
    const sellerChats = sellerChatsResponse.json() as Array<{
      id: string;
      unread_count: number;
      is_unseen: boolean;
      last_message_body: string | null;
    }>;

    assert.equal(sellerChats.length, 1);
    assert.equal(sellerChats[0].id, chatId);
    assert.equal(sellerChats[0].unread_count, 1);
    assert.equal(sellerChats[0].is_unseen, true);
    assert.equal(sellerChats[0].last_message_body, "Hello from the buyer");

    const buyerChatsResponse = await testApp.app.inject({
      method: "GET",
      url: "/chats",
      headers: {
        authorization: "Bearer buyer-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(buyerChatsResponse.statusCode, 200);
    const buyerChats = buyerChatsResponse.json() as Array<{
      id: string;
      unread_count: number;
      is_unseen: boolean;
      last_message_body: string | null;
    }>;

    assert.equal(buyerChats.length, 1);
    assert.equal(buyerChats[0].id, chatId);
    assert.equal(buyerChats[0].unread_count, 0);
    assert.equal(buyerChats[0].is_unseen, true);
    assert.equal(buyerChats[0].last_message_body, "Hello from the buyer");
  } finally {
    await testApp.close();
  }
});
