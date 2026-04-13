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

## Planned

### Test Coverage
- add integration-style route coverage for `POST /uploads/photos/sign`
  - valid sign request
  - invalid content type rejection
- add integration-style route coverage for `POST /uploads/photos/delete`
  - invalid/no owned paths rejection
  - successful delete flow with injected storage dependency

## Open Questions
