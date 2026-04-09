import test = require("node:test");
import * as assert from "node:assert/strict";
import { createTestApp, buildDecodedToken } from "./helpers/testApp";
import { createService, createUserWithIdentity } from "./helpers/factories";

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

test("GET /events/stream delivers booking create and update events to the affected users", async () => {
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

  const address = await testApp.app.listen({ port: 0, host: "127.0.0.1" });

  try {
    const sellerResponse = await fetch(`${address}/events/stream`, {
      headers: {
        authorization: "Bearer seller-token",
        "x-api-version": testApp.apiVersion
      }
    });
    assert.equal(sellerResponse.status, 200);
    assert.ok(sellerResponse.body);

    const buyerResponse = await fetch(`${address}/events/stream`, {
      headers: {
        authorization: "Bearer buyer-token",
        "x-api-version": testApp.apiVersion
      }
    });
    assert.equal(buyerResponse.status, 200);
    assert.ok(buyerResponse.body);

    const otherResponse = await fetch(`${address}/events/stream`, {
      headers: {
        authorization: "Bearer other-token",
        "x-api-version": testApp.apiVersion
      }
    });
    assert.equal(otherResponse.status, 200);
    assert.ok(otherResponse.body);

    const decoder = new TextDecoder();
    const sellerReader = sellerResponse.body!.getReader();
    const buyerReader = buyerResponse.body!.getReader();
    const otherReader = otherResponse.body!.getReader();
    const sellerState = { buffer: "" };
    const buyerState = { buffer: "" };
    const otherState = { buffer: "" };

    assert.equal((await readNextEvent(sellerReader, decoder, sellerState)).event, "ready");
    assert.equal((await readNextEvent(buyerReader, decoder, buyerState)).event, "ready");
    assert.equal((await readNextEvent(otherReader, decoder, otherState)).event, "ready");

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

    const sellerCreateEvent = await readNextEvent(sellerReader, decoder, sellerState);
    assert.equal(sellerCreateEvent.event, "booking.created");
    assert.deepEqual(sellerCreateEvent.data.data, { booking_id: bookingId });

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

    const sellerUpdateEvent = await readNextEvent(sellerReader, decoder, sellerState);
    const buyerUpdateEvent = await readNextEvent(buyerReader, decoder, buyerState);

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

    otherReader.cancel();
    buyerReader.cancel();
    sellerReader.cancel();
  } finally {
    await testApp.close();
  }
});
