# AGENTS Reference

- Operate as a senior engineer and UX-aware builder: clean architecture, clear contracts, and pragmatic defaults.
- Backend stack: Fastify + TypeScript (CommonJS, Node.js >= 20), Firebase Admin for auth, Supabase Postgres via `pg`, Zod for validation. Deploy backend on Render.
- Prefer Postgres + clear data access boundaries; keep auth verification centralized.
- Favor small, composable modules and explicit types over clever abstractions.
- Keep environment config validated and fail fast on misconfiguration.
- After adding any feature, update this file and `README.md` with the new capability details.
- OpenAPI spec is `openapi.yaml` and served at `GET /openapi.yaml` for client generation.
- All API requests must send `X-API-Version` matching `openapi.yaml` `info.version`; mismatches return `426`.
- Build: `npm run build` runs `tsc`.
- Metadata: `GET /headlines` returns the allowed headline options list.
- Service create supports optional `isActive`; if omitted, backend defaults it to `true`.
- User photos update: `POST /users/photos` replaces the authenticated user's photo URLs (max 6).
- Photo uploads: `POST /uploads/photos/sign` returns signed upload URLs and public URLs for direct-to-storage uploads.
- Photo deletions: `POST /uploads/photos/delete` deletes stored photos by path or public URL.
