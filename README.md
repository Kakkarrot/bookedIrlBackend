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

The OpenAPI spec is served at `GET /openapi.yaml` for client generation.

## Features

- Nearby qualified users: `GET /users/nearby-qualified` returns users with at least one photo and one active (bookable) service, sorted by closest distance to the authenticated user's saved location, with users missing their own location sorted last.
- Nearby qualified users: `GET /users/nearby-qualified` supports `limit`/`offset` pagination plus optional `query` search across profile fields and active service titles/descriptions for the discover feed.
- Auth: login/sign-up via Firebase ID tokens for Google or Apple providers.
- User profile lookup: `GET /users/:userId` returns a user's profile, photos, social links, and services (private fields omitted for non-self; users without photos or active services return 404 to other users).
- Profile updates: `POST /users` updates any user profile field plus photos, social links, and location for the authenticated user.
- User photos update: `POST /users/photos` replaces the authenticated user's photo URLs (max 6).
- Photo uploads: `POST /uploads/photos/sign` returns signed upload URLs and public URLs for direct-to-storage uploads (Supabase Storage).
- Photo deletions: `POST /uploads/photos/delete` deletes stored photos by path or public URL.
- Username updates return `409 { "error": "username_taken" }` on duplicates.
- Onboarding intents: `POST /users` accepts `intentLooking` and `intentOffering` booleans.
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
- Chat inbox: `GET /chats` and `GET /users/:userId/chats` return render-ready chat summaries with minimal counterparty profile data (supports `limit`/`offset`).
- Create chat from booking: `POST /bookings/:bookingId/chat` creates a chat for the booking (buyer/seller only).
- List chat messages: `GET /chats/:id/messages` returns messages for a chat the authenticated user participates in.
- Send chat message: `POST /chats/:id/messages` returns the created message record.
- Mark chat read: `POST /chats/:id/read` updates the user's last-read timestamp for a chat.
- Unread counts: `GET /chats` and `GET /users/:userId/chats` include `unread_count`.
- List services for users: `GET /services?userIds=uuid,uuid` returns active services for users who have photos and active services.
- User photos: `GET /users/photos?userIds=uuid,uuid` returns photos only for users who have photos and active services.
- Realtime: planned Supabase Realtime integration for live chat.

## Getting started

```bash
npm install
npm run dev
```

For local pre-build verification, run:

```bash
npm run build:local
```

This keeps `npm run build` as compile-only for hosted environments while still giving local development a one-command test-then-build path.

## Integration tests

Integration tests run the real Fastify app in-process and provision an isolated PostGIS-enabled Postgres database with `testcontainers`.

Requirements:
- Docker must be running locally.

Run the suite with:

```bash
npm run test:integration
```

Current setup details:
- The disposable database is bootstrapped from `src/db/schema.sql`.
- Tests inject a local token verifier so they stay self-contained and do not depend on live Firebase.
- The first smoke test covers `POST /auth/session` end to end against isolated Postgres.
- The suite also includes a focused schema-contract test so drift in critical columns, indexes, or the PostGIS extension fails explicitly.

## Logging

Fastify request logging is enabled by default. The backend also emits structured application logs for:
- auth failures
- API version mismatches
- validation and unexpected request failures
- booking/chat write-path successes and business-rule rejections
- upload signing/deletion successes and failures

Logging is intentionally targeted: enough context to debug request outcomes without dumping full request bodies or sensitive data.

## Database setup

Apply the schema to your Supabase Postgres instance:

```bash
psql "$DATABASE_URL" -f src/db/schema.sql
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
