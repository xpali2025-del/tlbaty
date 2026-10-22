import { sql } from 'drizzle-orm'
import { boolean, check, index, jsonb, numeric, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { pk, store } from './common'
import { customers } from './customers'
import { orders } from './orders'
import { walletTopupStatus, walletTxnKind } from './enums'

// All amounts are in the BASE currency (old YER), like product prices; display converts with the live rates.
const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' })
const at = (name: string) => timestamp(name, { withTimezone: true })

/** One row per customer. `balance` is a cache of the ledger: every change goes through lib/wallet/ledger.ts in a transaction. */
export const wallets = store.table('wallets', {
  customerId: uuid('customer_id').primaryKey().references(() => customers.id, { onDelete: 'restrict' }),
  balance: money('balance').notNull().default(0),
  /** A frozen wallet can neither pay nor be topped up until an admin unfreezes it (fraud / dispute hold). */
  frozen: boolean('frozen').notNull().default(false),
  frozenReason: text('frozen_reason'),
  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at').notNull().defaultNow(),
}, (t) => [check('wallets_balance_nonneg', sql`${t.balance} >= 0`)])

/** Customer top-up request: a bank transfer the admin must verify before any balance is credited. */
export const walletTopups = store.table('wallet_topups', {
  id: pk(),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
  status: walletTopupStatus('status').notNull().default('pending'),
  /** Requested amount in `currencyCode`, the rate snapshot, and the base-currency value that gets credited. */
  amount: money('amount').notNull(),
  currencyCode: text('currency_code').notNull(),
  rate: numeric('rate', { precision: 18, scale: 8, mode: 'number' }).notNull(),
  amountBase: money('amount_base').notNull(),
  paymentAccountSnapshot: jsonb('payment_account_snapshot').$type<{
    sourceDocumentId?: string; providerName?: string; accountDisplayName?: string; accountHolderName?: string; accountNumber?: string
  }>(),
  senderName: text('sender_name').notNull(),
  senderPhone: text('sender_phone').notNull(),
  /** Normalized (upper-case, no spaces); a reference can back only one live top-up. */
  reference: text('reference').notNull(),
  /** Set when the same reference already appears on an order (flagged for the reviewer). */
  referenceUsedOnOrder: boolean('reference_used_on_order').notNull().default(false),
  creditedAmountBase: money('credited_amount_base'),
  rejectionReason: text('rejection_reason'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: at('reviewed_at'),
  ip: text('ip'),
  createdAt: at('created_at').notNull().defaultNow(),
}, (t) => [
  index('wallet_topups_customer_idx').on(t.customerId, t.createdAt.desc()),
  index('wallet_topups_status_idx').on(t.status, t.createdAt),
  uniqueIndex('wallet_topups_live_reference_idx').on(t.reference).where(sql`${t.status} in ('pending','approved')`),
  check('wallet_topups_amount_positive', sql`${t.amount} > 0 and ${t.amountBase} > 0 and ${t.rate} > 0`),
])

/**
 * Append-only ledger (a trigger rejects UPDATE/DELETE). `amount` is signed; `balanceAfter` is the wallet balance
 * right after the entry, so the chain can be audited: each balanceAfter = previous balanceAfter + amount.
 */
export const walletTransactions = store.table('wallet_transactions', {
  id: pk(),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
  kind: walletTxnKind('kind').notNull(),
  amount: money('amount').notNull(),
  balanceAfter: money('balance_after').notNull(),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  topupId: uuid('topup_id').references(() => walletTopups.id, { onDelete: 'set null' }),
  /** Free text shown to the customer (e.g. order number). */
  note: text('note'),
  /** Mandatory for manual admin entries. */
  reason: text('reason'),
  /** 'customer' | 'system' | admin username. */
  actor: text('actor').notNull(),
  idempotencyKey: text('idempotency_key'),
  createdAt: at('created_at').notNull().defaultNow(),
}, (t) => [
  index('wallet_transactions_customer_idx').on(t.customerId, t.createdAt.desc()),
  uniqueIndex('wallet_transactions_idempotency_idx').on(t.customerId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
  // One payment and one refund per order: a replay or double click can never charge or refund twice.
  uniqueIndex('wallet_transactions_order_kind_idx').on(t.orderId, t.kind).where(sql`${t.orderId} is not null and ${t.kind} in ('order_payment','order_refund')`),
  check('wallet_transactions_amount_nonzero', sql`${t.amount} <> 0`),
  check('wallet_transactions_balance_nonneg', sql`${t.balanceAfter} >= 0`),
  check('wallet_transactions_sign', sql`(${t.kind} in ('topup','order_refund','admin_credit') and ${t.amount} > 0) or (${t.kind} in ('order_payment','admin_debit') and ${t.amount} < 0)`),
  check('wallet_transactions_admin_reason', sql`${t.kind} not in ('admin_credit','admin_debit') or length(trim(coalesce(${t.reason}, ''))) >= 3`),
])

/** Security-relevant wallet events that are not money movements (freeze, review decisions, blocked attempts). */
export const walletAuditLog = store.table('wallet_audit_log', {
  id: pk(),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
  action: text('action').notNull(),
  actor: text('actor').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>(),
  createdAt: at('created_at').notNull().defaultNow(),
}, (t) => [index('wallet_audit_customer_idx').on(t.customerId, t.createdAt.desc()), index('wallet_audit_action_idx').on(t.action, t.createdAt.desc())])
