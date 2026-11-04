# Customer Authentication: Phases for the Implementing Agent

This folder splits `docs/customer-auth-plan.md` into **8 phases**. Each phase file is a self-contained brief: give the agent **one file at a time**, in order, and merge it before the next one starts.

| Phase | File | Depends on | Size | Production impact |
|---|---|---|---|---|
| 0 | `phase-0-order-ownership-fix.md` | none | S | Closes a privacy leak. Must ship first. |
| 1 | `phase-1-schema-and-method-registry.md` | 0 | M | Additive schema; login behaviour unchanged. |
| 2 | `phase-2-profile-and-phone-first.md` | 1 | M | New profile step after sign-in. |
| 3 | `phase-3-account-deletion-and-customers-screen.md` | 1, 2 | L | Customers can delete accounts; new admin screen. |
| 4 | `phase-4-password-and-puk-backend.md` | 1 | L | API only; not reachable until phase 5 enables it. |
| 5 | `phase-5-puk-ui-and-method-selector.md` | 2, 4 | L | Admin can switch to PUK mode. |
| 6 | `phase-6-whatsapp-cloud-api.md` | 1, 5 | M | New official WhatsApp option. Needs Meta approval. |
| 7 | `phase-7-worker-hardening.md` | none (after 1 preferred) | S | Worker restarts itself; rotating token. |

Phases 6 and 7 can run in parallel with 4–5.

---

## Rules for every phase (give these to the agent with each phase)

### Repository facts
- Next.js 16 App Router, React 19, Drizzle ORM on Postgres schema `store`, deployed on Vercel. Arabic RTL UI.
- **Database access:** `db` from `lib/db/client.ts`, with `prepare: false` because production uses the Supabase transaction pooler. Every query with parameters costs two round trips, so keep sequential queries in a request to a minimum.
- **Migrations:**
  - Edit `lib/db/store/*.ts`, then run `pnpm db:generate`, then read the generated SQL by hand.
  - `ALTER TYPE ... ADD VALUE` must be in **its own migration** and must not be used in the same migration.
  - Never edit an existing migration file.
  - Production applies migrations from `/api/diagnose` or `pnpm db:migrate`.
- **Server actions** in `app/manage/*-actions.ts`:
  - Wrap them with `serverAction` from `lib/server-action.ts`.
  - Components import them from `app/manage/client-actions.ts` (`unwrapAll`), so errors reach the browser in production.
  - Throw `Error` with an **Arabic** message for expected failures.
- **Route handlers** return `{ ok: true, ... }` or `{ ok: false, error: "CODE", message: "Arabic text" }`, using the request context helpers in `lib/otp/request-context.ts`.
- **Every successful customer login** must end in `completeLogin()` (`lib/otp/login.ts`).
- **Tests:** vitest with PGlite, following `tests/otp.test.ts` and `tests/manage-actions.test.ts`:
  - `drizzle(new PGlite())`, `migrate(...)` from `drizzle/`, `vi.mock('@/lib/db/client', () => ({ db }))`;
  - mock `next/headers` and `next/cache` when needed.
- **Style:** match the surrounding code. Arabic comments where the file uses Arabic, the same comment density, no new dependencies unless the phase says so.

### Definition of done (every phase)
1. All tests in the phase's **Tests** section exist, with the exact names given, and pass.
2. These commands pass locally in a clean environment (unset `SESSION_SECRET MANAGE_SESSION_SECRET MANAGE_USERNAME MANAGE_PASSWORD OTP_PROVIDER DATABASE_URL NODE_ENV` first, as CI does):
   ```
   pnpm exec drizzle-kit check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm check:budget && pnpm smoke
   ```
3. **No new lint warnings** compared with `main`. Report both counts.
4. **No secret, code, password, PUK, full phone number or name** appears in logs, `auth_events.detail` or error messages.
5. **Commit and PR:**
   - The commit message is in Arabic, like the repository history.
   - The PR description lists every test added and the command output summary.
6. The phase's **Exit criteria** checklist is copied into the PR with each box ticked, or explained if not.

### When the agent must stop and ask
- A test in this brief contradicts the code it finds.
- A change would need a destructive migration (drop, rename, type change on data).
- A phase needs a decision marked **[A]** in `customer-auth-plan.md` §11 that has not been confirmed.
