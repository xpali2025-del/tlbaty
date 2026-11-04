# Phase 5: PUK Customer UI, Admin PUK Screen and Method Selector

Read `README.md` first. Reference: plan §4.3, §5.1 (2c, 2d), §5.2, §6.1, §6.2.

## Goal
Make PUK mode usable end to end:
- **The customer** signs in with phone and password, requests a PUK, enters it and sets a password.
- **The admin** works the PUK queue and creates or revokes PUKs.
- **The admin** chooses the active login method from six cards with readiness checks.

## Facts (verified)
- **Settings UI:** `app/manage/components/settings-manager.tsx`. It currently shows the 3 legacy channels from `OTP_CHANNELS` (`lib/otp/channel.ts`).
- **Delete-account re-auth:** in PUK mode it returned `METHOD_UNAVAILABLE` in phase 3. This phase wires the password into it.
- **Readiness inputs:**
  - SMS: `isSmsConfigured()` (`lib/otp/providers/sms.ts`);
  - worker: `checkWorker()` (`lib/whatsapp-status.ts`);
  - PUK: the pepper check from phase 4.

## Tasks

### 5.1 Readiness: implement `readiness()` for each method in `lib/auth/methods/`
| Method | Ready when | Problem text (Arabic) when not |
|---|---|---|
| `wa_web` | worker URL and token set, and `checkWorker() === "ready"` | "عامل واتساب غير مضبوط" / "عامل واتساب لا يستجيب" / "رقم واتساب غير مسجّل الدخول" |
| `sms` | `isSmsConfigured()` | "بيانات SMS Gateway غير مضبوطة" |
| `wa_web_sms` | SMS ready (WhatsApp may be down: fallback) | as `sms`, plus a warning when the worker is down |
| `wa_chat` | as `wa_web`, plus a bot number set (`site_settings` or env `WHATSAPP_BOT_NUMBER`) | as above, plus "رقم البوت غير مضبوط" |
| `puk` | `PUK_PEPPER` valid | "PUK_PEPPER غير مضبوط في Vercel" |
| `wa_cloud` | always `{ ready: false, problems: ["لم يُفعَّل بعد"] }` until phase 6 | |

- **Timeouts:** every readiness check finishes within 5 s (`Promise.race`) and never throws.

### 5.2 Admin: method selector
- **Cards:** in Settings, replace the 3-option channel block with 6 radio cards, each showing label, hint and readiness (green "جاهز" or the red problems).
- **Server action `setLoginMethod(key, { confirmPukSwitch })`:**
  - re-runs readiness server-side; not ready → Arabic error listing the problems;
  - switching to `puk` without `confirmPukSwitch` → error `"PUK_CONFIRM_REQUIRED:<count>"`, where count is the active, non-deleted customers without `password_hash`. The UI then shows the confirmation dialog with that number;
  - writes `login_method` **and** `otp_channel = legacyChannelFor(key)`;
  - audits `"login_method: a → b by <user>"`.
- **Permission:** `settings`. Never touches sessions.

### 5.3 Admin: PUK screen (RBAC `puk`)
- **RBAC:** add `"puk"` to `SCREENS` (label `"رموز PUK"`; roles `admin`, `manager`) and `SCREEN_DATA.puk = ["pukRequests", "livePuks"]`.
- **Panels** (plan §6.2):
  - the pending queue;
  - the "إنشاء رمز لرقم" form (phone with the existing `PhoneField`, purpose radio);
  - live PUKs;
  - recent PUK audit (last 50 events).
- **The create result dialog:**
  - shows the PUK once, large and monospace, with a copy button;
  - a ready message: `"رمز تفعيل حسابك في {اسم المتجر}: {PUK}\nصالح حتى {التاريخ والساعة}. لا تشاركه مع أحد."`, with a copy button and a `wa.me/{phone}?text=` button;
  - closing it removes the PUK from React state.
- **Server actions:** `createPuk`, `rejectPukRequest`, `revokePuk`, each wrapped with `serverAction`, plus `assertManagePermission("puk")`.

### 5.4 Customer UI (PUK mode), in `components/auth/login-form.tsx`
- **Get the method** from `GET /api/auth/method` (plan §7; add the route if missing, cached 30 s).
- **Phone step**, then `password/status`:
  - `hasPassword` → password step (2c), with "نسيت كلمة المرور؟" → recovery request;
  - otherwise → step 2d: "اطلب رمز PUK" (name field if `password/status` says there is no account; add `{ hasAccount }` to that response) and "لديّ رمز PUK".
- **PUK entry:** one field, accepts `abcd efgh`, shows `XXXX-XXXX`.
- **Set-password screen:** two fields with reveal toggles, a live policy hint, and the Arabic reason messages from phase 4.
- **After a request:** show "تم إرسال طلبك. سيتواصل معك المتجر ويعطيك رمز PUK." plus the store's WhatsApp link.
- **Locked:** a countdown from `retryAfter`.
- **Mobile behaviour:** `autocomplete="current-password"` on login and `"new-password"` on set; the numeric keypad only on the phone field.

### 5.5 Account page
- **"تغيير كلمة المرور"** card, when the customer has a password.
- **Delete re-auth in PUK mode:** asks for the password (`/api/account/delete/confirm { password }`).

## Tests

### `tests/auth-readiness.test.ts` (new)
1. `each method reports ready or the exact Arabic problems`: table-driven over env and mocks (worker ready / not_ready / unreachable, SMS on/off, pepper on/off).
2. `readiness never throws and resolves within 5s when the worker hangs` (fake timers).
3. `wa_cloud is not ready before phase 6`.

### `tests/manage-login-method.test.ts` (new, `manage-actions` style)
1. `refuses a method that is not ready, with its problems`.
2. `switching to puk needs confirmation and reports the affected customer count`: 3 active customers without a password, 1 with, 1 deleted → `PUK_CONFIRM_REQUIRED:3`.
3. `saving writes login_method and the legacy otp_channel, and audits`.
4. `does not revoke any session` (session count unchanged).
5. `requires the settings permission`.

### `tests/manage-puk.test.ts` (new)
1. `createPuk returns the code once; the list never contains it` (`getLivePuks` rows have no code field).
2. `issuing from a request marks it issued with the admin name`.
3. `reject marks a request rejected`.
4. `revoke ends a live PUK; verify then fails`.
5. `requires the puk permission` (editor → Arabic error).

### `tests/e2e/puk-mode.e2e.cjs` (new, Playwright, 375×812 and 1280×800)
1. **Admin:**
   - sign in to `/manage`, open Settings;
   - choose PUK: the confirmation shows the customer count; confirm and save.
2. **Customer** (new number):
   - `/login` → phone → "اطلب رمز PUK" with the name → success message.
3. **Admin:** the PUK screen shows the request → "إنشاء رمز" → read the PUK from the dialog.
4. **Customer:**
   - "لديّ رمز PUK" → enter it in lower case with a space;
   - set the password `"قمر الليل جميل"` → signed in.
5. **Sign-out and lockout:**
   - sign out, then sign in with the password: works;
   - 5 wrong passwords → the lock countdown appears.
6. **Recovery:**
   - the admin issues a recovery PUK; the customer recovers and sets a new password;
   - the old password fails.
7. **Restore:** the admin switches back to the previous method; the customer's existing session stays valid.

The script exits 0.

## Exit criteria
- [ ] All tests pass; the e2e script passes at both viewport sizes (output in the PR).
- [ ] The UI never shows a PUK after its dialog is closed; there is no endpoint that returns a stored PUK.
- [ ] Switching methods never signs anyone out (test 4 and e2e step 7).

## Rollback
Switch `login_method` back from the panel. If the deploy itself must be reverted, set `login_method` to a code method first: the old code reads `otp_channel`, which is kept in sync.
