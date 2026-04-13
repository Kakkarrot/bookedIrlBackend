# Backend AGENTS

## Purpose

This backend is the single app-facing authority for BookedIRL.
Clients should not bypass it for business data or realtime state.

## Stack

- Fastify
- TypeScript, CommonJS, Node 20+
- Firebase Admin for auth verification
- Supabase Postgres via `pg`
- Zod for validation
- Render for deployment

## Core Contracts

- OpenAPI source of truth: `openapi.yaml`
- Every request must send `X-API-Version` matching `openapi.yaml`
- Mismatches return `426`
- Auth source of truth is Firebase bearer tokens
- Discoverability affects discover/search inclusion only, not direct `GET /users/:userId`

## Product Rules

- Discover returns only users with at least one photo and one active service
- `GET /users` is the discover source and supports `limit`, `offset`, and optional `query`
- Bookings are a seller inbox, not a generic notifications system
- Bookings use `requestedDate` + `timeOfDay`
- Only one open booking may exist per user pair while status is `requested` or `accepted`
- Existing chat should change the client CTA from `Book` to `Message`
- Backend booking creation is still rejected by existing open bookings (`requested` or `accepted`)
- Self-booking must return `cannot_book_own_service` before generic service errors
- Only the seller may accept or decline
- Accepting a booking creates one durable chat for the participant pair
- Booking acceptance must fail if a durable chat already exists for that participant pair
- Chat inbox summaries must include:
  - `other_user`
  - `unread_count`
  - `is_unseen`

## Realtime

- Backend owns realtime through `GET /events/stream`
- Realtime events are invalidation-oriented, not full state replication
- Current event types:
  - `booking.created`
  - `booking.updated`
  - `chat.created`
  - `chat.message_created`
  - `chat.read_updated`
- REST endpoints remain the source of truth for full payloads

## Push

- `POST /push/register` stores iOS APNs device tokens
- Booking-request push is best-effort only
- Push must never block or fail booking writes
- Push behavior should be injectable in tests so integration runs stay deterministic

## Testing

- `npm run build`
  - runs lightweight unit tests, then `tsc`
- `npm run build:local`
  - runs `npm run build` first, then the Docker-backed integration suite
- `npm run test:unit`
  - covers pure seams such as request/version guards and realtime event builders
- `npm run test:integration`
  - runs the Docker-backed integration suite through `tests/integration/index.test.ts`
- `npm run test:integration:one`
  - runs the Docker-backed integration debug entry through `tests/integration/debug.test.ts`
  - requires `INTEGRATION_TARGET`, for example `INTEGRATION_TARGET=tests/integration/auth.session.test.ts`
- Integration tests:
  - run Fastify in-process with `app.inject()`
  - use PostGIS via `testcontainers`
  - use injected Firebase token verification
  - use a single integration runner with shared suite hooks
  - bootstrap one shared PostGIS runtime per integration run
  - clone a fresh isolated database per test app from a template database
  - keep setup/teardown in the harness and suite hooks, not in individual tests

## Design Guidance

- Prefer explicit dependencies over hidden globals
- Prefer root-cause fixes over local patches
- If a failure exposes the wrong ownership or lifecycle seam, fix the seam instead of masking it with retries, flags, or test-only hacks
- A fix is not complete just because one run passes; leave the backend boundary in an intentional shape
- Keep side effects injectable when tests need to neutralize them
- Keep logging structured and filterable
- Use `component` for subsystem filtering when helpful, especially:
  - `realtime`
  - `push`
- Avoid noisy branch-by-branch debug logging

## Files To Keep Current

- Update this file when backend architecture or product rules change
- Update `README.md` when backend capabilities or developer workflows change
- Update `/Users/willieli/bookedIrl/ROADMAP.md` when feature status or priorities change
