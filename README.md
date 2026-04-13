# BookedIRL Backend

Minimal Fastify + TypeScript scaffold for the marketplace API.

Shared roadmap: `/Users/willieli/bookedIrl/ROADMAP.md`

Update expectation:
- after every feature change, update the shared roadmap to mark completed work or add newly discovered feature work

## Tech stack

- Runtime: Node.js >= 20 (CommonJS)
- Framework: Fastify
- Language: TypeScript (tsx for dev)
- Auth: Firebase Admin (token verification)
- Database: Supabase Postgres (via `pg`, ORM TBD)
- Deployment: Render for backend runtime (Supabase remains the database)
- Validation: Zod

## API schema

The canonical OpenAPI spec lives at `openapi.yaml`.

All API requests must include `X-API-Version` matching `openapi.yaml` `info.version`. Mismatches return `426`.

## Logging

- Request-scoped business events are structured with `event`.
- Push logs now also include `component: "push"` so Render filtering can isolate token registration and APNs send behavior quickly.

The OpenAPI spec is served at `GET /openapi.yaml` for client generation.

## Features

- Discover users: `GET /users` returns users with at least one photo and one active (bookable) service, sorted by closest distance to the authenticated user's saved location, with users missing their own location sorted last.
- Discover users: `GET /users` supports `limit`/`offset` pagination plus optional `query` search across profile fields and active service titles/descriptions for the discover feed.
- Auth: login/sign-up via Firebase ID tokens for Google or Apple providers.
- User profile lookup: `GET /users/:userId` returns a user's profile, photos, social links, and services for any existing user (private fields omitted for non-self). Discoverability only affects discover/search surfaces, not direct profile fetches.
- Profile updates: `POST /user` updates any user profile field plus photos, social links, and location for the authenticated user.
- User photos update: `POST /user/photos` replaces the authenticated user's photo URLs (max 6).
- Photo uploads: `POST /uploads/photos/sign` returns signed upload URLs and public URLs for direct-to-storage uploads (Supabase Storage).
- Photo deletions: `POST /uploads/photos/delete` deletes stored photos by path or public URL.
- Username updates return `409 { "error": "username_taken" }` on duplicates.
- Onboarding intents: `POST /user` accepts `intentLooking` and `intentOffering` booleans.
- Create service for user: `POST /users/:userId/services` creates a new service for the authenticated user (userId must match).
- Service create payload supports optional `isActive` (defaults to `true` when omitted).
- List services for user: `GET /users/:userId/services` returns services for a user (non-self requests only see active services when user has photos and active services).
- Service detail: `GET /services/:serviceId` returns a service (owner or public if active + discoverable).
- Update service: `PATCH /services/:serviceId` updates a service (owner only).
- Delete service: `DELETE /services/:serviceId` deletes a service (owner only).
- Headline options: `GET /headlines` returns the allowed headline list for clients.
- Create booking request: `POST /bookings` creates a booking request using `requestedDate` + `timeOfDay` (not an exact timestamp).
- Booking requests snapshot the service title, price, and duration at request time so the bookings inbox and history remain stable after service edits.
- Booking anti-spam rule: only one non-declined booking may exist between a pair of users at a time; duplicates return `409 booking_already_exists`.
- Booking validation: users cannot book their own service or an inactive service; self-booking returns `cannot_book_own_service` before generic availability errors.
- Update booking: `PATCH /bookings/:bookingId` only supports seller-side `accepted` / `declined`.
- Accepting a booking creates the chat; `POST /bookings/:bookingId/chat` only works for accepted bookings.
- Bookings are the source of truth for the iOS bookings inbox (the tab previously named notifications).
- List bookings inbox: `GET /bookings` returns booking summaries for services owned by the authenticated user, including minimal buyer profile info for rendering (supports `limit`/`offset`).
- Push registration: `POST /push/register` stores the authenticated user's iOS APNs device token.
- New booking requests trigger a best-effort APNs push to the seller with the current requested-bookings badge count.
- Realtime stream: `GET /events/stream` provides an authenticated SSE feed for live in-app events using the existing Firebase bearer token contract and `X-API-Version`.
- Realtime bookings: successful booking create/update writes now fan out lightweight invalidation events (`booking.created`, `booking.updated`) so clients can refresh badge/inbox state without waiting for tab-level fetches.
- Chat inbox: `GET /chats` and `GET /users/:userId/chats` return render-ready chat summaries with minimal counterparty profile data (supports `limit`/`offset`).
- Chat inbox summaries now also include `is_unseen` so clients can badge a newly created chat separately from later unread messages.
- Create chat from booking: `POST /bookings/:bookingId/chat` creates a chat for the booking (buyer/seller only).
- List chat messages: `GET /chats/:id/messages` returns messages for a chat the authenticated user participates in.
- Send chat message: `POST /chats/:id/messages` returns the created message record.
- Mark chat read: `POST /chats/:id/read` updates the user's last-read timestamp for a chat.
- Unread counts: `GET /chats` and `GET /users/:userId/chats` include `unread_count`.
- Realtime chat events: booking acceptance chat creation, new messages, and read updates now fan out lightweight invalidation events (`chat.created`, `chat.message_created`, `chat.read_updated`) on the same SSE stream.
- List services for users: `GET /services?userIds=uuid,uuid` returns active services for users who have photos and active services.
- User photos: `GET /user/photos?userIds=uuid,uuid` returns photos only for users who have photos and active services.
- Realtime: backend-owned SSE now serves as the shared foundation for live bookings and chat invalidation events.

## Getting started

```bash
npm install
npm run dev
```

`npm run build` now runs the lightweight non-Docker backend unit tests and then compiles with TypeScript.

For local pre-build verification, run:

```bash
npm run build:local
```

This keeps Docker-backed integration separate from hosted builds while still giving local development a one-command full verification path: build first, then integration.

## Integration tests

Integration tests run the real Fastify app in-process and provision an isolated PostGIS-enabled Postgres database with `testcontainers`.

Requirements:
- Docker must be running locally.

Run the suite with:

```bash
npm run test:unit
npm run test:integration
```

Run one integration file through the same shared setup with:

```bash
INTEGRATION_TARGET=tests/integration/auth.session.test.ts npm run test:integration:one
```

Current split:
- `npm run test:unit` covers lightweight non-Docker seams such as request guards and realtime event builders.
- `npm run test:integration` runs the in-process Fastify + disposable PostGIS container suite.
- Integration files now live under `tests/integration`, while lightweight unit tests live under `tests/unit`.

Run the full local verification path with:

```bash
npm run build:local
```

Current setup details:
- The disposable database is bootstrapped from `src/db/schema.sql`.
- Tests inject a local token verifier so they stay self-contained and do not depend on live Firebase.
- Integration infrastructure is separated from test logic:
  - `tests/integration/index.test.ts` owns the suite-level setup/teardown hooks
  - one shared PostGIS runtime is bootstrapped for the integration run
  - each test app gets a fresh isolated database cloned from a schema-loaded template
- Push delivery is injected in tests as a no-op dependency so background APNs work cannot race the shared database reset path.
- The first smoke test covers `POST /auth/session` end to end against isolated Postgres.
- The suite also includes a focused schema-contract test so drift in critical columns, indexes, or the PostGIS extension fails explicitly.
- Lightweight non-Docker tests also cover request guards and realtime event builders so core contract logic can be verified even when the container harness is unavailable.

## Logging

Fastify request logging is enabled by default. The backend also emits structured application logs for:
- auth failures
- API version mismatches
- validation and unexpected request failures
- booking/chat write-path successes and business-rule rejections
- upload signing/deletion successes and failures

Logging is intentionally targeted: enough context to debug request outcomes without dumping full request bodies or sensitive data.
Realtime connection and publish failures are also logged under `component: "realtime"` so stream health is filterable independently from push.

## Database setup

Apply the schema to your Supabase Postgres instance:

```bash
psql "$DB_DIRECT_URL" -f src/db/schema.sql
```

Note: new users are created with blank profile fields. Discoverability is derived from having photos and active services.
Profile field `headline` is the short profession string shown under the username (replaces the old `title` field).

Additional schema for push delivery:

```sql
CREATE TABLE IF NOT EXISTS push_device_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('ios')),
  environment text NOT NULL CHECK (environment IN ('development', 'production')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_device_tokens_user_id_idx ON push_device_tokens(user_id);
```

## Environment

Copy `.env.example` to `.env` and update values.

Database connection roles:

```bash
DB_POOL_URL=postgresql://...@aws-...pooler.supabase.com:6543/postgres
DB_DIRECT_URL=postgresql://...@aws-...pooler.supabase.com:5432/postgres
```

- `DB_POOL_URL` is used for the main API's pooled request/response queries.
- `DB_DIRECT_URL` is used for the realtime broker's session-oriented `LISTEN` / `NOTIFY` connection path.
- On Render + Supabase, prefer the Supavisor transaction pooler for `DB_POOL_URL` and the Supavisor session pooler for `DB_DIRECT_URL`; the IPv6 direct database host is not a reliable fit there.

Optional APNs env vars for push delivery:

```bash
APPLE_PUSH_TEAM_ID=...
APPLE_PUSH_KEY_ID=...
APPLE_PUSH_BUNDLE_ID=com.bookedirl.app
APPLE_PUSH_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
# or APPLE_PUSH_PRIVATE_KEY_BASE64=...
```

If these are unset, booking creation still succeeds and the backend logs that push delivery is skipped.

## Roadmap (not in initial release)

- Payments
- Search and filtering
- Service categories
- Availability scheduling
- Trust and safety tooling
