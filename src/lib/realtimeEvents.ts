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

export function encodeSseEvent(event: ClientRealtimeEvent) {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

