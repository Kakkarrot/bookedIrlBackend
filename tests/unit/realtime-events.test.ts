import test = require("node:test");
import * as assert from "node:assert/strict";
import {
  buildBookingCreatedEvent,
  buildBookingUpdatedEvent,
  buildChatCreatedEvent,
  buildChatMessageCreatedEvent,
  buildChatReadUpdatedEvent,
  encodeSseEvent
} from "../../src/lib/realtimeEvents";

test("buildBookingCreatedEvent targets only the seller and keeps payload minimal", () => {
  const event = buildBookingCreatedEvent({
    bookingId: "booking-1",
    sellerUserId: "seller-1"
  });

  assert.deepEqual(event.recipients, ["seller-1"]);
  assert.equal(event.event.type, "booking.created");
  assert.deepEqual(event.event.data, { booking_id: "booking-1" });
});

test("buildBookingUpdatedEvent targets both participants with the new status", () => {
  const event = buildBookingUpdatedEvent({
    bookingId: "booking-2",
    buyerUserId: "buyer-1",
    sellerUserId: "seller-1",
    status: "accepted"
  });

  assert.deepEqual(event.recipients, ["buyer-1", "seller-1"]);
  assert.equal(event.event.type, "booking.updated");
  assert.deepEqual(event.event.data, {
    booking_id: "booking-2",
    status: "accepted"
  });
});

test("buildChatCreatedEvent targets both participants with the chat id", () => {
  const event = buildChatCreatedEvent({
    chatId: "chat-1",
    buyerUserId: "buyer-1",
    sellerUserId: "seller-1"
  });

  assert.deepEqual(event.recipients, ["buyer-1", "seller-1"]);
  assert.equal(event.event.type, "chat.created");
  assert.deepEqual(event.event.data, { chat_id: "chat-1" });
});

test("buildChatMessageCreatedEvent targets both participants with sender and message metadata", () => {
  const event = buildChatMessageCreatedEvent({
    chatId: "chat-2",
    buyerUserId: "buyer-1",
    sellerUserId: "seller-1",
    messageId: "message-1",
    senderUserId: "buyer-1"
  });

  assert.deepEqual(event.recipients, ["buyer-1", "seller-1"]);
  assert.equal(event.event.type, "chat.message_created");
  assert.deepEqual(event.event.data, {
    chat_id: "chat-2",
    message_id: "message-1",
    sender_user_id: "buyer-1"
  });
});

test("buildChatReadUpdatedEvent targets only the reading user", () => {
  const event = buildChatReadUpdatedEvent({
    chatId: "chat-3",
    readerUserId: "buyer-1"
  });

  assert.deepEqual(event.recipients, ["buyer-1"]);
  assert.equal(event.event.type, "chat.read_updated");
  assert.deepEqual(event.event.data, {
    chat_id: "chat-3",
    reader_user_id: "buyer-1"
  });
});

test("encodeSseEvent formats id, event, and data lines", () => {
  const message = encodeSseEvent({
    id: "event-1",
    type: "booking.created",
    occurred_at: "2026-04-05T00:00:00.000Z",
    data: {
      booking_id: "booking-1"
    }
  });

  assert.match(message, /^id: event-1\n/);
  assert.match(message, /\nevent: booking\.created\n/);
  assert.match(message, /\ndata: \{"id":"event-1","type":"booking\.created","occurred_at":"2026-04-05T00:00:00\.000Z","data":\{"booking_id":"booking-1"\}\}\n\n$/);
});
