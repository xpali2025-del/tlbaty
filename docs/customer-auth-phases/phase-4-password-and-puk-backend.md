# Phase 4: Password and PUK Backend

Read `README.md` first. Reference: plan §3.4, §3.5, §4.3, §7, §8.

**Confirm before starting:** §11 Q5 (72 hours, 5 attempts) and Q10 (minimum 10 characters).

## Goal
The server side of PUK mode: password hashing and policy, PUK creation, verification and revocation, setup tokens, password login with lockout, password change, and the routes in plan §7. Nothing is reachable from the UI until phase 5 sets `login_method = 'puk'`. Every route here returns `METHOD_DISABLED` (403) unless the active method is `puk`, except `/api/account/password`.

## Facts (verified)
- **Panel hashing:** panel users use `scrypt` from `node:crypto` with the format `salt:hash` [`lib/manage-users.ts`]. **Do not reuse that format**; customers get the versioned format below.
- **Sessions:** `createSession`, `revokeAllSessions` in `lib/otp/session.ts`. Login ends in `completeLogin()`.
- **Rate limits:** the pattern counts rows in `auth_events` per phone and per IP within a window [`lib/otp/rate-limit.ts`].
- **Phone validation and country allow list:** `lib/otp/phone.ts`, `site_settings.login_countries`.

## Tasks

### 4.1 `lib/auth/password.ts`
- **Hash format:** `scrypt$1$<N>$<r>$<p>$<saltB64>$<hashB64>` with N = 32768, r = 8, p = 1, a 32-byte salt and a 64-byte key.
  - Use the async `scrypt` (not `scryptSync`) with `maxmem: 64 * 1024 * 1024`.
- **Functions:**
  - **`hashPassword(pw)`.**
  - **`verifyPassword(pw, stored)`:** constant time; returns `{ ok, needsRehash }`. `needsRehash` is true when the stored parameters are below current.
  - **`dummyVerify()`:** runs one scrypt with fixed parameters, for unknown phones.
- **`checkPasswordPolicy(pw, { phone })`** returns `{ ok } | { ok: false, reason: "too_short" | "too_long" | "common" | "contains_phone" }`:
  - length 10–128, counting Unicode code points;
  - `common`: the lower-cased password is in `lib/auth/common-passwords.txt`, a bundled list of at least 10 000 entries. Add `12345678`-style sequences, `qwerty`, Arabic keyboard row strings and the store name `tajline`, `تاج لاين`. Load once.
  - `contains_phone`: contains the local or international phone digits (6+ consecutive digits of the phone).
- **Arabic messages per reason**, shown to the customer.

### 4.2 `lib/auth/puk.ts`
- **Alphabet** `ABCDEFGHJKMNPQRSTVWXYZ23456789`, 8 characters, from `crypto.randomInt`.
  - `formatPuk(raw)` → `XXXX-XXXX`.
  - `parsePukInput(s)`: upper-cases and strips `-` and spaces; null if not 8 alphabet characters.
- **`hashPuk(phone, code)`:** `HMAC-SHA256(pepper, phone + ":" + code)` hex.
  - The pepper comes from `PUK_PEPPER`, decoded as base64 or hex, and must be at least 32 bytes.
  - If it is missing, **every** PUK function throws `PukConfigError` (fail closed).
- **`createPuk({ phone, purpose, requestId?, createdBy })`**, one transaction:
  - revoke any live PUK for the phone;
  - insert a new one with `expires_at = now + puk_ttl_hours`;
  - if `requestId` is given, mark the request `issued` with `handled_by`;
  - audit `puk_issued`;
  - return `{ puk: formatted, expiresAt }`. This is the only place the clear PUK exists.
- **`verifyPuk({ phone, input })`**, one transaction with `SELECT ... FOR UPDATE` on the live row:
  - **missing, expired or revoked** → `INVALID_PUK`, and audit `puk_failed`;
  - **wrong** → increment `attempts`; at `puk_max_attempts`, set `revoked_at`, audit `puk_revoked` and return `TOO_MANY_ATTEMPTS`; otherwise `INVALID_PUK`;
  - **purpose checks:** `first_setup` on an account that already has a password, or `recovery` on an account without one → `INVALID_PUK`;
  - **blocked or deleted customer** → `ACCOUNT_BLOCKED`;
  - **success:**
    - set `used_at`;
    - generate a 32-byte setup token and store its SHA-256 in `setup_token_hash`, with `setup_token_expires_at = now + 10 min`;
    - audit `puk_used`;
    - return `{ setupToken, purpose }`.
- **`consumeSetupToken(token)`:** single use (set `setup_token_hash = null` in the same update that checks it, using `UPDATE ... WHERE setup_token_hash = $1 AND setup_token_expires_at > now() RETURNING phone, purpose`).
- **Other functions:**
  - **`revokePuk(id, by)`.**
  - **`requestPuk({ phone, fullName?, purpose })`:** inserts a `pending` request unless one is pending for that phone within 24 h (then no-op), and audits `puk_requested`.
  - **Expiry in the daily cron:** mark expired live PUKs `revoked_at`, and requests older than 7 days `expired`.

### 4.3 Routes (all return `METHOD_DISABLED` unless the active method is `puk`)
Contracts are exactly plan §7: `password/status`, `password/login`, `puk/request`, `puk/verify`, `password/set`, and `account/password` (works in any method if the customer has a password).
- **`password/login`:**
  - unknown phone → `dummyVerify()` then `INVALID_CREDENTIALS`;
  - **lockout:** after 5 failed attempts per phone in 15 minutes → `LOCKED` with `retryAfter` in seconds. The lock lasts 15 minutes and doubles for each further lock in 24 h, up to 24 h. Compute it from `auth_events` `password_failed` rows (no new table);
  - **per IP:** 30 failures per hour → `RATE_LIMITED`;
  - **success:** `completeLogin()`, audit `password_login`, rehash if needed.
- **`password/set`:**
  - consume the setup token and check the policy (`WEAK_PASSWORD` with the reason) and `password === confirm` (`MISMATCH`);
  - for `first_setup` without an account, create the customer with the `full_name` from the latest PUK request for that phone; if there is none, require `fullName` in the body and validate it with `lib/auth/profile.ts`;
  - save the hash and `password_set_at`, revoke all sessions, then `completeLogin()`, audit `password_set`.
- **`account/password`:** checks `current`, then the policy; revokes all other sessions (keeps the current one).
- **`puk/request`:** always returns `{ ok: true }` for valid input, whether queued or deduplicated. Limits: 3 per phone per day, 10 per IP per day.

### 4.4 Diagnose
In `lib/diagnose.ts`, `PUK_PEPPER` is required when `login_method = 'puk'`. Pass the method into `checkEnv` as an option.

## Tests

### `tests/auth-password.test.ts` (new, pure)
1. `hash has the versioned format and verifies`.
2. `wrong password fails in constant-time compare` (assert `ok: false`; spy on `timingSafeEqual`, which is called).
3. `needsRehash is true for a hash with N=16384`.
4. `policy`:
   - `"short"` → `too_short`;
   - 129 characters → `too_long`;
   - `"password123"` → `common`;
   - `"Ab967781234567x"` with phone `967781234567` → `contains_phone`;
   - `"قمر الليل جميل"` (14 characters) → ok;
   - 10 emoji → ok (code points).
5. `blocklist is loaded once`: spy on `readFileSync`, called once across 3 checks.

### `tests/auth-puk.test.ts` (new, PGlite, `PUK_PEPPER` set in the test)
1. `formats and parses PUK input`: `" abcd-efgh "` parses; `"ABCD-EFG0"` (contains 0) → null.
2. `fails closed without a pepper`: `createPuk` throws `PukConfigError`.
3. `create revokes the previous live PUK`: two creates → the first has `revoked_at`, and exactly one live PUK remains.
4. `stored hash is not the code`: the `code_hash` column does not contain the clear code, and is 64 hex characters.
5. `verify succeeds once and returns a setup token`; a second verify with the same code → `INVALID_PUK`.
6. `attempts limit revokes the PUK`: 5 wrong → the last returns `TOO_MANY_ATTEMPTS`; then the right code → `INVALID_PUK`.
7. `expired PUK is invalid` (set `expires_at` in the past).
8. `first_setup is refused for an account that already has a password`; `recovery` is refused for an account without one.
9. `setup token is single use and expires`: second consume → null; consume after 10 minutes (mock `Date`) → null.
10. `concurrent verifies: exactly one succeeds`: `Promise.all` of 5 verifies with the right code → one success, four `INVALID_PUK`. Note in the test that PGlite serialises; also add this case to the real-Postgres probe below.
11. `request dedupes within 24h` and `blocked customers cannot request` (still `{ ok: true }` to the caller, but no row is written).

### `tests/auth-password-routes.test.ts` (new, PGlite)
1. `all PUK routes return METHOD_DISABLED unless the method is puk` (loop over the 5 routes).
2. `status reveals hasPassword only after the method check, rate limited per IP` (21st call → 429).
3. `login: unknown phone and wrong password return the same error code and status`.
4. `login: lockout after 5 failures, retryAfter about 900, doubles on the next lock`.
5. `login: success opens a session, audits password_login, rehashes an old hash`.
6. `set: first setup creates the customer with the request name, signs in, revokes other sessions`.
7. `set: WEAK_PASSWORD and MISMATCH write nothing`.
8. `recovery: new password works, old password fails, all old sessions revoked`.
9. `account/password: requires current, keeps the current session, revokes others`.
10. `no password, PUK or setup token appears in auth_events.detail` (scan all rows).

### `tests/probe/puk-concurrency.probe.ts` (new, real Postgres, not in CI)
Same pattern as the earlier deadlock probe: run only with `PROBE_DB_URL`, create and drop a database `tajline_probe`.
1. 20 parallel `verifyPuk` calls with the right code → exactly 1 success.
2. 20 parallel `createPuk` calls for one phone → exactly 1 live row, no unique-violation error reaching the caller (retry once on `23505`).

Put the run command at the top of the file.

## Exit criteria
- [ ] All tests pass; the probe passes locally (output in the PR).
- [ ] The PUK only exists in clear text inside `createPuk`'s return value.
- [ ] Every route is closed unless `login_method = 'puk'`.
- [ ] `PUK_PEPPER` is documented in `.env.example` with `openssl rand -base64 32`.

## Rollback
Revert the deploy. The method cannot be `puk` yet, so customers are unaffected.
