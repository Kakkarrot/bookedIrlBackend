# BookedIRL Backend

Minimal Fastify + TypeScript scaffold for the marketplace API.

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

- Nearby qualified users: `GET /users/nearby-qualified` returns users with at least one photo and one active (bookable) service, sorted by closest distance to the authenticated user's saved location.
- Auth: login/sign-up via Firebase ID tokens for Google or Apple providers.
- User profile lookup: `GET /users/:userId` returns a user's profile, photos, social links, and services (private fields omitted for non-self; users without photos or active services return 404 to other users).
- Profile updates: `POST /users` updates any user profile field plus photos, social links, and location for the authenticated user.
- User photos update: `POST /users/photos` replaces the authenticated user's photo URLs (max 6).
- Photo uploads: `POST /uploads/photos/sign` returns signed upload URLs and public URLs for direct-to-storage uploads (Supabase Storage).
- Photo deletions: `POST /uploads/photos/delete` deletes stored photos by path or public URL.
- Username updates return `409 { "error": "username_taken" }` on duplicates.
- Onboarding intents: `POST /users` accepts `intentLooking` and `intentOffering` booleans.
- Create service for user: `POST /users/:userId/services` creates a new service for the authenticated user (userId must match).
- List services for user: `GET /users/:userId/services` returns services for a user (non-self requests only see active services when user has photos and active services).
- Service detail: `GET /services/:serviceId` returns a service (owner or public if active + discoverable).
- Update service: `PATCH /services/:serviceId` updates a service (owner only).
- Delete service: `DELETE /services/:serviceId` deletes a service (owner only).
- Headline options: `GET /headlines` returns the allowed headline list for clients.
- Create booking for service: `POST /bookings` creates a booking for a service as the authenticated user.
- Update booking: `PATCH /bookings/:bookingId` updates booking status or scheduled time (buyer/seller only; accept/decline is seller-only).
- List bookings for user’s services: `GET /users/:userId/bookings` returns bookings requested by other users for services owned by the authenticated user (supports `limit`/`offset`).
- List chats for user: `GET /users/:userId/chats` returns all chats where the authenticated user is a buyer or seller (supports `limit`/`offset`).
- Create chat from booking: `POST /bookings/:bookingId/chat` creates a chat for the booking (buyer/seller only).
- List chat messages: `GET /chats/:id/messages` returns messages for a chat the authenticated user participates in.
- Mark chat read: `POST /chats/:id/read` updates the user's last-read timestamp for a chat.
- Unread counts: `GET /chats` and `GET /users/:userId/chats` include `unread_count`.
- List services for users: `GET /services?userIds=uuid,uuid` returns active services for users who have photos and active services.
- User photos: `GET /users/photos?userIds=uuid,uuid` returns photos only for users who have photos and active services.
- Notifications: `GET /notifications` returns notifications for the authenticated user (supports `limit`/`offset`).
- Realtime: planned Supabase Realtime integration for live chat.

## Getting started

```bash
npm install
npm run dev
```

## Database setup

Apply the schema to your Supabase Postgres instance:

```bash
psql "$DATABASE_URL" -f src/db/schema.sql
```

Note: new users are created with blank profile fields. Discoverability is derived from having photos and active services.
Profile field `headline` is the short profession string shown under the username (replaces the old `title` field).

## Environment

Copy `.env.example` to `.env` and update values.

## Roadmap (not in initial release)

- Payments
- Search and filtering
- Service categories
- Availability scheduling
- Trust and safety tooling
