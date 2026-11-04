# Phase 2: Profile (Three-Part Name, Optional Email) and Phone-First Entry

Read `README.md` first. Reference: plan §3.4, §4.1, §4.2, §5.1, §5.2.

## Goal
After proving the phone with any code or chat method, a new customer, or an existing customer without a name, completes a short profile: **three-part name** (required) and **email** (optional). Sign-in and sign-up become one phone-first flow.

## Facts (verified)
- **Login UI:** `components/auth/login-form.tsx` (phone → code), `components/auth/login-dialog.tsx`, `components/auth/phone-field.tsx`.
- **Verify routes:** `app/api/auth/verify-otp/route.ts` and `app/api/auth/chat-login/verify/route.ts`. Both end in `completeLogin()`.
- **Account page:** `app/account/page.tsx`. Its name comes from `getCustomerDisplayName()` (the last order's name) in `lib/otp/customer-orders.ts`.
- **Checkout:** sends orders to `app/api/orders/route.ts`, which requires sign-in.

## Tasks

### 2.1 `lib/auth/profile.ts` (pure, no DB)
- **`normalizeFullName(input)`:**
  - NFC;
  - remove U+0640 (tatweel) and bidi controls (U+200E, U+200F, U+202A–U+202E, U+2066–U+2069);
  - trim, then collapse any whitespace run to one space.
- **`validateFullName(input)`** returns `{ ok: true, value } | { ok: false, message }`, after normalisation:
  - at least 3 space-separated parts;
  - every part has at least 2 characters and matches `/^[\p{Script=Arabic}\p{Script=Latin}\p{M}'-]+$/u`, with no digits;
  - total length 5–80.
- **Arabic messages:**
  - fewer than 3 parts → `"اكتب اسمك الثلاثي (ثلاث كلمات على الأقل)"`;
  - bad characters → `"الاسم يقبل الحروف العربية أو الإنجليزية فقط"`;
  - length → `"الاسم بين 5 و80 حرفاً"`.
- **`normalizeEmail(input)` and `validateEmail(input)`:**
  - empty → `{ ok: true, value: null }`;
  - otherwise lower-case and trim; maximum 254; exactly one `@`; the domain contains a dot; no spaces;
  - message `"البريد الإلكتروني غير صالح"`.

### 2.2 Server
- **`completeLogin()`** returns `{ ok: true, needsProfile: boolean }`, where `needsProfile = customer.full_name is null`. Existing callers keep working.
- **Both verify routes** add `needsProfile` to their JSON success response.
- **New route `app/api/account/profile/route.ts`:**
  - `GET` returns `{ fullName, email }` for the session.
  - `POST { fullName, email? }` validates with 2.1 and saves.
    - First time (`profile_completed_at` was null): also sets `profile_completed_at = now()`.
    - Audit `profile_completed` with no name in `detail`.
    - Errors: `AUTH_REQUIRED` 401, `INVALID_NAME` 400, `INVALID_EMAIL` 400, `RATE_LIMITED` 429. The limit is 20 per session per hour (database-backed, following `lib/otp/rate-limit.ts`; use `auth_events` counts).
- **`getCustomerDisplayName()`** prefers `customers.full_name`, then falls back to the last order's name.

### 2.3 UI
- **`login-form.tsx`:** after a successful verify with `needsProfile: true`, show the profile step (plan §5.1 step 3) **inside the same form or dialog**, then complete. Copy text exactly as in the plan. Inline errors appear on blur and clear as soon as the value becomes valid. The submit button text is "حفظ ومتابعة".
- **Checkout guard:** if the session customer has no `full_name`, the checkout page shows the profile step before the order form. The server also rejects `POST /api/orders` with `PROFILE_REQUIRED` (409) when `full_name` is null.
- **`/account`:** profile card with the name and email, and an edit form using the same route.
- **Number retention:** the phone stays in component state between steps, never in the URL.

## Out of scope
Passwords, PUK and deletion.

## Tests

### `tests/auth-profile.test.ts` (new, pure)
`validateFullName` cases (input → expected):

| Input | Expected |
|---|---|
| `"محمد أحمد علي"` | ok `"محمد أحمد علي"` |
| `"  محمد   أحمد\tعلي  "` | ok `"محمد أحمد علي"` |
| `"مـحـمد أحمد علي"` | ok `"محمد أحمد علي"` (tatweel removed) |
| `"عبد الله محمد"` | ok (3 parts) |
| `"Mohammed Ahmed Ali"` | ok |
| `"محمد أحمد"` | fail, message contains `"الثلاثي"` |
| `"محمد أحمد 3لي"` | fail, letters-only message |
| `"م أحمد علي"` | fail (part shorter than 2) |
| `"‮محمد أحمد علي"` | ok, with the control character removed |
| 81-character valid name | fail, length message |

`validateEmail` cases:

| Input | Expected |
|---|---|
| `""` | ok `null` |
| `" Ali@Example.COM "` | ok `"ali@example.com"` |
| `"a@b"` | fail |
| `"a b@c.com"` | fail |
| `"a@@c.com"` | fail |

### `tests/auth-profile-route.test.ts` (new, PGlite, mock `next/headers` cookies like `tests/otp.test.ts`)
1. `verify returns needsProfile true for a new customer`: create a code via `createAndSendOtp` with the providers mocked, call the verify route handler, get `{ ok: true, needsProfile: true }`.
2. `verify returns needsProfile false once the name is saved`.
3. `POST /api/account/profile saves the normalised name and email and sets profile_completed_at once`: post twice; `profile_completed_at` does not change on the second post.
4. `profile route rejects without a session`: 401 `AUTH_REQUIRED`.
5. `profile route rejects an invalid name with INVALID_NAME and writes nothing`.
6. `audit row has no name`: the `profile_completed` event's `detail` does not contain any part of the name.
7. `orders route returns PROFILE_REQUIRED for a customer without a name` (409), and accepts once the name exists. Reuse the order fixture from `tests/orders-route.test.ts`.
8. `display name prefers the profile name over the last order name`.

### `tests/e2e/auth-profile.e2e.cjs` (new, Playwright, not in CI)
- **Setup:** run against `pnpm build && pnpm start` with a seeded local database (the e2e database used earlier) and `OTP_TEST_SINK=/tmp/otp-sink.json`.
- **At 375×812:**
  1. Open `/login`, enter a new number, read the code from the sink, enter it.
  2. The profile step appears. Enter a 2-part name: the error appears on blur.
  3. Fix the name: the error clears. Save.
  4. You land on the page you came from, and `/account` shows the name.
  5. Sign out, sign in again with the same number: no profile step this time.
- **Exit:** the script exits 0. Put the run command at the top of the file.

## Exit criteria
- [ ] All listed tests pass, and the e2e script passes locally (attach its output to the PR).
- [ ] Existing customers are asked for the name once, on their next sign-in.
- [ ] No name or email in `auth_events.detail` or logs.

## Rollback
Revert the deploy. The new columns stay; old code ignores them. Checkout no longer requires a name.
