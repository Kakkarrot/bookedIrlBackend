import type { FastifyBaseLogger } from "fastify";
import type { Pool, PoolClient } from "pg";
import { encodeSseEvent, type ClientRealtimeEvent, type RoutedRealtimeEvent } from "./realtimeEvents";

const channelName = "bookedirl_events";

type RealtimeSubscription = {
  close: () => void;
};

type Subscriber = {
  id: string;
  send: (event: ClientRealtimeEvent) => void;
};

export interface RealtimeBroker {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  publish: (event: RoutedRealtimeEvent) => Promise<void>;
  subscribe: (userId: string, send: (event: ClientRealtimeEvent) => void) => RealtimeSubscription;
}

export function createRealtimeBroker(pool: Pool, logger: FastifyBaseLogger): RealtimeBroker {
  let listenerClient: PoolClient | null = null;
  let isStopping = false;
  let nextSubscriberId = 0;
  const subscribersByUserId = new Map<string, Map<string, Subscriber>>();

  async function start() {
    if (listenerClient) {
      return;
    }

    listenerClient = await pool.connect();
    isStopping = false;
    listenerClient.on("notification", (message) => {
      if (message.channel !== channelName || !message.payload) {
        return;
      }

      try {
        const routedEvent = JSON.parse(message.payload) as RoutedRealtimeEvent;
        for (const recipient of routedEvent.recipients) {
          const subscribers = subscribersByUserId.get(recipient);
          if (!subscribers) continue;
          for (const subscriber of subscribers.values()) {
            subscriber.send(routedEvent.event);
          }
        }
      } catch (error) {
        logger.error(
          {
            component: "realtime",
            event: "realtime_notification_parse_failed",
            error: error instanceof Error ? error.message : String(error)
          },
          "Failed to parse realtime notification payload"
        );
      }
    });
    listenerClient.on("error", (error) => {
      if (isStopping) {
        return;
      }

      logger.error(
        {
          component: "realtime",
          event: "realtime_listener_failed",
          error: error instanceof Error ? error.message : String(error)
        },
        "Realtime LISTEN client failed"
      );
    });
    listenerClient.on("end", () => {
      if (isStopping) {
        return;
      }

      logger.warn(
        {
          component: "realtime",
          event: "realtime_listener_ended_unexpectedly"
        },
        "Realtime LISTEN client ended unexpectedly"
      );
      listenerClient = null;
    });

    await listenerClient.query(`LISTEN ${channelName}`);
  }

  async function stop() {
    if (!listenerClient) {
      return;
    }

    isStopping = true;
    try {
      await listenerClient.query(`UNLISTEN ${channelName}`);
    } finally {
      listenerClient.release();
      listenerClient = null;
      subscribersByUserId.clear();
    }
  }

  async function publish(event: RoutedRealtimeEvent) {
    await pool.query("SELECT pg_notify($1, $2)", [channelName, JSON.stringify(event)]);
  }

  function subscribe(userId: string, send: (event: ClientRealtimeEvent) => void): RealtimeSubscription {
    const subscriberId = String(nextSubscriberId++);
    const subscriber: Subscriber = { id: subscriberId, send };
    const existing = subscribersByUserId.get(userId) ?? new Map<string, Subscriber>();
    existing.set(subscriberId, subscriber);
    subscribersByUserId.set(userId, existing);

    return {
      close: () => {
        const userSubscribers = subscribersByUserId.get(userId);
        if (!userSubscribers) {
          return;
        }
        userSubscribers.delete(subscriberId);
        if (!userSubscribers.size) {
          subscribersByUserId.delete(userId);
        }
      }
    };
  }

  return {
    start,
    stop,
    publish,
    subscribe
  };
}

export function createNoopRealtimeBroker(): RealtimeBroker {
  return {
    start: async () => {},
    stop: async () => {},
    publish: async () => {},
    subscribe: () => ({
      close: () => {}
    })
  };
}
