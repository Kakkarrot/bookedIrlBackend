import { randomUUID } from "node:crypto";

export type ClientRealtimeEvent =
  | {
      id: string;
      type: "booking.created";
      occurred_at: string;
      data: {
        booking_id: string;
      };
    }
  | {
      id: string;
      type: "chat.created";
      occurred_at: string;
      data: {
        chat_id: string;
      };
    }
  | {
      id: string;
      type: "chat.message_created";
      occurred_at: string;
      data: {
        chat_id: string;
        message_id: string;
        sender_user_id: string;
      };
    }
  | {
      id: string;
      type: "chat.read_updated";
      occurred_at: string;
      data: {
        chat_id: string;
        reader_user_id: string;
      };
    }
  | {
      id: string;
      type: "booking.updated";
      occurred_at: string;
      data: {
        booking_id: string;
        status: "accepted" | "declined";
      };
    };

export type RoutedRealtimeEvent = {
  recipients: string[];
  event: ClientRealtimeEvent;
};

function createEventId() {
  return randomUUID();
}

function createOccurredAt() {
  return new Date().toISOString();
}

export function buildBookingCreatedEvent(input: {
  bookingId: string;
  sellerUserId: string;
}): RoutedRealtimeEvent {
  return {
    recipients: [input.sellerUserId],
    event: {
      id: createEventId(),
      type: "booking.created",
      occurred_at: createOccurredAt(),
      data: {
        booking_id: input.bookingId
      }
    }
  };
}

export function buildBookingUpdatedEvent(input: {
  bookingId: string;
  buyerUserId: string;
  sellerUserId: string;
  status: "accepted" | "declined";
}): RoutedRealtimeEvent {
  return {
    recipients: [input.buyerUserId, input.sellerUserId],
    event: {
      id: createEventId(),
      type: "booking.updated",
      occurred_at: createOccurredAt(),
      data: {
        booking_id: input.bookingId,
        status: input.status
      }
    }
  };
}

export function buildChatCreatedEvent(input: {
  chatId: string;
  buyerUserId: string;
  sellerUserId: string;
}): RoutedRealtimeEvent {
  return {
    recipients: [input.buyerUserId, input.sellerUserId],
    event: {
      id: createEventId(),
      type: "chat.created",
      occurred_at: createOccurredAt(),
      data: {
        chat_id: input.chatId
      }
    }
  };
}

export function buildChatMessageCreatedEvent(input: {
  chatId: string;
  buyerUserId: string;
  sellerUserId: string;
  messageId: string;
  senderUserId: string;
}): RoutedRealtimeEvent {
  return {
    recipients: [input.buyerUserId, input.sellerUserId],
    event: {
      id: createEventId(),
      type: "chat.message_created",
      occurred_at: createOccurredAt(),
      data: {
        chat_id: input.chatId,
        message_id: input.messageId,
        sender_user_id: input.senderUserId
      }
    }
  };
}

export function buildChatReadUpdatedEvent(input: {
  chatId: string;
  readerUserId: string;
}): RoutedRealtimeEvent {
  return {
    recipients: [input.readerUserId],
    event: {
      id: createEventId(),
      type: "chat.read_updated",
      occurred_at: createOccurredAt(),
      data: {
        chat_id: input.chatId,
        reader_user_id: input.readerUserId
      }
    }
  };
}

export function encodeSseEvent(event: ClientRealtimeEvent) {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
