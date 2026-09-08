# Pending Items Audit
2 of 8 items resolved, 6 still pending

Verified complete and dropped from tracking:
- #1 generated/prisma/ folder: `prisma/schema.prisma` uses `provider = "prisma-client-js"` with no `output`, and `generated/prisma/` still exists as stale generated output.
- #3 duplicate email -> 409 in signupController.ts: `signupController.ts` catches `P2002` and returns `new AppError('Email already exists', 409)`.

| # | Item | Status | Evidence (file + what you found) | Action Needed |
| --- | --- | --- | --- | --- |
| 2 | `/me` route protection (authGuard) | Still Pending | `src/routes/authRoutes.ts` wires `router.get('/me', authGuard, meController)`, and `src/middleware/authGuard.ts` plus `src/controllers/meController.ts` look correct. No test files were found in the service, so the no token / fake token / valid token cases still need manual verification. | Run the 3 Postman checks, or add an automated test that covers the protected `/me` route. |
| 4 | `onDelete: Cascade` on `RefreshToken` -> `User` | Still Pending | `prisma/schema.prisma` has `user User @relation(..., onDelete: Cascade)`, but `prisma/migrations/20260815055056_init/migration.sql` does not create the foreign key/cascade relation. No other migration folder matching this change was found. | Generate/apply a migration that adds the FK with `ON DELETE CASCADE`. |
| 5 | `.dockerignore` | Still Pending | `.dockerignore` does not exist in the repo root. | Add `.dockerignore` excluding `node_modules`, `.env`, `.env.docker`, `dist`, and `.git`. |
| 6 | `.env.example` | Still Pending | `.env.example` does not exist in the repo root. | Add an example env file with placeholder values for `PORT`, `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `NODE_ENV`. |
| 7 | `.env.docker` review | Still Pending | `.env.docker` exists and uses Docker service names (`postgres`, `redis`) instead of `localhost`, but `docker-compose.yml` is missing so the `env_file` wiring cannot be confirmed. | Add `docker-compose.yml` and point the auth service at `.env.docker` via `env_file`. |
| 8 | `README.md` | Still Pending | `README.md` only describes the service at a high level. It does not document the actual API routes (`/api/v1/auth/*`, `/api/v1/internal/*`), Docker run steps, or the required env vars. | Update the README with the real routes, Docker startup steps, and env var setup. |
