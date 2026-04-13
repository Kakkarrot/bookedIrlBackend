import test = require("node:test");
import * as assert from "node:assert/strict";
import { createTestApp, buildDecodedToken } from "./helpers/testApp";
import { createService, createUserWithIdentity } from "./helpers/factories";
import { createLiveServerHarness } from "./helpers/liveServer";

function parseSseBlock(block: string) {
  const lines = block.split("\n").filter(Boolean);
  const eventLine = lines.find((line) => line.startsWith("event: "));
  const dataLine = lines.find((line) => line.startsWith("data: "));

  return {
    event: eventLine ? eventLine.slice("event: ".length) : null,
    data: dataLine ? JSON.parse(dataLine.slice("data: ".length)) : null
  };
}

async function readNextEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  state: { buffer: string }
) {
  while (!state.buffer.includes("\n\n")) {
    const result = await reader.read();
    if (result.done) {
      throw new Error("SSE stream ended before the next event arrived");
    }
    state.buffer += decoder.decode(result.value, { stream: true });
  }

  const separatorIndex = state.buffer.indexOf("\n\n");
  const block = state.buffer.slice(0, separatorIndex);
  state.buffer = state.buffer.slice(separatorIndex + 2);
  return parseSseBlock(block);
}

async function waitForEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  state: { buffer: string },
  expectedEvent: string
) {
  while (true) {
    const event = await readNextEvent(reader, decoder, state);
    if (event.event === expectedEvent) {
      return event;
    }
  }
}

test("GET /events/stream delivers booking and chat events to the affected users", async () => {
  const tokenToUid = new Map([
    ["buyer-token", "buyer-firebase-uid"],
    ["seller-token", "seller-firebase-uid"],
    ["other-token", "other-firebase-uid"]
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
  await createUserWithIdentity(testApp.pool, {
    uid: "other-firebase-uid",
    email: "other@example.com",
    username: "other"
  });
  const service = await createService(testApp.pool, {
    userId: seller.userId,
    title: "Portrait Session",
    priceDollars: 175,
    durationMinutes: 90,
    isActive: true
  });

  let sellerReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let buyerReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let otherReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const liveServer = await createLiveServerHarness(testApp.app);
  let sellerStream: Awaited<ReturnType<typeof liveServer.openEventStream>> | null = null;
  let buyerStream: Awaited<ReturnType<typeof liveServer.openEventStream>> | null = null;
  let otherStream: Awaited<ReturnType<typeof liveServer.openEventStream>> | null = null;

  try {
    sellerStream = await liveServer.openEventStream("seller-token", testApp.apiVersion);
    buyerStream = await liveServer.openEventStream("buyer-token", testApp.apiVersion);
    otherStream = await liveServer.openEventStream("other-token", testApp.apiVersion);

    const decoder = new TextDecoder();
    sellerReader = sellerStream.reader;
    buyerReader = buyerStream.reader;
    otherReader = otherStream.reader;
    const sellerState = { buffer: "" };
    const buyerState = { buffer: "" };
    const otherState = { buffer: "" };

    assert.equal((await readNextEvent(sellerReader, decoder, sellerState)).event, "ready");
    assert.equal((await readNextEvent(buyerReader, decoder, buyerState)).event, "ready");
    assert.equal((await readNextEvent(otherReader, decoder, otherState)).event, "ready");

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

    const sellerCreateEvent = await waitForEvent(
      sellerReader,
      decoder,
      sellerState,
      "booking.created"
    );
    assert.equal(sellerCreateEvent.event, "booking.created");
    assert.deepEqual(sellerCreateEvent.data.data, { booking_id: bookingId });

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

    const sellerUpdateEvent = await waitForEvent(
      sellerReader,
      decoder,
      sellerState,
      "booking.updated"
    );
    const buyerUpdateEvent = await waitForEvent(
      buyerReader,
      decoder,
      buyerState,
      "booking.updated"
    );

    assert.equal(sellerUpdateEvent.event, "booking.updated");
    assert.deepEqual(sellerUpdateEvent.data.data, {
      booking_id: bookingId,
      status: "accepted"
    });
    assert.equal(buyerUpdateEvent.event, "booking.updated");
    assert.deepEqual(buyerUpdateEvent.data.data, {
      booking_id: bookingId,
      status: "accepted"
    });

    const sellerChatCreatedEvent = await waitForEvent(
      sellerReader,
      decoder,
      sellerState,
      "chat.created"
    );
    const buyerChatCreatedEvent = await waitForEvent(
      buyerReader,
      decoder,
      buyerState,
      "chat.created"
    );

    assert.equal(sellerChatCreatedEvent.event, "chat.created");
    assert.equal(buyerChatCreatedEvent.event, "chat.created");
    assert.equal(
      typeof sellerChatCreatedEvent.data.data.chat_id,
      "string"
    );
    assert.equal(
      sellerChatCreatedEvent.data.data.chat_id,
      buyerChatCreatedEvent.data.data.chat_id
    );

    const chatId = sellerChatCreatedEvent.data.data.chat_id as string;

    const sendMessageResponse = await testApp.app.inject({
      method: "POST",
      url: `/chats/${chatId}/messages`,
      headers: {
        authorization: "Bearer buyer-token",
        "x-api-version": testApp.apiVersion
      },
      payload: {
        body: "Hello from realtime"
      }
    });

    assert.equal(sendMessageResponse.statusCode, 201);
    const { id: messageId } = sendMessageResponse.json() as { id: string };

    const sellerMessageEvent = await waitForEvent(
      sellerReader,
      decoder,
      sellerState,
      "chat.message_created"
    );
    const buyerMessageEvent = await waitForEvent(
      buyerReader,
      decoder,
      buyerState,
      "chat.message_created"
    );

    assert.equal(sellerMessageEvent.event, "chat.message_created");
    assert.deepEqual(sellerMessageEvent.data.data, {
      chat_id: chatId,
      message_id: messageId,
      sender_user_id: buyer.userId
    });
    assert.equal(buyerMessageEvent.event, "chat.message_created");
    assert.deepEqual(buyerMessageEvent.data.data, {
      chat_id: chatId,
      message_id: messageId,
      sender_user_id: buyer.userId
    });

    const markReadResponse = await testApp.app.inject({
      method: "POST",
      url: `/chats/${chatId}/read`,
      headers: {
        authorization: "Bearer seller-token",
        "x-api-version": testApp.apiVersion
      }
    });

    assert.equal(markReadResponse.statusCode, 200);

    const sellerReadEvent = await waitForEvent(
      sellerReader,
      decoder,
      sellerState,
      "chat.read_updated"
    );

    assert.equal(sellerReadEvent.event, "chat.read_updated");
    assert.deepEqual(sellerReadEvent.data.data, {
      chat_id: chatId,
      reader_user_id: seller.userId
    });

  } finally {
    await Promise.allSettled([
      otherStream?.close(),
      buyerStream?.close(),
      sellerStream?.close()
    ]);
    await liveServer.close();
    await testApp.close();
  }
});
