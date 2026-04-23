# Backend Roadmap

## Completed

### Health
- `GET /health`
  - basic health check endpoint is implemented

### Metadata
- `GET /headlines`
  - allowed headline option listing is implemented

### Auth
- `POST /auth/session`
  - Firebase bearer token verification is implemented
  - backend user/session establishment is implemented for the current app model

### Users
- `GET /user/me`
  - current authenticated user profile is implemented
- `GET /users/:userId`
  - direct profile fetch is implemented
- `POST /user`
  - current user profile update is implemented
- `GET /users`
  - discover-oriented user listing is implemented
- `GET /user/photos`
  - batched public user photo fetch is implemented
- `POST /user/photos`
  - authenticated user photo replacement is implemented
  - profile photo support is capped at 3 photos

### Uploads
- `POST /uploads/photos/sign`
  - signed profile photo upload URL creation is implemented
- `POST /uploads/photos/delete`
  - profile photo deletion by storage path or public URL is implemented

### Services
- `GET /services`
  - service listing is implemented for both self-service reads and discover hydration via `userIds`
- `POST /service`
  - current-user service creation is implemented
- `GET /service/:serviceId`
  - single-service read with owner/public visibility rules is implemented
- `PATCH /service/:serviceId`
  - owner-only service update is implemented
- `DELETE /service/:serviceId`
  - owner-only service delete is implemented
  - service photo support is implemented with up to 3 ordered photos per service

### Bookings
- `GET /bookings`
  - seller inbox booking listing is implemented with integration coverage
- `POST /booking`
  - booking request creation is implemented
- `PATCH /booking/:bookingId`
  - seller-side booking acceptance / decline is implemented

### Chats
- `GET /chats`
  - chat inbox listing is implemented with integration coverage
- `GET /chats/:id/messages`
  - chat message listing is implemented with integration coverage
- `POST /chats/:id/messages`
  - chat message creation is implemented with integration coverage
- `POST /chats/:id/read`
  - chat read-state updates are implemented with integration coverage

### Realtime
- `GET /events/stream`
  - SSE realtime stream is implemented with integration coverage for booking and chat events

### Test Coverage
- schema drift check
  - local-vs-remote schema drift verification is implemented via `npm run test:schema:drift`

## Planned

### Chats
- add paginated message fetching for `GET /chats/:id/messages` so older chat history can load incrementally instead of being capped to the latest window

### Realtime
- investigate why live chat updates sometimes arrive on an apparent ~5 second polling cadence instead of near-instant SSE invalidation
- message writes already reach the backend and Postgres immediately; keep this investigation focused on downstream realtime publish, delivery, or client refresh latency rather than database persistence

### Push
- `POST /push/register`
  - validate the endpoint end-to-end in TestFlight
  - add backend integration coverage
  - evaluate migration from direct APNs delivery to Firebase Cloud Messaging

### Bookings
- remove the unused `note` column from bookings
- send email to users on new booking

### Profile
- investigate whether serving only one public original photo URL per profile image is forcing iOS discover and profile surfaces to download larger assets than they need

### Uploads
- evolve the photo delivery contract beyond a single original `publicUrl` so app clients can request app-facing variants instead of treating the uploaded near-original file as the default render asset
- evaluate whether profile photos should expose just two app-facing sizes for now:
  - `thumb` for avatars and other small surfaces
  - `display` for discover cards and profile/public-profile carousels
- decide whether image variants should be produced as stored derivatives at upload time or as reliable storage/CDN transform URLs
- make photo variant URLs stable and cache-friendly so clients can cache aggressively and only invalidate when a user replaces a photo
- update OpenAPI and backend photo response shapes if variant URLs become part of the public contract
- split storage ownership between profile photos and service photos so service media no longer uses the user-photo bucket
- add a dedicated service-photo storage bucket and keep that distinction backend-owned rather than inferred by clients

### Services
- refactor the duplicated ordered-photo persistence and hydration logic shared by user and service photo flows into small backend helpers while keeping the user and service APIs separate by design

### Test Coverage
- add integration-style route coverage for `POST /uploads/photos/sign`
  - valid sign request
  - invalid content type rejection
- add integration-style route coverage for `POST /uploads/photos/delete`
  - invalid/no owned paths rejection
  - successful delete flow with injected storage dependency
- extend schema drift coverage to compare backend-owned table RLS state and policy metadata; the current drift check only covers extensions, tables, columns, constraints, and indexes

## Open Questions
