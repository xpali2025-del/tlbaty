# Phase 1: Schema and Login-Method Registry

Read `README.md` first. Reference: plan §3.1–§3.3, §3.5.

## Goal
Add every column, table and enum value the later phases need, and replace the `otp_channel` setting with `login_method`, **without changing how anyone logs in today**. Also add a test-only code sink so later phases can run end-to-end tests.

## Facts (verified)
- **Channel today:** `site_settings.otp_channel` (`whatsapp` | `sms` | `whatsapp_sms`, check constraint) [`lib/db/store/marketing.ts` ~151]. Read uncached by `getOtpChannel()`, used by `sendOtp()` [`lib/otp/provider.ts`].
- **Settings save** writes `otpChannel` in `app/manage/actions.ts` ~803 (`saveSettings`).
- **Enums** in `lib/db/store/enums.ts`: `customer_status`, `otp_purpose`, `auth_event_type`.
- **Latest migration** is `0015_otp_channel`.

## Tasks

### 1.1 Migrations (two files)
- **Migration A: columns and tables.** Exactly the SQL intent of plan §3.3, minus the `ALTER TYPE` lines:
  - `customers`: `full_name`, `email`, `password_hash`, `password_set_at`, `profile_completed_at`, `deletion_requested_at`, `deleted_at`, plus checks `customers_full_name_len` and `customers_email_len`.
  - `site_settings`: `login_method` (check over the 6 keys, default `'wa_web'`), `puk_ttl_hours` (default 72, 1–720), `puk_max_attempts` (default 5, 1–20).
  - `UPDATE site_settings SET login_method = CASE otp_channel WHEN 'sms' THEN 'sms' WHEN 'whatsapp_sms' THEN 'wa_web_sms' ELSE 'wa_web' END;`
  - Tables `puk_requests` and `puk_codes` with the indexes in the plan, including the partial unique index `puk_codes_one_live_idx`. `puk_codes` also gets `setup_token_hash text` and `setup_token_expires_at timestamptz` (plan §4.3).
- **Migration B: enum values only.**
  - `customer_status`: add `deleted`.
  - `otp_purpose`: add `delete_account`.
  - `auth_event_type`: add the 13 values from plan §3.3.
- Model all of it in `lib/db/store/*.ts` first, then `pnpm db:generate`. If drizzle-kit puts the enum changes in migration A, split by hand into two journal entries **before** committing, and run `pnpm exec drizzle-kit check` after.

### 1.2 Method registry: `lib/auth/methods/`
- **`types.ts`:** `MethodKey`, `ReadinessCheck`, `LoginMethod` as in plan §3.2.
- **`keys.ts`** (client-safe, no server imports):
  - `METHOD_KEYS`;
  - `METHOD_LABELS` (the Arabic labels in plan §3.1);
  - `isMethodKey()`;
  - `methodKind(key)` returns `"code" | "chat" | "puk"`;
  - `channelForLegacy(otpChannel)` and `legacyChannelFor(method)`, mapping both ways. For methods without a legacy equivalent, `legacyChannelFor` returns `"whatsapp"`.
- **`index.ts`** (server-only):
  - `getActiveMethod(): Promise<MethodKey>` reads `site_settings.login_method` uncached;
  - on error it logs and falls back exactly like `getOtpChannel()` (env `OTP_PROVIDER` mapped with `channelForLegacy`, then `wa_web`).
- **`sendOtp()`** in `lib/otp/provider.ts` now switches on `getActiveMethod()`:
  - `wa_web` and `wa_chat` → WhatsApp worker;
  - `sms` → SMS;
  - `wa_web_sms` → current fallback logic;
  - `wa_cloud` → throw `Error("wa_cloud not implemented")` (phase 6);
  - `puk` → return `{ ok: false, provider: "none", errorCode: "METHOD_DISABLED" }`.
- **Keep `getOtpChannel()`** exported, implemented as `legacyChannelFor(await getActiveMethod())`, so existing imports keep working.

### 1.3 Settings save keeps both in sync
In `saveSettings`, when `otpChannel` is submitted, also write `login_method = channelForLegacy(otpChannel)`. The admin UI is unchanged in this phase.

### 1.4 Test-only code sink
`lib/otp/providers/test-sink.ts`:
- **Active only when** `process.env.OTP_TEST_SINK` is set **and** `process.env.VERCEL` is unset.
- **Behaviour:** writes `{ [phone]: code }` to the JSON file at that path (overwrite per phone, atomic `writeFile` to a temp file then `rename`). `sendOtp()` uses it before any real provider when active.
- **Startup warning:** log once, `"[otp] TEST SINK ACTIVE: codes are written to disk"`.
- **`/api/diagnose`:** add a red row when the sink is active.

### 1.5 `/api/diagnose`
Add `PUK_PEPPER` (optional; invalid if shorter than 32 bytes after base64 or hex decode, else ok) to `lib/diagnose.ts`, with a test case.

## Out of scope
- Any UI change except the diagnose row.
- Password, PUK, profile or deletion logic.

## Tests

### `tests/auth-schema.test.ts` (new, PGlite, migrates the full folder)
1. `adds the new customer columns as nullable`: insert a customer with only phone and `public_id`; read back `full_name`, `email`, `password_hash` and `deleted_at`, all `null`.
2. `rejects a too short or too long full name`: `full_name = 'ab'` violates `customers_full_name_len` (assert the constraint name in the error); 81 characters also fails; 5 characters passes.
3. `login_method accepts only the six keys`: updating to `'telegram'` fails; each of the 6 keys succeeds.
4. `one live PUK per phone`:
   - a second live row (used and revoked both null) for the same phone fails on `puk_codes_one_live_idx`;
   - after setting `revoked_at` on the first, inserting succeeds.
5. `enum values exist`:
   - `select unnest(enum_range(null::store.auth_event_type))::text` contains all 13 new values;
   - `customer_status` contains `deleted`;
   - `otp_purpose` contains `delete_account`.

### `tests/auth-method-migration.test.ts` (new)
Use a PGlite database migrated **up to `0015` only**: copy the first 16 journal entries to a temp folder, as `/api/diagnose` testing did. Then insert a settings row and apply the rest of the migrations.
1. `maps otp_channel sms to login_method sms`.
2. `maps whatsapp_sms to wa_web_sms`.
3. `maps whatsapp to wa_web`.

### `tests/auth-methods.test.ts` (new)
1. `channelForLegacy and legacyChannelFor round-trip the three legacy channels`.
2. `methodKind classifies all six methods`: `wa_chat` → chat, `puk` → puk, the other four → code.
3. `getActiveMethod reads the setting without cache`: update the row between two calls and see the new value.
4. `getActiveMethod falls back to OTP_PROVIDER when the read fails`: mock `db.select` to throw; with `OTP_PROVIDER=sms` it returns `sms`.
5. `sendOtp routes by method`: mock the WhatsApp and SMS providers; for each of `wa_web`, `sms` and `wa_web_sms` (WhatsApp fails → SMS called), assert which mocks were called and how often.
6. `sendOtp refuses in puk mode`: result `{ ok: false, errorCode: "METHOD_DISABLED" }`; no provider called.
7. `saveSettings keeps login_method in sync`: save `otpChannel=whatsapp_sms` → `login_method = 'wa_web_sms'`.

### `tests/otp-test-sink.test.ts` (new)
1. `writes the code per phone when OTP_TEST_SINK is set`.
2. `is inactive on Vercel even if OTP_TEST_SINK is set`: with `VERCEL=1`, the real provider mock is called and no file is written.
3. `never active without the variable`.

### Existing tests
`tests/otp.test.ts`, `tests/otp-sms.test.ts` and `tests/chat-login.test.ts` must pass **unchanged**. If one needs an edit, stop and explain why.

## Exit criteria
- [ ] Two new migrations; the enum migration contains only `ADD VALUE` statements.
- [ ] Production behaviour is identical: same provider for the same stored setting (tests 1.x prove the mapping).
- [ ] All new tests pass; the existing OTP tests are unchanged.
- [ ] `/api/diagnose` shows `PUK_PEPPER` and the test-sink warning row.

## Rollback
Revert the deploy. `otp_channel` is still written by settings and still honoured by the previous code.
