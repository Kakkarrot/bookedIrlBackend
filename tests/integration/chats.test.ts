import test = require("node:test");
import * as assert from "node:assert/strict";
import { buildDecodedToken, createTestApp } from "./helpers/testApp";
import { createService, createUserWithIdentity } from "./helpers/factories";

async function createChatsTestContext() {
  const tokenToUid = new Map([
    ["buyer-token", "buyer-firebase-uid"],
    ["seller-token", "seller-firebase-uid"],
    ["outsider-token", "outsider-firebase-uid"]
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
  const outsider = await createUserWithIdentity(testApp.pool, {
    uid: "outsider-firebase-uid",
    email: "outsider@example.com",
    username: "outsider"
  });

  const createResponse = await testApp.app.inject({
    method: "POST",
    url: "/booking",
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

  const chatResult = await testApp.pool.query<{ id: string }>(
    "SELECT id FROM chats WHERE booking_id = $1",
    [bookingId]
  );

  assert.equal(chatResult.rowCount, 1);

  return {
    testApp,
    buyer,
    seller,
    outsider,
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

test("GET /chats/:id/messages returns messages oldest-first and respects limit", async () => {
  const { testApp, chatId, buyer, seller } = await createChatsTestContext();

  try {
    const firstMessageResponse = await testApp.app.inject({
      method: "POST",
      url: `/chats/${chatId}/messages`,
      headers: {
        authorization: "Bearer buyer-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        body: "First message"
      }
    });

    assert.equal(firstMessageResponse.statusCode, 201);

    const secondMessageResponse = await testApp.app.inject({
      method: "POST",
      url: `/chats/${chatId}/messages`,
      headers: {
        authorization: "Bearer seller-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        body: "Second message"
      }
    });

    assert.equal(secondMessageResponse.statusCode, 201);

    const listResponse = await testApp.app.inject({
      method: "GET",
      url: `/chats/${chatId}/messages?limit=1`,
      headers: {
        authorization: "Bearer buyer-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(listResponse.statusCode, 200);
    const messages = listResponse.json() as Array<{
      sender_id: string;
      body: string;
    }>;

    assert.equal(messages.length, 1, listResponse.body);
    assert.equal(messages[0].sender_id, seller.userId);
    assert.equal(messages[0].body, "Second message");

    const allMessagesResponse = await testApp.app.inject({
      method: "GET",
      url: `/chats/${chatId}/messages?limit=10`,
      headers: {
        authorization: "Bearer buyer-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(allMessagesResponse.statusCode, 200);
    const allMessages = allMessagesResponse.json() as Array<{
      sender_id: string;
      body: string;
    }>;

    assert.equal(allMessages.length, 2, allMessagesResponse.body);
    assert.equal(allMessages[0].sender_id, buyer.userId);
    assert.equal(allMessages[0].body, "First message");
    assert.equal(allMessages[1].sender_id, seller.userId);
    assert.equal(allMessages[1].body, "Second message");
  } finally {
    await testApp.close();
  }
});

test("GET /chats/:id/messages rejects non-participants", async () => {
  const { testApp, chatId } = await createChatsTestContext();

  try {
    const response = await testApp.app.inject({
      method: "GET",
      url: `/chats/${chatId}/messages`,
      headers: {
        authorization: "Bearer outsider-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: "forbidden" });
  } finally {
    await testApp.close();
  }
});

test("GET /chats/:id/messages rejects missing chats", async () => {
  const { testApp } = await createChatsTestContext();

  try {
    const response = await testApp.app.inject({
      method: "GET",
      url: "/chats/00000000-0000-0000-0000-000000000000/messages",
      headers: {
        authorization: "Bearer buyer-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: "chat_not_found" });
  } finally {
    await testApp.close();
  }
});

test("POST /chats/:id/messages rejects non-participants", async () => {
  const { testApp, chatId } = await createChatsTestContext();

  try {
    const response = await testApp.app.inject({
      method: "POST",
      url: `/chats/${chatId}/messages`,
      headers: {
        authorization: "Bearer outsider-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        body: "I should not be allowed in this chat"
      }
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: "forbidden" });

    const messagesResult = await testApp.pool.query(
      "SELECT id FROM messages WHERE chat_id = $1",
      [chatId]
    );

    assert.equal(messagesResult.rowCount, 0);
  } finally {
    await testApp.close();
  }
});

test("POST /chats/:id/messages rejects missing chats", async () => {
  const { testApp } = await createChatsTestContext();

  try {
    const response = await testApp.app.inject({
      method: "POST",
      url: "/chats/00000000-0000-0000-0000-000000000000/messages",
      headers: {
        authorization: "Bearer buyer-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        body: "This chat does not exist"
      }
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: "chat_not_found" });
  } finally {
    await testApp.close();
  }
});
