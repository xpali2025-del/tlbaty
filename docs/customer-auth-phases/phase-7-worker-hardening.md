# Phase 7: WhatsApp Web Worker Hardening

Read `README.md` first. Reference: plan §8 (WhatsApp Web hardening row) and §12 (ban risk).

## Goal
Make the `whatsapp-web.js` worker safer and self-healing without changing its HTTP contract:
- token rotation without downtime;
- exit on lost authentication, so the supervisor restarts it;
- truthful `/health`;
- an operations guide for a dedicated number, an HTTPS tunnel and an encrypted session backup.

## Facts (verified)
- **Files:** `worker/whatsapp/server.mjs` (client setup: `LocalAuth`, `HOST` default `127.0.0.1`, country allow list), `handler.mjs` (HTTP handler factory: bearer token of at least 16 characters with `timingSafeEqual`, body limit, cooldown, caps, breaker, queue), `inbound.mjs` (chat-login claims).
- **Tests:** `tests/whatsapp-worker.test.ts`, `tests/whatsapp-inbound.test.ts`, `tests/whatsapp-status.test.ts`.
- **App side:** `lib/whatsapp-status.ts` `checkWorker()` reads `/health` and expects `{ ready: boolean }`.

## Tasks
1. **Two tokens.**
   - `createHandler({ token, nextToken? })` accepts a request whose bearer matches **either**, both with constant-time compare. `nextToken`, when given, must also be at least 16 characters.
   - `server.mjs` reads `WHATSAPP_WORKER_TOKEN` and `WHATSAPP_WORKER_TOKEN_NEXT`.
   - App side: `lib/otp/providers/whatsapp.ts` (and the inbound claim) keep sending `WHATSAPP_WORKER_TOKEN`.
   - **Document the rotation:** set `_NEXT` on the worker, switch the app's token to the new value, then move the new value to `WHATSAPP_WORKER_TOKEN` on the worker and clear `_NEXT`.
2. **Exit on lost auth.**
   - On the client events `auth_failure` and `disconnected` (reason anything but a deliberate logout), log one line without personal data and call an injected `exit(1)`.
   - Use dependency injection (`createLifecycle({ client, exit, log })` in a new `worker/whatsapp/lifecycle.mjs`) so it can be tested.
   - Before exiting, mark not ready so `/health` reports `ready: false` during shutdown.
3. **Truthful health.** `/health` returns `{ ready, since, breakerOpen }`:
   - `ready` is true only after the `ready` event and before any `disconnected`;
   - `breakerOpen` reflects the existing circuit breaker.
   - Keep `ready` as the field `checkWorker()` reads.
4. **App banner.** When `checkWorker()` is not `ready` and the active method uses the worker (`wa_web`, `wa_web_sms`, `wa_chat`), the admin dashboard header shows a red banner, "عامل واتساب متوقف: …", with the fallback in effect. Reuse the readiness from phase 5 if present; otherwise call `checkWorker()` once per dashboard load.
5. **Operations guide:** extend `worker/whatsapp/README.md` with these sections (Arabic):
   - **Dedicated number:** never the support number.
   - **Expose only through an HTTPS tunnel:** Cloudflare Tunnel example; keep `HOST=127.0.0.1`.
   - **Run under a supervisor that restarts on exit:** `systemd` unit or `pm2` example with `restart: always`.
   - **Encrypted backup of the `LocalAuth` directory:** e.g. `tar` + `age`, with a restore test.
   - **Token rotation steps** (task 1).

## Tests

### `tests/whatsapp-worker.test.ts` (extend; keep existing cases unchanged)
1. `accepts the current token and the next token`.
2. `rejects any other token with 401`.
3. `rejects a next token shorter than 16 characters at startup`.

### `tests/whatsapp-lifecycle.test.ts` (new)
Use a fake `EventEmitter` client.
1. `reports not ready before the ready event and ready after it`.
2. `auth_failure marks not ready and exits with 1`.
3. `disconnected marks not ready and exits with 1`.
4. `log lines contain no phone numbers` (emit with a fake number in the payload; assert the logs do not contain it).

### `tests/whatsapp-status.test.ts` (extend)
1. `treats { ready: false, breakerOpen: true } as not_ready`.

## Exit criteria
- [ ] All tests pass.
- [ ] Manual kill test on the real worker: stop the WhatsApp session (log out on the phone). The worker exits, the supervisor restarts it, and `/health` is `ready: false` until the QR is scanned again. Note the timings in the PR.
- [ ] Token rotation performed once on the real worker without failed sends (the `auth_events` `otp_failed` count is unchanged during the rotation).

## Rollback
Deploy the previous worker build. The app is compatible with both, because the `/health` field `ready` is unchanged.
