import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { DEFAULT_REMINDER_RULES, renderReminderText, validateRule, describeDiscount } from '@/lib/marketing/rules'

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
const db = drizzle(new PGlite())
vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }))
vi.mock('@/lib/manage-auth', () => ({ assertManagePermission: async () => {}, assertManageAuthenticated: async () => {}, getManageUsername: () => 'odoo', getManageSessionUser: async () => 'مدير' }))
vi.mock('@/lib/storage/proofs', () => ({ newProofKey: () => 'k', putPaymentProof: async () => {}, deletePaymentProof: async () => {} }))

const { runReminders, getReminderRules } = await import('@/lib/marketing/reminders')
const { getCouponsForCustomer, getCoupons } = await import('@/lib/data')
const { getPublicNotifications, getNotificationsSummary } = await import('@/lib/notifications')
const { insertOrder, CouponUnavailableError } = await import('@/lib/orders/create')
const O = await import('@/app/manage/orders-actions')

const HOUR = 3_600_000
const DAY = 24 * HOUR
const ago = (ms: number) => new Date(Date.now() - ms)
let n = 0
const mkCustomer = async (over: Partial<typeof s.customers.$inferInsert> = {}) =>
  (await db.insert(s.customers).values({ publicId: `RM${++n}`, phone: `96777${String(2000000 + n)}`, marketingOptIn: true, ...over }).returning())[0].id
const putData = (customerId: string, data: object, updatedAt: Date) => db.insert(s.customerData).values({ customerId, data: data as never, updatedAt }).onConflictDoUpdate({ target: s.customerData.customerId, set: { data: data as never, updatedAt } })
const cartItem = (productId: string, name = 'قميص') => ({ productId, name, price: 100, image: '', size: 'M', color: 'أسود', quantity: 1 })
const setRule = (kind: 'cart' | 'wishlist', over: Partial<typeof s.reminderRules.$inferInsert> = {}) => {
  const d = DEFAULT_REMINDER_RULES[kind]
  const v = { kind, enabled: true, delayHours: d.delayHours, cooldownDays: d.cooldownDays, title: d.title, body: d.body, discountType: d.discountType, discountValue: d.discountValue, minOrder: 0, couponValidDays: d.couponValidDays, ...over }
  return db.insert(s.reminderRules).values(v).onConflictDoUpdate({ target: s.reminderRules.kind, set: v })
}

let inStock: string
beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
  const [cat] = await db.insert(s.categories).values({ name: 'ملابس', slug: 'clothes' }).returning()
  const mk = (num: string, stock: number) => db.insert(s.products).values({ productNumber: num, name: num, slug: num.toLowerCase(), categoryId: cat.id, price: 100, stock, description: 'وصف المنتج الطويل' })
  await mk('RM-IN', 9)
  await mk('RM-OUT', 0)
  inStock = 'RM-IN'
})
beforeEach(async () => {
  await db.delete(s.reminderLog)
  await db.delete(s.notifications)
  await db.delete(s.coupons)
  await db.delete(s.customerData)
  await db.delete(s.orders)
  await db.delete(s.reminderRules)
})

describe('rule helpers', () => {
  it('renders placeholders and describes discounts', () => {
    expect(renderReminderText('{product} {code} {discount} {days}', { product: 'قميص', code: 'TJ1', discount: '10%', days: 3 })).toBe('قميص TJ1 10% 3')
    expect(describeDiscount({ discountType: 'fixed', discountValue: 1500 })).toBe('1,500 ر.ي')
  })
  it('validates a rule', () => {
    const ok = { ...DEFAULT_REMINDER_RULES.cart }
    expect(validateRule(ok)).toBeNull()
    expect(validateRule({ ...ok, delayHours: 0 })).toContain('مدة الانتظار')
    expect(validateRule({ ...ok, discountValue: 120 })).toContain('100')
    expect(validateRule({ ...ok, title: ' ' })).toContain('عنوان')
    expect(validateRule({ ...ok, discountValue: 0 })).toContain('{code}')
    expect(validateRule({ ...ok, discountValue: 0, body: 'منتجاتك بانتظارك' })).toBeNull()
  })
})

describe('runReminders', () => {
  it('does nothing while the rule is disabled (default)', async () => {
    const a = await mkCustomer()
    await putData(a, { cart: [cartItem(inStock)] }, ago(3 * DAY))
    expect(await runReminders()).toMatchObject({ cart: { enabled: false, sent: 0 }, wishlist: { enabled: false, sent: 0 } })
    expect(await db.select().from(s.notifications)).toHaveLength(0)
    expect((await getReminderRules()).cart.enabled).toBe(false)
  })

  it('reminds only eligible customers, with a personal notification and a single-use personal coupon', async () => {
    await setRule('cart')
    const eligible = await mkCustomer()
    const notOptedIn = await mkCustomer({ marketingOptIn: false })
    const blocked = await mkCustomer({ status: 'blocked' })
    const recent = await mkCustomer()
    const stale = await mkCustomer()
    const bought = await mkCustomer()
    const allOut = await mkCustomer()
    const emptyCart = await mkCustomer()
    await putData(eligible, { cart: [cartItem('RM-OUT', 'نافد'), cartItem(inStock, 'قميص أزرق')] }, ago(2 * DAY))
    await putData(notOptedIn, { cart: [cartItem(inStock)] }, ago(2 * DAY))
    await putData(blocked, { cart: [cartItem(inStock)] }, ago(2 * DAY))
    await putData(recent, { cart: [cartItem(inStock)] }, ago(2 * HOUR))
    await putData(stale, { cart: [cartItem(inStock)] }, ago(40 * DAY))
    await putData(bought, { cart: [cartItem(inStock)] }, ago(3 * DAY))
    await db.insert(s.orders).values({ orderNumber: 'ORD-RM-1', customerId: bought, customerName: 'x', phone: '1', subtotal: 1, total: 1, createdAt: ago(1 * DAY) })
    await putData(allOut, { cart: [cartItem('RM-OUT')] }, ago(2 * DAY))
    await putData(emptyCart, { cart: [] }, ago(2 * DAY))

    expect(await runReminders()).toMatchObject({ cart: { enabled: true, sent: 1 } })

    const notes = await db.select().from(s.notifications)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ customerId: eligible, status: 'published', kind: 'cart_reminder', link: '/cart', createdBy: 'النظام' })
    expect(notes[0].body).toContain('قميص أزرق') // the first in-stock item, not the out-of-stock one
    const [coupon] = await db.select().from(s.coupons)
    expect(coupon).toMatchObject({ customerId: eligible, maxUses: 1, usedCount: 0, type: 'percent', discount: 10 })
    expect(coupon.code).toMatch(/^TJ[A-Z2-9]{8}$/)
    expect(notes[0].body).toContain(coupon.code)
    expect(coupon.expiresAt!.getTime() - Date.now()).toBeGreaterThan(2.9 * DAY)
    expect((await db.select().from(s.reminderLog))[0]).toMatchObject({ customerId: eligible, kind: 'cart', couponId: coupon.id })
  })

  it('never sends twice in the same day, and respects the cooldown', async () => {
    await setRule('cart', { cooldownDays: 7 })
    const a = await mkCustomer()
    await putData(a, { cart: [cartItem(inStock)] }, ago(2 * DAY))
    expect((await runReminders()).cart.sent).toBe(1)
    expect((await runReminders()).cart.sent).toBe(0)
    expect(await db.select().from(s.notifications)).toHaveLength(1)

    // a reminder 3 days ago is inside the 7-day cooldown; one 8 days ago is not
    await db.delete(s.reminderLog)
    await db.insert(s.reminderLog).values({ customerId: a, kind: 'cart', sentOn: sql`current_date - 3` as never, sentAt: ago(3 * DAY) })
    expect((await runReminders()).cart.sent).toBe(0)
    await db.delete(s.reminderLog)
    await db.insert(s.reminderLog).values({ customerId: a, kind: 'cart', sentOn: sql`current_date - 8` as never, sentAt: ago(8 * DAY) })
    expect((await runReminders()).cart.sent).toBe(1)
  })

  it('wishlist reminders use the wishlist items and link to the wishlist, without a coupon when none is configured', async () => {
    await setRule('wishlist', { discountValue: 0, body: '{product} ما زال متوفراً' })
    const a = await mkCustomer()
    await putData(a, { wishlist: [{ id: inStock, name: 'فستان' }] }, ago(5 * DAY))
    expect((await runReminders()).wishlist.sent).toBe(1)
    const [note] = await db.select().from(s.notifications)
    expect(note).toMatchObject({ customerId: a, kind: 'wishlist_reminder', link: '/wishlist', body: 'فستان ما زال متوفراً' })
    expect(await db.select().from(s.coupons)).toHaveLength(0)
  })

  it('personal notifications never leak into the public list or the bell summary', async () => {
    await setRule('cart')
    const a = await mkCustomer()
    await putData(a, { cart: [cartItem(inStock)] }, ago(2 * DAY))
    await db.insert(s.notifications).values({ title: 'عرض للجميع', body: 'خصم', status: 'published', publishedAt: ago(HOUR) })
    await runReminders()
    const page = await getPublicNotifications()
    expect(page.items.map((i) => i.title)).toEqual(['عرض للجميع'])
    expect((await getNotificationsSummary()).length).toBe(1)
  })
})

describe('personal coupons', () => {
  const currency = { code: 'YER', name: 'ريال', symbol: 'ر.ي', rate: 1 }
  const contact = { customerName: 'علي', phone: '0781234567', phoneNormalized: '967781234567', city: 'صنعاء', address: 'شارع', addressSource: 'new' as const, latitude: 15.3, longitude: 44.2, accuracy: 20, capturedAt: new Date(), note: '' }
  const cod = { method: 'cash_on_delivery' as const, account: null, senderName: '', senderPhone: '', reference: '', proof: null }
  const pricing = (couponCode: string) => ({
    ok: true as const, currency, lines: [{ productId: inStock, name: 'قميص', sku: '', image: '', size: 'M', color: 'أسود', quantity: 1, price: 100, lineTotal: 100 }],
    shippingMethod: 'عادي', couponCode, shippingPrice: 0, discount: couponCode ? 10 : 0, subtotal: 100, total: couponCode ? 90 : 100,
    base: { subtotal: 100, shipping: 0, discount: couponCode ? 10 : 0, total: couponCode ? 90 : 100 },
  })
  const personal = (customerId: string, over: Partial<typeof s.coupons.$inferInsert> = {}) =>
    db.insert(s.coupons).values({ code: `PERS${++n}`, discount: 10, type: 'percent', description: 'شخصي', customerId, maxUses: 1, expiresAt: new Date(Date.now() + DAY), ...over }).returning().then((r) => r[0])

  it('shows a personal coupon only to its owner, and hides it once expired or used', async () => {
    const owner = await mkCustomer()
    const other = await mkCustomer()
    await db.insert(s.coupons).values({ code: 'PUBLIC10', discount: 10, type: 'percent', description: 'عام' })
    const c = await personal(owner)
    expect((await getCoupons()).map((x) => x.code)).toEqual(['PUBLIC10'])
    expect((await getCouponsForCustomer(owner)).map((x) => x.code).sort()).toEqual(['PUBLIC10', c.code].sort())
    expect((await getCouponsForCustomer(other)).map((x) => x.code)).toEqual(['PUBLIC10'])
    await db.update(s.coupons).set({ usedCount: 1 }).where(eq(s.coupons.id, c.id))
    expect((await getCouponsForCustomer(owner)).map((x) => x.code)).toEqual(['PUBLIC10'])
    await db.update(s.coupons).set({ usedCount: 0, expiresAt: ago(HOUR) }).where(eq(s.coupons.id, c.id))
    expect((await getCouponsForCustomer(owner)).map((x) => x.code)).toEqual(['PUBLIC10'])
  })

  it('redeems once for the owner; a second use, another customer or an expired code roll the order back', async () => {
    const owner = await mkCustomer()
    const other = await mkCustomer()
    await db.update(s.products).set({ stock: 50 }).where(eq(s.products.productNumber, inStock))
    const c = await personal(owner)
    const stock = async () => (await db.select().from(s.products).where(eq(s.products.productNumber, inStock)))[0].stock

    await expect(insertOrder({ customer: { id: other }, contact, pricing: pricing(c.code), payment: cod })).rejects.toBeInstanceOf(CouponUnavailableError)
    expect(await stock()).toBe(50)

    const first = await insertOrder({ customer: { id: owner }, contact, pricing: pricing(c.code), payment: cod })
    expect((await db.select().from(s.coupons).where(eq(s.coupons.id, c.id)))[0].usedCount).toBe(1)
    await expect(insertOrder({ customer: { id: owner }, contact, pricing: pricing(c.code), payment: cod })).rejects.toBeInstanceOf(CouponUnavailableError)
    expect(await stock()).toBe(49)

    const old = await personal(owner, { expiresAt: ago(HOUR) })
    await expect(insertOrder({ customer: { id: owner }, contact, pricing: pricing(old.code), payment: cod })).rejects.toBeInstanceOf(CouponUnavailableError)

    // cancelling the order gives the single-use code back
    expect((await O.updateOrderStatus(first.id, 'cancelled')).ok).toBe(true)
    expect((await db.select().from(s.coupons).where(eq(s.coupons.id, c.id)))[0].usedCount).toBe(0)
  })

  it('two parallel orders cannot both use a single-use code', async () => {
    const owner = await mkCustomer()
    await db.update(s.products).set({ stock: 50 }).where(eq(s.products.productNumber, inStock))
    const c = await personal(owner)
    const results = await Promise.allSettled([1, 2, 3].map(() => insertOrder({ customer: { id: owner }, contact, pricing: pricing(c.code), payment: cod })))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  })

  it('the database refuses an impossible use count', async () => {
    const owner = await mkCustomer()
    await expect(personal(owner, { usedCount: 2, maxUses: 1 })).rejects.toThrow()
  })
})
