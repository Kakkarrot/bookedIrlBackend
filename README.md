# BookedIRL Backend

Minimal Fastify + TypeScript scaffold for the marketplace API.

## Tech stack

- Runtime: Node.js (CommonJS)
- Framework: Fastify
- Language: TypeScript (tsx for dev)
- Auth: Firebase Admin (token verification)
- Database: Postgres (via `pg`, ORM TBD)
- Validation: Zod

## Features

- Nearby qualified users: `GET /users/nearby-qualified` returns discoverable, bookable users with at least one photo and one active service, sorted by closest distance to the authenticated user's saved location.
- Auth: login/sign-up via Firebase ID tokens for Google, Apple, or phone number providers.
- User profile lookup: `GET /users/:userId` returns a user's profile, photos, social links, and services (private fields omitted for non-self; non-discoverable profiles return 404 to other users).
- Profile updates: `POST /users` updates any user profile field plus photos, social links, and location for the authenticated user.
- Create service for user: `POST /users/:userId/services` creates a new service for the authenticated user (userId must match).
- List services for user: `GET /users/:userId/services` returns services for a user (non-self requests only see active services if the user is discoverable).
- Service detail: `GET /services/:serviceId` returns a service (owner or public if active + discoverable).
- Update service: `PATCH /services/:serviceId` updates a service (owner only).
- Delete service: `DELETE /services/:serviceId` deletes a service (owner only).
- Create booking for service: `POST /bookings` creates a booking for a service as the authenticated user.
- Update booking: `PATCH /bookings/:bookingId` updates booking status or scheduled time (buyer/seller only; accept/decline is seller-only).
- List bookings for user’s services: `GET /users/:userId/bookings` returns bookings requested by other users for services owned by the authenticated user (supports `limit`/`offset`).
- List chats for user: `GET /users/:userId/chats` returns all chats where the authenticated user is a buyer or seller (supports `limit`/`offset`).
- Create chat from booking: `POST /bookings/:bookingId/chat` creates a chat for the booking (buyer/seller only).
- List chat messages: `GET /chats/:id/messages` returns messages for a chat the authenticated user participates in.
- Mark chat read: `POST /chats/:id/read` updates the user's last-read timestamp for a chat.
- Unread counts: `GET /chats` and `GET /users/:userId/chats` include `unread_count`.
- List services for users: `GET /services?userIds=uuid,uuid` returns active services for discoverable users.
- User photos: `GET /users/photos?userIds=uuid,uuid` returns photos only for discoverable users.
- Notifications: `GET /notifications` returns notifications for the authenticated user (supports `limit`/`offset`).

## Getting started

```bash
npm install
npm run dev
```

## Environment

Copy `.env.example` to `.env` and update values.

## Next steps

- Add Postgres (Prisma/Drizzle)
- Add Firebase token verification
- Add core endpoints (users, services, bookings, chats, messages)
