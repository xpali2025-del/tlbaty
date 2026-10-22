import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { importCatalog, loadSeedData } from '../scripts/migration/import-catalog'

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
const db = drizzle(new PGlite())
const auth = vi.hoisted(() => vi.fn(async (_s?: string) => {}))
vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('@/lib/manage-auth', () => ({ assertManagePermission: auth, assertManageAuthenticated: auth, getManageUsername: () => 'odoo', getManageSessionUser: async () => 'مدير' }))
vi.mock('@/lib/storage/proofs', () => ({ newProofKey: () => 'k', putPaymentProof: async () => {}, deletePaymentProof: async () => {} }))

const { applyEntry, refundOrder } = await import('@/lib/wallet/ledger')
const { requestTopup, approveTopup, rejectTopup, cancelTopup } = await import('@/lib/wallet/topups')
const { insertOrder, loadPricingProducts } = await import('@/lib/orders/create')
const { computeOrderPricing } = await import('@/lib/orders/pricing')
const { computeAlerts, findWalletDetail, getAdminWalletOverview } = await import('@/lib/admin-wallet')
const O = await import('@/app/manage/orders-actions')
const W = await import('@/app/manage/wallet-actions')
const { WalletError, normalizeReference, MAX_BALANCE_BASE } = await import('@/lib/wallet/rules')

const seed = loadSeedData(path.resolve(__dirname, '../scripts/migration/data'))
const YER = { code: 'YER', name: 'ريال', symbol: 'ر.ي', rate: 1 }
const account = { sourceDocumentId: 'a', providerName: 'جيب', accountHolderName: 'متجر', accountNumber: '123' }
const contact = { customerName: 'علي', phone: '0781234567', phoneNormalized: '967781234567', city: 'صنعاء', address: 'شارع', addressSource: 'new' as const, latitude: 15.3, longitude: 44.2, accuracy: 20, capturedAt: new Date(), note: '' }
const walletPay = { method: 'wallet' as const, account: null, senderName: '', senderPhone: '', reference: '', proof: null }

let n = 0
const newCustomer = async () => (await db.insert(s.customers).values({ publicId: `W${++n}`, phone: `96777${String(1000000 + n)}` }).returning())[0].id
const price = async () => {
  const id = seed.products[0].id
  const r = computeOrderPricing({
    items: [{ productId: id, size: 'M', color: 'أسود', quantity: 2 }], products: await loadPricingProducts([id]), zones: [], city: 'صنعاء',
    shippingMethodName: 'شحن عادي', coupons: [], couponCode: '', currencies: [YER], defaultCurrencyCode: 'YER', currencyCode: 'YER',
  })
  if (!r.ok) throw new Error(r.error)
  return r
}
const credit = (customerId: string, amount: number) => db.transaction((tx) => applyEntry(tx as never, { customerId, kind: 'admin_credit', amount, actor: 't', reason: 'اختبار الرصيد' }))
const balance = async (id: string) => (await db.select().from(s.wallets).where(eq(s.wallets.customerId, id)))[0]?.balance ?? 0
const topupReq = (customerId: string, over: Partial<Parameters<typeof requestTopup>[0]> = {}) =>
  requestTopup({ customerId, amount: 5000, currency: YER, account, senderName: 'محمد علي', senderPhone: '967771111111', reference: `REF${++n}${n}`, ...over })
const code = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as InstanceType<typeof WalletError> | null

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
  await importCatalog(db, seed, { resolveImage: async (p) => p })
})
beforeEach(async () => { vi.clearAllMocks(); await db.update(s.products).set({ stock: 100 }) })

describe('ledger', () => {
  it('credits, debits, never goes negative and records the balance after each entry', async () => {
    const c = await newCustomer()
    await credit(c, 3000)
    expect((await code(db.transaction((tx) => applyEntry(tx as never, { customerId: c, kind: 'order_payment', amount: -3500, actor: 'customer' }))))?.code).toBe('INSUFFICIENT')
    await db.transaction((tx) => applyEntry(tx as never, { customerId: c, kind: 'order_payment', amount: -1000, actor: 'customer' }))
    expect(await balance(c)).toBe(2000)
    const rows = await db.select().from(s.walletTransactions).where(eq(s.walletTransactions.customerId, c)).orderBy(s.walletTransactions.createdAt)
    expect(rows.map((r) => [r.amount, r.balanceAfter])).toEqual([[3000, 3000], [-1000, 2000]])
  })

  it('refuses a debit with no wallet, a credit over the balance cap, and a frozen wallet', async () => {
    const c = await newCustomer()
    expect((await code(db.transaction((tx) => applyEntry(tx as never, { customerId: c, kind: 'order_payment', amount: -1, actor: 'x' }))))?.code).toBe('INSUFFICIENT')
    expect((await code(credit(c, MAX_BALANCE_BASE + 1)))?.code).toBe('LIMIT')
    await credit(c, 1000)
    await db.update(s.wallets).set({ frozen: true }).where(eq(s.wallets.customerId, c))
    expect((await code(credit(c, 10)))?.code).toBe('FROZEN')
    expect((await code(db.transaction((tx) => applyEntry(tx as never, { customerId: c, kind: 'order_payment', amount: -10, actor: 'x' }))))?.code).toBe('FROZEN')
    expect(await balance(c)).toBe(1000)
  })

  it('is append-only: updates and deletes of ledger and audit rows are rejected by the database', async () => {
    const c = await newCustomer()
    await credit(c, 1000)
    await expect(db.update(s.walletTransactions).set({ amount: 999999 }).where(eq(s.walletTransactions.customerId, c))).rejects.toThrow()
    await expect(db.delete(s.walletTransactions).where(eq(s.walletTransactions.customerId, c))).rejects.toThrow()
    await db.insert(s.walletAuditLog).values({ customerId: c, action: 'x', actor: 'y' })
    await expect(db.delete(s.walletAuditLog).where(eq(s.walletAuditLog.customerId, c))).rejects.toThrow()
    await expect(db.update(s.walletTransactions).set({ amount: 1 })).rejects.toThrow()
  })

  it('enforces ledger constraints: sign per kind, manual entries need a reason, balance not negative', async () => {
    const c = await newCustomer()
    const base = { customerId: c, balanceAfter: 10, actor: 't' }
    await expect(db.insert(s.walletTransactions).values({ ...base, kind: 'topup', amount: -5 })).rejects.toThrow()
    await expect(db.insert(s.walletTransactions).values({ ...base, kind: 'order_payment', amount: 5 })).rejects.toThrow()
    await expect(db.insert(s.walletTransactions).values({ ...base, kind: 'admin_credit', amount: 5 })).rejects.toThrow()
    await expect(db.insert(s.walletTransactions).values({ ...base, kind: 'topup', amount: 0 })).rejects.toThrow()
    await expect(db.insert(s.walletTransactions).values({ ...base, kind: 'topup', amount: 5, balanceAfter: -1 })).rejects.toThrow()
    await expect(db.insert(s.wallets).values({ customerId: c, balance: -1 })).rejects.toThrow()
  })

  it('serialises concurrent debits so a balance can be spent only once', async () => {
    const c = await newCustomer()
    await credit(c, 1000)
    const results = await Promise.allSettled(
      [1, 2, 3].map(() => db.transaction((tx) => applyEntry(tx as never, { customerId: c, kind: 'order_payment', amount: -600, actor: 'customer' }))),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await balance(c)).toBe(400)
  })

  it('replaying an idempotency key is rejected by the unique index', async () => {
    const c = await newCustomer()
    const e = { customerId: c, kind: 'admin_credit' as const, amount: 100, actor: 't', reason: 'سبب صحيح', idempotencyKey: 'k1' }
    await db.transaction((tx) => applyEntry(tx as never, e))
    await expect(db.transaction((tx) => applyEntry(tx as never, e))).rejects.toThrow()
    expect(await balance(c)).toBe(100)
  })
})

describe('top-up requests', () => {
  it('validates amount bounds, converts with the rate snapshot and never credits before approval', async () => {
    const c = await newCustomer()
    expect((await code(topupReq(c, { amount: 5 })))?.code).toBe('INVALID')
    expect((await code(topupReq(c, { amount: 600_000 })))?.code).toBe('INVALID')
    const { id } = await topupReq(c, { amount: 100, currency: { code: 'SAR', rate: 140 } })
    const [t] = await db.select().from(s.walletTopups).where(eq(s.walletTopups.id, id))
    expect(t).toMatchObject({ status: 'pending', amount: 100, rate: 140, amountBase: 14000 })
    expect(await balance(c)).toBe(0)
  })

  it('blocks reusing a transfer reference in any spelling, but allows it again after a rejection', async () => {
    const a = await newCustomer()
    const b = await newCustomer()
    const first = await topupReq(a, { reference: 'ab-12 34' })
    expect((await code(topupReq(b, { reference: 'AB1234' })))?.code).toBe('DUPLICATE_REFERENCE')
    await rejectTopup(first.id, 'مدير', 'لم تصل الحوالة')
    await expect(topupReq(b, { reference: 'AB1234' })).resolves.toBeTruthy()
    expect(normalizeReference('٠١-ab ٢')).toBe('01AB2')
  })

  it('flags a reference already used on an order', async () => {
    const c = await newCustomer()
    await db.insert(s.orders).values({ orderNumber: 'ORD-REFFLAG', customerName: 'x', phone: '1', subtotal: 1, total: 1, transferReference: 'zz 99-11' })
    const { id } = await topupReq(c, { reference: 'ZZ9911' })
    expect((await db.select().from(s.walletTopups).where(eq(s.walletTopups.id, id)))[0].referenceUsedOnOrder).toBe(true)
  })

  it('limits pending requests, daily requests and repeated rejections', async () => {
    const c = await newCustomer()
    await topupReq(c)
    await topupReq(c)
    expect((await code(topupReq(c)))?.code).toBe('TOO_MANY_PENDING')

    const d = await newCustomer()
    for (let i = 0; i < 3; i++) await rejectTopup((await topupReq(d)).id, 'مدير', 'بيانات خاطئة')
    expect((await code(topupReq(d)))?.code).toBe('TOO_MANY_REJECTED')
    expect((await db.select().from(s.walletAuditLog).where(eq(s.walletAuditLog.customerId, d))).some((a) => a.action === 'topup_blocked_rejections')).toBe(true)

    const e = await newCustomer()
    for (let i = 0; i < 5; i++) await cancelTopup(e, (await topupReq(e)).id)
    expect((await code(topupReq(e)))?.code).toBe('TOO_MANY_REQUESTS')
  })

  it('refuses requests from a frozen wallet', async () => {
    const c = await newCustomer()
    await W.setWalletFrozen(c, true, 'اشتباه احتيال')
    expect((await code(topupReq(c)))?.code).toBe('FROZEN')
  })

  it('approval credits exactly once and records the admin; a partial confirmed amount is honoured', async () => {
    const c = await newCustomer()
    const { id } = await topupReq(c, { amount: 5000 })
    const [r1, r2] = await Promise.allSettled([approveTopup(id, 'مدير'), approveTopup(id, 'مدير 2')])
    expect([r1.status, r2.status].sort()).toEqual(['fulfilled', 'rejected'])
    expect(await balance(c)).toBe(5000)
    expect((await code(approveTopup(id, 'x')))?.code).toBe('NOT_PENDING')
    expect((await code(rejectTopup(id, 'x', 'سبب')))?.code).toBe('NOT_PENDING')

    const p = await topupReq(c, { amount: 4000 })
    expect((await code(approveTopup(p.id, 'م', 4001)))?.code).toBe('INVALID')
    await approveTopup(p.id, 'م', 3000)
    expect(await balance(c)).toBe(8000)
    expect((await db.select().from(s.walletTopups).where(eq(s.walletTopups.id, p.id)))[0]).toMatchObject({ status: 'approved', creditedAmountBase: 3000, reviewedBy: 'م' })
  })

  it('a customer can cancel only their own pending request', async () => {
    const a = await newCustomer()
    const b = await newCustomer()
    const { id } = await topupReq(a)
    expect((await code(cancelTopup(b, id)))?.code).toBe('NOT_PENDING')
    await cancelTopup(a, id)
    expect((await code(cancelTopup(a, id)))?.code).toBe('NOT_PENDING')
  })
})

describe('paying an order from the wallet', () => {
  it('charges the base total atomically, marks it paid, and links the ledger to the order', async () => {
    const c = await newCustomer()
    await credit(c, 5000)
    const pricing = await price()
    const created = await insertOrder({ customer: { id: c }, contact, pricing, payment: walletPay })
    expect(created.paymentStatus).toBe('paid')
    expect(await balance(c)).toBe(5000 - pricing.base.total)
    const [tx] = await db.select().from(s.walletTransactions).where(eq(s.walletTransactions.orderId, created.id))
    expect(tx).toMatchObject({ kind: 'order_payment', amount: -pricing.base.total, actor: 'customer', customerId: c })
    expect((await db.select().from(s.orders).where(eq(s.orders.id, created.id)))[0]).toMatchObject({ paymentMethod: 'wallet', paymentStatus: 'paid' })
  })

  it('an insufficient balance rolls back everything: no order, no stock change, no charge', async () => {
    const c = await newCustomer()
    await credit(c, 100)
    const before = (await db.select().from(s.products).where(eq(s.products.productNumber, seed.products[0].id)))[0].stock
    const err = await code(insertOrder({ customer: { id: c }, contact, pricing: await price(), payment: walletPay }))
    expect(err?.code).toBe('INSUFFICIENT')
    expect(await balance(c)).toBe(100)
    expect((await db.select().from(s.orders).where(eq(s.orders.customerId, c)))).toHaveLength(0)
    expect((await db.select().from(s.products).where(eq(s.products.productNumber, seed.products[0].id)))[0].stock).toBe(before)
  })

  it('a retry with the same idempotency key never charges twice', async () => {
    const c = await newCustomer()
    await credit(c, 5000)
    const pricing = await price()
    const key = 'wallet-key-0123456789'
    const a = await insertOrder({ customer: { id: c }, idempotencyKey: key, contact, pricing, payment: walletPay })
    const b = await insertOrder({ customer: { id: c }, idempotencyKey: key, contact, pricing, payment: walletPay })
    expect(b).toMatchObject({ id: a.id, duplicate: true })
    expect(await balance(c)).toBe(5000 - pricing.base.total)
  })

  it('blocks spending right after a phone change (account-takeover cool-down) and audits it', async () => {
    const c = await newCustomer()
    await credit(c, 5000)
    await db.insert(s.customerPhoneHistory).values({ customerId: c, fromPhone: '1', toPhone: '2' })
    expect((await code(insertOrder({ customer: { id: c }, contact, pricing: await price(), payment: walletPay })))?.code).toBe('COOLDOWN')
    expect(await balance(c)).toBe(5000)
    expect((await db.select().from(s.walletAuditLog).where(eq(s.walletAuditLog.customerId, c))).map((a) => a.action)).toContain('spend_blocked_cooldown')
    await db.update(s.customerPhoneHistory).set({ changedAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(s.customerPhoneHistory.customerId, c))
    await expect(insertOrder({ customer: { id: c }, contact, pricing: await price(), payment: walletPay })).resolves.toBeTruthy()
  })

  it('enforces the daily spending limit', async () => {
    const c = await newCustomer()
    await db.insert(s.wallets).values({ customerId: c, balance: 1_900_000 })
    await db.insert(s.walletTransactions).values({ customerId: c, kind: 'topup', amount: 1_900_000, balanceAfter: 1_900_000, actor: 't' })
    await db.insert(s.walletTransactions).values({ customerId: c, kind: 'order_payment', amount: -999_900, balanceAfter: 900_100, actor: 'customer' })
    await db.update(s.wallets).set({ balance: 900_100 }).where(eq(s.wallets.customerId, c))
    expect((await code(insertOrder({ customer: { id: c }, contact, pricing: await price(), payment: walletPay })))?.code).toBe('DAILY_LIMIT')
  })

  it('cancelling refunds the wallet once and marks the payment refunded; returned orders too', async () => {
    const c = await newCustomer()
    await credit(c, 5000)
    const pricing = await price()
    const o = await insertOrder({ customer: { id: c }, contact, pricing, payment: walletPay })
    expect(await balance(c)).toBe(5000 - pricing.base.total)
    const r = await O.updateOrderStatus(o.id, 'cancelled')
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(await balance(c)).toBe(5000)
    expect((await db.select().from(s.orders).where(eq(s.orders.id, o.id)))[0].paymentStatus).toBe('refunded')
    const kinds = (await db.select().from(s.walletTransactions).where(eq(s.walletTransactions.orderId, o.id))).map((t) => t.kind).sort()
    expect(kinds).toEqual(['order_payment', 'order_refund'])
    // a second refund attempt is a no-op
    expect(await db.transaction((tx) => refundOrder(tx as never, { orderId: o.id, orderNumber: 'x', actor: 'a', reason: 'r' }))).toBeNull()
    expect(await balance(c)).toBe(5000)
  })

  it('deleting an open wallet-paid order refunds it; cash orders are untouched', async () => {
    const c = await newCustomer()
    await credit(c, 5000)
    const o = await insertOrder({ customer: { id: c }, contact, pricing: await price(), payment: walletPay })
    await O.deleteOrder(o.id)
    expect(await balance(c)).toBe(5000)
    const cod = await insertOrder({ customer: { id: c }, contact, pricing: await price(), payment: { ...walletPay, method: 'cash_on_delivery' } })
    await O.updateOrderStatus(cod.id, 'cancelled')
    expect(await balance(c)).toBe(5000)
  })

  it('wallet payment status cannot be changed by hand', async () => {
    const { canTransitionPayment } = await import('@/lib/payment')
    for (const next of ['verified', 'rejected', 'refunded', 'cancelled', 'pending_verification'] as const) expect(canTransitionPayment('wallet', 'paid', next)).toBe(false)
  })
})

describe('admin actions and monitoring', () => {
  it('check the wallets permission, require a reason, cap adjustments and write the ledger under the admin name', async () => {
    const c = await newCustomer()
    expect((await W.adjustWallet(c, 'credit', 1000, 'abc')).ok).toBe(false)
    expect((await W.adjustWallet(c, 'credit', 600_000, 'سبب كافٍ جداً')).ok).toBe(false)
    expect((await W.adjustWallet(c, 'debit', 10, 'سبب كافٍ جداً')).ok).toBe(false)
    expect((await W.adjustWallet(c, 'credit', 1000, 'تعويض عن تأخير')).ok).toBe(true)
    expect(auth).toHaveBeenCalledWith('wallets')
    expect(await balance(c)).toBe(1000)
    const [t] = await db.select().from(s.walletTransactions).where(eq(s.walletTransactions.customerId, c))
    expect(t).toMatchObject({ kind: 'admin_credit', actor: 'مدير', reason: 'تعويض عن تأخير' })
    auth.mockRejectedValueOnce(new Error('unauthorized'))
    expect(await W.adjustWallet(c, 'credit', 5, 'سبب كافٍ جداً')).toEqual({ ok: false, error: 'تعذّر تنفيذ العملية' })
    expect(await balance(c)).toBe(1000)
  })

  it('approve/reject actions work and a rejection needs a reason', async () => {
    const c = await newCustomer()
    const { id } = await topupReq(c)
    expect((await W.rejectWalletTopup(id, 'x')).ok).toBe(false)
    expect((await W.approveWalletTopup(id)).ok).toBe(true)
    expect((await W.approveWalletTopup(id)).ok).toBe(false)
  })

  it('freezing needs a reason, blocks payment, and unfreezing restores it', async () => {
    const c = await newCustomer()
    await credit(c, 5000)
    expect((await W.setWalletFrozen(c, true, '')).ok).toBe(false)
    expect((await W.setWalletFrozen(c, true, 'نشاط مشبوه')).ok).toBe(true)
    expect((await code(insertOrder({ customer: { id: c }, contact, pricing: await price(), payment: walletPay })))?.code).toBe('FROZEN')
    expect((await W.setWalletFrozen(c, false, '')).ok).toBe(true)
    await expect(insertOrder({ customer: { id: c }, contact, pricing: await price(), payment: walletPay })).resolves.toBeTruthy()
  })

  it('detects a balance that does not match the ledger and a broken balance chain', async () => {
    const c = await newCustomer()
    await credit(c, 1000)
    expect((await computeAlerts()).some((a) => a.customerId === c)).toBe(false)
    await db.update(s.wallets).set({ balance: 9000 }).where(eq(s.wallets.customerId, c))
    const alerts = await computeAlerts()
    expect(alerts.find((a) => a.customerId === c && a.kind === 'ledger_mismatch')?.severity).toBe('high')
    const detail = await findWalletDetail(c ? (await db.select().from(s.customers).where(eq(s.customers.id, c)))[0].phone : '')
    expect(detail).toMatchObject({ balance: 9000, ledgerSum: 1000, consistent: false })

    const d = await newCustomer()
    await credit(d, 1000)
    await db.execute(sql`alter table store.wallet_transactions disable trigger wallet_transactions_append_only`)
    await db.execute(sql`update store.wallet_transactions set balance_after = 5 where customer_id = ${d}`)
    await db.execute(sql`alter table store.wallet_transactions enable trigger wallet_transactions_append_only`)
    expect((await computeAlerts()).some((a) => a.customerId === d && a.kind === 'ledger_chain')).toBe(true)
  })

  it('overview lists pending requests with review flags', async () => {
    const c = await newCustomer()
    await topupReq(c, { amount: 300_000 })
    const o = await getAdminWalletOverview()
    const row = o.pending.find((p) => p.customerId === c)!
    expect(row).toMatchObject({ large: true, status: 'pending' })
    expect(o.totals.pendingCount).toBeGreaterThan(0)
  })
})
