import crypto from "node:crypto";
import http2 from "node:http2";
import type { FastifyBaseLogger } from "fastify";
import type { Pool } from "pg";
import { env } from "../config/env";
import { logComponentEvent } from "./logging";

type PushEnvironment = "development" | "production";

type PushLogger = Pick<FastifyBaseLogger, "info" | "warn" | "error">;

type BookingPushPayload = {
  bookingId: string;
  sellerUserId: string;
  buyerDisplayName: string;
  serviceTitle: string;
};

type PushTokenRow = {
  device_token: string;
  environment: PushEnvironment;
};

type ApnsConfig = {
  teamId: string;
  keyId: string;
  bundleId: string;
  privateKey: string;
};

const apnsConfig = buildApnsConfig();

function logPushEvent(
  logger: PushLogger,
  level: "info" | "warn" | "error",
  event: string,
  context: Record<string, unknown> = {}
) {
  logComponentEvent(logger, level, "push", event, context);
}

function buildApnsConfig(): ApnsConfig | null {
  const privateKey =
    decodeBase64(env.APPLE_PUSH_PRIVATE_KEY_BASE64) ??
    normalizeMultiline(env.APPLE_PUSH_PRIVATE_KEY);

  if (!env.APPLE_PUSH_TEAM_ID || !env.APPLE_PUSH_KEY_ID || !env.APPLE_PUSH_BUNDLE_ID || !privateKey) {
    return null;
  }

  return {
    teamId: env.APPLE_PUSH_TEAM_ID,
    keyId: env.APPLE_PUSH_KEY_ID,
    bundleId: env.APPLE_PUSH_BUNDLE_ID,
    privateKey
  };
}

function normalizeMultiline(value?: string) {
  return value?.replace(/\\n/g, "\n") ?? null;
}

function decodeBase64(value?: string) {
  if (!value) return null;
  return Buffer.from(value, "base64").toString("utf8");
}

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function createApnsJwt(config: ApnsConfig) {
  const header = base64UrlEncode(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = base64UrlEncode(
    JSON.stringify({
      iss: config.teamId,
      iat: Math.floor(Date.now() / 1000)
    })
  );
  const unsignedToken = `${header}.${claims}`;
  const signer = crypto.createSign("sha256");
  signer.update(unsignedToken);
  signer.end();

  const signature = signer.sign({
    key: config.privateKey,
    format: "pem"
  });

  return `${unsignedToken}.${base64UrlEncode(signature)}`;
}

async function sendApnsNotification(
  config: ApnsConfig,
  token: PushTokenRow,
  payload: Record<string, unknown>
) {
  const authority =
    token.environment === "development"
      ? "https://api.sandbox.push.apple.com"
      : "https://api.push.apple.com";

  const client = http2.connect(authority);

  try {
    const response = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const request = client.request({
        ":method": "POST",
        ":path": `/3/device/${token.device_token}`,
        authorization: `bearer ${createApnsJwt(config)}`,
        "apns-topic": config.bundleId,
        "apns-push-type": "alert",
        "content-type": "application/json"
      });

      let statusCode = 0;
      let body = "";

      request.setEncoding("utf8");
      request.on("response", (headers) => {
        statusCode = Number(headers[":status"] ?? 0);
      });
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => resolve({ statusCode, body }));
      request.on("error", reject);
      request.end(JSON.stringify(payload));
    });

    return response;
  } finally {
    client.close();
  }
}

async function deleteDeviceToken(db: Pool, deviceToken: string) {
  await db.query("DELETE FROM push_device_tokens WHERE device_token = $1", [deviceToken]);
}

async function countRequestedBookings(db: Pool, sellerUserId: string) {
  const result = await db.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM bookings WHERE seller_id = $1 AND status = 'requested'",
    [sellerUserId]
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function listPushTokens(db: Pool, userId: string) {
  const result = await db.query<PushTokenRow>(
    `
    SELECT device_token, environment
    FROM push_device_tokens
    WHERE user_id = $1
      AND platform = 'ios'
    `,
    [userId]
  );
  return result.rows;
}

function isUnregisteredReason(reason: string | undefined) {
  return reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic" || reason === "Unregistered";
}

export function isPushNotificationsConfigured() {
  return apnsConfig !== null;
}

export async function sendBookingRequestedPush(
  db: Pool,
  logger: PushLogger,
  payload: BookingPushPayload
) {
  if (!apnsConfig) {
    logPushEvent(logger, "warn", "push_skipped_missing_apns_config", {
      seller_user_id: payload.sellerUserId
    });
    return;
  }

  const [deviceTokens, badgeCount] = await Promise.all([
    listPushTokens(db, payload.sellerUserId),
    countRequestedBookings(db, payload.sellerUserId)
  ]);

  if (!deviceTokens.length) {
    logPushEvent(logger, "info", "push_skipped_no_registered_devices", {
      seller_user_id: payload.sellerUserId
    });
    return;
  }

  const alertTitle = "New booking request";
  const alertBody = `${payload.buyerDisplayName} requested ${payload.serviceTitle}.`;

  await Promise.all(
    deviceTokens.map(async (deviceToken) => {
      try {
        const response = await sendApnsNotification(apnsConfig, deviceToken, {
          aps: {
            alert: {
              title: alertTitle,
              body: alertBody
            },
            badge: badgeCount,
            sound: "default"
          },
          type: "booking_requested",
          booking_id: payload.bookingId
        });

        if (response.statusCode === 200) {
          logPushEvent(logger, "info", "push_sent_booking_requested", {
            booking_id: payload.bookingId,
            seller_user_id: payload.sellerUserId,
            device_environment: deviceToken.environment
          });
          return;
        }

        let reason: string | undefined;
        try {
          reason = JSON.parse(response.body).reason;
        } catch {
          reason = undefined;
        }

        if (isUnregisteredReason(reason)) {
          await deleteDeviceToken(db, deviceToken.device_token);
        }

        logPushEvent(logger, "warn", "push_send_failed_booking_requested", {
          booking_id: payload.bookingId,
          seller_user_id: payload.sellerUserId,
          status_code: response.statusCode,
          reason: reason ?? null
        });
      } catch (error) {
        logPushEvent(logger, "error", "push_send_errored_booking_requested", {
          booking_id: payload.bookingId,
          seller_user_id: payload.sellerUserId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    })
  );
}
