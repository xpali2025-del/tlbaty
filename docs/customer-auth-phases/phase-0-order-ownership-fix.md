# Phase 0: Order Ownership Fix (privacy leak)

Read `README.md` in this folder first. Reference: `docs/customer-auth-plan.md` §2.2 (D1) and §3.3.

## Goal
A signed-in customer must see **only** orders that belong to them. Today, old guest orders are matched by phone alone. That leaks another person's orders when a phone number changes hands, and it will leak a deleted customer's orders once phase 3 adds deletion.

## Facts (verified)
- **The rule:** `lib/otp/customer-orders.ts` line ~65:
  ```ts
  const owns = (owner: OrderOwner) =>
    or(eq(orders.customerId, owner.id), and(isNull(orders.customerId), eq(orders.customerPhoneNormalized, owner.phone)))
  ```
  `OrderOwner = { id: string; phone: string }`.
- **Callers:** `app/orders/page.tsx` (`listOrdersForCustomer`), `app/orders/[orderNumber]/page.tsx` (`getOrderForCustomer`), `app/account/page.tsx` and `app/api/auth/me/route.ts` (`countOrdersForCustomer`). They pass the `customer` row from `resolveSession()`, which includes `createdAt`.
- **Orders now require sign-in:** `app/api/orders/route.ts` returns `AUTH_REQUIRED`. New orders always have `customer_id`, so phone matching is only needed for orders created **before** the account existed.

## Tasks
1. **Schema:** add `detachedAt: at('detached_at')` (nullable timestamptz) to `orders` in `lib/db/store/orders.ts`, then `pnpm db:generate`. The migration must contain only `ALTER TABLE "store"."orders" ADD COLUMN "detached_at" timestamp with time zone;`.
2. **Owner type:** change `OrderOwner` to `{ id: string; phone: string; createdAt: Date }`.
3. **New rule:**
   ```ts
   or(
     eq(orders.customerId, owner.id),
     and(
       isNull(orders.customerId),
       isNull(orders.detachedAt),
       eq(orders.customerPhoneNormalized, owner.phone),
       lt(orders.createdAt, owner.createdAt),
     ),
   )
   ```
   The rule must stay in one place (`owns`), and all three exported functions must use it.
4. **Callers:** update all four, if their types do not already satisfy the new `OrderOwner`. No other behaviour change.
5. **Comment:** add an Arabic comment above `owns` saying why each condition exists (account owner; guest orders before the account; never detached).

## Out of scope
Account deletion itself (phase 3). Do not set `detached_at` anywhere yet, except in tests.

## Tests: `tests/customer-orders-ownership.test.ts` (new, PGlite)
Setup:
- **Customer A:** phone `967700000001`, `created_at = 2026-01-10`.
- **Customer B:** phone `967700000002`.
- **Orders**, all with valid required columns. Copy the minimal order insert from `tests/orders-route.test.ts` or `tests/admin-orders.test.ts`:

| Order | customer_id | phone (normalized) | created_at | detached_at |
|---|---|---|---|---|
| O1 | A | 967700000001 | 2026-02-01 | null |
| O2 | null | 967700000001 | 2026-01-05 | null |
| O3 | null | 967700000001 | 2026-01-20 | null |
| O4 | null | 967700000001 | 2026-01-05 | 2026-03-01 |
| O5 | B | 967700000001 | 2026-01-05 | null |
| O6 | null | 967700000009 | 2026-01-05 | null |

Cases (exact names):
1. `lists the customer's own orders and guest orders placed before the account existed`: `listOrdersForCustomer(A)` returns exactly `[O1, O2]` by order number, newest first.
2. `ignores guest orders placed after the account was created`: O3 is not in the list.
3. `ignores detached orders even when the phone matches`: O4 is not in the list.
4. `never shows another customer's order with the same phone`: O5 is not in the list.
5. `ignores guest orders of other phones`: O6 is not in the list.
6. `count matches the list`: `countOrdersForCustomer(A) === 2`.
7. `detail follows the same rule`:
   - `getOrderForCustomer(A, O1.number)` and `(A, O2.number)` return the orders;
   - O3, O4, O5 and O6 return `null`.

## Verification
- The Definition of done in `README.md`.
- In the PR, paste the generated migration SQL.

## Exit criteria
- [ ] The migration only adds `orders.detached_at`.
- [ ] All 7 tests pass. The existing `tests/orders-*.test.ts` and `tests/customer-data.test.ts` still pass unchanged.
- [ ] `/orders` and `/account` still render for a signed-in customer (`pnpm smoke` green).

## Rollback
Revert the commit. The column stays and is unused, which is harmless.
