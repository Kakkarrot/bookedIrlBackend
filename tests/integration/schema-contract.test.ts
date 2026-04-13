import test = require("node:test");
import * as assert from "node:assert/strict";
import { createIntegrationHarness } from "./helpers/integrationHarness";

async function getColumnNames(pool: Awaited<ReturnType<typeof createIntegrationHarness>>["pool"], tableName: string) {
  const result = await pool.query<{ column_name: string }>(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
    `,
    [tableName]
  );

  return new Set(result.rows.map((row) => row.column_name));
}

test("bootstrap schema exposes the contract-critical columns and indexes the app depends on", async () => {
  const harness = await createIntegrationHarness();

  try {
    const userColumns = await getColumnNames(harness.pool, "users");
    assert.ok(userColumns.has("birthday"));
    assert.ok(userColumns.has("onboarding_step"));

    const bookingColumns = await getColumnNames(harness.pool, "bookings");
    assert.ok(bookingColumns.has("participant_a"));
    assert.ok(bookingColumns.has("participant_b"));
    assert.ok(bookingColumns.has("service_title"));
    assert.ok(bookingColumns.has("service_price_dollars"));
    assert.ok(bookingColumns.has("service_duration_minutes"));
    assert.ok(bookingColumns.has("requested_date"));
    assert.ok(bookingColumns.has("time_of_day"));

    const chatColumns = await getColumnNames(harness.pool, "chats");
    assert.ok(chatColumns.has("booking_id"));
    assert.ok(chatColumns.has("participant_a"));
    assert.ok(chatColumns.has("participant_b"));

    const bookingsIndexResult = await harness.pool.query<{
      indexname: string;
      indexdef: string;
    }>(
      `
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'bookings' AND indexname = 'bookings_open_pair_idx'
      `
    );

    assert.equal(bookingsIndexResult.rowCount, 1);
    assert.match(bookingsIndexResult.rows[0].indexdef, /CREATE UNIQUE INDEX/i);
    assert.match(bookingsIndexResult.rows[0].indexdef, /participant_a, participant_b/i);
    assert.match(bookingsIndexResult.rows[0].indexdef, /status.*requested.*accepted/i);

    const chatsIndexResult = await harness.pool.query<{
      indexname: string;
      indexdef: string;
    }>(
      `
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'chats' AND indexname = 'chats_booking_id_idx'
      `
    );

    assert.equal(chatsIndexResult.rowCount, 1);

    const postgisResult = await harness.pool.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = 'postgis'"
    );

    assert.equal(postgisResult.rowCount, 1);
  } finally {
    await harness.close();
  }
});
