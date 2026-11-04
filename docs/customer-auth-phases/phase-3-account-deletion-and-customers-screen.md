# Phase 3: Account Deletion and Admin Customers Screen

Read `README.md` first. Reference: plan §2.2 (D2), §4.4, §5.2, §6.3, §11 Q7 and Q11.

**Confirm before starting:**
- §11 Q11: a 7-day grace period.
- §11 Q7: block deletion while there is a balance or an open order.

If either answer differs, stop and ask.

## Goal
A customer can delete the account from `/account` (and start from the public page `/account/delete`) with re-authentication. Deletion is an **anonymising soft delete** finalised by the daily cron after the grace period. Admins get a customers screen with block, force sign-out and delete.

## Facts (verified)
- **Wallet:** `wallets`, `wallet_topups`, `wallet_transactions` and `wallet_audit_log` reference `customers` with `ON DELETE RESTRICT`. `wallet_transactions` rejects UPDATE and DELETE by trigger. **Never `DELETE FROM customers`.**
- **Tables with `ON DELETE CASCADE` to customers, to be removed explicitly at finalise** (the row is not deleted, so the cascade never fires):
  - `customer_sessions`, `customer_phone_history`, `customer_data` (cart, wishlist, addresses, recently viewed);
  - `notifications` and `notification_reads` rows of the customer;
  - `reminder_log`;
  - `coupons` with that `customer_id` and no use.
- **`auth_events.customer_id`** is `ON DELETE SET NULL`; keep these rows.
- **Open-order test:** `holdsStockAndPayment(status)` in `lib/order-status.ts`.
- **Wallet balance:** `wallets.balance`. Pending top-ups are `wallet_topups.status = 'pending'`.
- **Daily cron:** `app/api/cron/cleanup/route.ts`, authorised by `isCronAuthorized`.
- **Sign-out of all devices:** `revokeAllSessions` in `lib/otp/session.ts`.
- **RBAC screens:** `SCREENS` in `lib/permissions.ts`; the dashboard tabs are in `app/manage/dashboard.tsx` with `app/manage/screen-data.ts`.

## Tasks

### 3.1 `lib/auth/deletion.ts` (server-only)
- **`deletionBlockers(customerId)`** returns a list of `"wallet_balance" | "pending_topup" | "open_order"`.
- **`requestDeletion(customerId, ctx)`**, one transaction:
  - if there are blockers → throw `DeletionBlockedError(blockers)`;
  - set `deletion_requested_at = now()` only if null (idempotent);
  - revoke all sessions;
  - audit `deletion_requested`.
- **`cancelDeletion(customerId, ctx)`:** clear `deletion_requested_at`; audit `deletion_cancelled`. `completeLogin()` calls it whenever a customer with `deletion_requested_at` set and `deleted_at` null signs in.
- **`finaliseDueDeletions(now, { graceDays = 7, limit = 50 })`:** for each customer where `deletion_requested_at <= now - grace` and `deleted_at is null`, ordered by `deletion_requested_at`, run **one transaction per customer**:
  1. Re-check blockers. If any appeared (e.g. a late top-up), skip, and audit `deletion_requested` with `detail = "finalise_blocked:<codes>"`.
  2. Customer row: `status = 'deleted'`, `deleted_at = now`, `phone = 'deleted:' || id`, `public_id = 'deleted:' || id`, `full_name`, `email` and `password_hash` set to null, `marketing_opt_in = false`.
  3. Delete the rows listed in Facts.
  4. Delete `puk_codes` and `puk_requests` where `phone` = the **old** phone.
  5. `UPDATE orders SET detached_at = now WHERE customer_id = :id OR (customer_id IS NULL AND customer_phone_normalized = :oldPhone AND detached_at IS NULL)`.
  6. Audit `account_deleted` with `customer_id` and `phone = null`.
  7. Return `{ finalised, skipped }`.
- **Cron:** call `finaliseDueDeletions(new Date())` from the cleanup cron, logging only the counts.

### 3.2 Routes
- **`POST /api/account/delete/start`** → `{ reauth, blockers }`.
  - `reauth` depends on `getActiveMethod()`: code methods → `"code"` (and send an OTP with purpose `delete_account` through `createAndSendOtp`); `wa_chat` → `"chat"`; `puk` → `"password"` (phase 4 adds the password check; until then return `METHOD_UNAVAILABLE`).
  - Limit 5 per session per day.
- **`POST /api/account/delete/confirm { code }`** verifies with purpose `delete_account` only, then `requestDeletion`, then clears the session cookie, and returns `{ deleteAt }`.
  - Errors: `AUTH_REQUIRED`, `REAUTH_FAILED`, `BLOCKED` (with `blockers` and Arabic messages per blocker).
  - Chat re-auth: start a challenge as `chat-login/start` does, and accept its verify for this purpose. If that needs more than a small change to `lib/otp/chat-login.ts`, stop and ask.
- **A login code must not confirm deletion:** a code issued with purpose `login` returns `REAUTH_FAILED`.

### 3.3 UI
- **`/account`:** "حذف الحساب" at the bottom in red, linking to `/account/delete`.
- **`/account/delete`** (public, works signed out):
  - explains what is deleted and what is kept (orders kept for accounting) and the 7-day grace;
  - signed out → a button to sign in, returning here;
  - signed in → shows blockers or the re-auth step, then the final button **"احذف حسابي نهائياً"**;
  - after confirmation: a success page with the date, and the customer is signed out.
- **Copy:** in Arabic, no blame, always a next step (e.g. for blockers, a WhatsApp link to the store number from the site config).

### 3.4 Admin customers screen
- **RBAC:** add `"customers"` to `SCREENS`, with label `"العملاء"`, granted to the `admin` and `manager` roles, and `SCREEN_DATA.customers = ["customers"]`.
- **Loader `getAdminCustomers({ q, page })`:** 50 per page, searching the phone (digits) or the name with `ILIKE`.
  - Returns name, **masked phone** (`9677•••••01`: first 4 and last 2 digits), email, `hasPassword`, `lastLoginAt`, `status`, `deletionRequestedAt`, `deletedAt`.
  - Deleted customers are hidden unless the filter "المحذوفون" is chosen.
- **Server actions** in `app/manage/customers-actions.ts` (wrapped with `serverAction`):
  - **`setCustomerBlocked(id, blocked)`:** blocking also revokes all sessions.
  - **`forceSignOut(id)`.**
  - **`adminDeleteCustomer(id)`:** same blockers; sets `deletion_requested_at = now() - graceDays`, then finalises that one customer immediately. Audit with `detail = "by_admin:<username>"`.
  - Each checks `assertManagePermission("customers")`.
- **Destructive confirmation:** the dialog names the customer (`"احذف حساب <الاسم المقنّع>"`).

## Tests

### `tests/account-deletion.test.ts` (new, PGlite)
Fixture helper `makeCustomer({ balance?, pendingTopup?, openOrder?, ... })`.
1. `blockers list balance, pending top-up and open orders`: each fixture yields exactly its blocker; a clean customer yields `[]`.
2. `request is refused with blockers and changes nothing`: `deletion_requested_at` stays null and the sessions are still active.
3. `request revokes every session and is idempotent`: two calls; the timestamp equals the first call's value.
4. `signing in during the grace period cancels the request`: `completeLogin` clears it and audits `deletion_cancelled`.
5. `finalise skips customers still inside the grace period`: requested 6 days ago → untouched.
6. `finalise anonymises the customer and frees the phone`:
   - after 7 days: `status = 'deleted'`, `phone = 'deleted:<id>'`, name, email and password hash null;
   - a **new** customer can now be created with the old phone.
7. `finalise removes personal data`: `customer_data`, sessions, phone history, the customer's notifications and reads, reminder log, unused personal coupons, and PUK rows for the old phone are all gone. A **used** personal coupon is kept.
8. `finalise keeps the wallet ledger`: the `wallet_transactions` count is unchanged and no trigger error is raised.
9. `finalise detaches owned and phone-matched orders`: `detached_at` is set on both; an order of another customer is untouched.
10. `a re-registered number sees none of the old orders`: new customer with the same phone → `listOrdersForCustomer` returns `[]`. This is the end-to-end proof of phase 0 plus phase 3.
11. `finalise re-checks blockers`: a top-up added after the request → skipped, with the `finalise_blocked:pending_topup` audit.
12. `finalise is idempotent`: running twice gives `finalised = 0` the second time.
13. `audit for deletion has no phone`.

### `tests/account-deletion-route.test.ts` (new)
1. `start sends a delete_account code in code methods`: the SMS or WhatsApp mock is called; the OTP row has purpose `delete_account`.
2. `confirm rejects a login-purpose code` with `REAUTH_FAILED`.
3. `confirm with the right code schedules deletion and clears the cookie`.
4. `confirm returns BLOCKED with blockers`.
5. `start is rate limited after 5 per day` (429).

### `tests/admin-customers.test.ts` (new, follow `tests/manage-actions.test.ts` mocks)
1. `lists with a masked phone and hides deleted customers by default`.
2. `search matches phone digits and name`.
3. `blocking revokes sessions and blocks the next login` (`completeLogin` returns `ACCOUNT_BLOCKED`).
4. `force sign out revokes all sessions`.
5. `admin delete finalises immediately and audits the admin username`.
6. `actions require the customers permission`: an editor role gets the Arabic permission error.

### `tests/e2e/account-deletion.e2e.cjs` (new, Playwright, 375×812, test sink)
1. Sign in, then `/account`, then delete.
2. Read the `delete_account` code from the sink and confirm.
3. You are signed out and the success page is shown.
4. Sign in again: the request is cancelled, and `/account` no longer shows a pending deletion.
5. Exits 0.

## Exit criteria
- [ ] No `DELETE FROM store.customers` anywhere (grep in the PR).
- [ ] All tests pass; the e2e script passes locally.
- [ ] The cron logs only counts.
- [ ] `/account/delete` loads signed out (add it to `scripts/smoke.mjs` CHECKS with 200).

## Rollback
Revert the deploy. Pending requests stay in the database without effect until redeployed. Already finalised customers stay anonymised (intended; irreversible by design).
