## Summary
<!-- Brief description of the changes introduced by this PR -->

## Service(s) Affected
- [ ] `api-gateway`
- [ ] `auth-service`
- [ ] `user-service`
- [ ] `room-service`
- [ ] `signaling-service`
- [ ] `chat-service`
- [ ] `sfu-service`
- [ ] `recording-service`
- [ ] `notification-service`
- [ ] `FRONTEND/web`
- [ ] Shared infra/observability/CI

## Quality Checklist
- [ ] `npm run lint` passes with 0 errors
- [ ] `npm run typecheck` (`tsc --noEmit`) passes cleanly
- [ ] Unit & smoke tests pass (`npm test`)
- [ ] `npm run build` succeeds
- [ ] Prisma schema migrations applied and verified (if database schema was touched)
- [ ] Shared observability synced via `scripts/sync-observability.ps1` (if observability was touched)
- [ ] Documentation updated accordingly (`MD/`, `docs/`, `README.MD`)
