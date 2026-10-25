import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { dataHash, EMPTY_CUSTOMER_DATA, isEmptyData, mergeCustomerData, planSync, type CustomerData } from '@/lib/customer-data'

const data = (over: Partial<CustomerData> = {}): CustomerData => ({ ...EMPTY_CUSTOMER_DATA, ...over })
const item = (productId: string, quantity = 1, size = 'M', color = 'أسود') => ({ productId, name: productId, price: 10, image: '', size, color, quantity })
const wish = (id: string) => ({ id, name: id, price: 5, image: '' })
const addr = (id: string, updatedAt: string, city = 'صنعاء') => ({ id, customerName: 'ع', phone: '1', city, address: 'x', latitude: 15, longitude: 44, accuracy: 5, locationCapturedAt: updatedAt, createdAt: updatedAt, updatedAt })

describe('mergeCustomerData', () => {
  it('unions without duplicating and without deleting', () => {
    const local = data({ cart: [item('a', 2), item('b')], wishlist: [wish('w1')], recentlyViewed: [wish('r1')] })
    const server = data({ cart: [item('a', 5), item('c')], wishlist: [wish('w1'), wish('w2')], recentlyViewed: [wish('r2')] })
    const m = mergeCustomerData(local, server)
    expect(m.cart.map((i) => [i.productId, i.quantity]).sort()).toEqual([['a', 5], ['b', 1], ['c', 1]]) // same line -> the larger quantity, not 7
    expect(m.wishlist.map((w) => w.id).sort()).toEqual(['w1', 'w2'])
    expect(m.recentlyViewed.map((r) => r.id)).toEqual(['r1', 'r2']) // local (newer) first
  })
  it('keeps different sizes/colors as separate cart lines and the newest edit of an address', () => {
    const m = mergeCustomerData(data({ cart: [item('a', 1, 'S')], addresses: [addr('1', '2026-02-01', 'عدن')] }), data({ cart: [item('a', 1, 'L')], addresses: [addr('1', '2026-01-01', 'صنعاء')] }))
    expect(m.cart).toHaveLength(2)
    expect(m.addresses).toHaveLength(1)
    expect(m.addresses[0].city).toBe('عدن')
  })
  it('caps recently viewed at 20', () => {
    const many = Array.from({ length: 30 }, (_, i) => wish(`r${i}`))
    expect(mergeCustomerData(data({ recentlyViewed: many }), data()).recentlyViewed).toHaveLength(20)
  })
  it('hash ignores key order inside items but not item order', () => {
    expect(dataHash(data({ cart: [{ a: 1, b: 2 }] }))).toBe(dataHash(data({ cart: [{ b: 2, a: 1 }] })))
    expect(dataHash(data({ cart: [item('a'), item('b')] }))).not.toBe(dataHash(data({ cart: [item('b'), item('a')] })))
    expect(isEmptyData(data())).toBe(true)
  })
})

describe('planSync', () => {
  const T1 = '2026-01-01T00:00:00.000Z'
  const T2 = '2026-01-02T00:00:00.000Z'
  const mine = data({ wishlist: [wish('w1')] })

  it('first sign-in on this device: merge what the visitor collected with the account', () => {
    const plan = planSync({ customerId: 'C1', meta: null, server: { data: data({ wishlist: [wish('w2')] }), updatedAt: T1 }, local: mine })
    expect(plan.action).toBe('merge')
    if (plan.action === 'merge') expect(plan.data.wishlist.map((w) => w.id).sort()).toEqual(['w1', 'w2'])
  })
  it('first sign-in with nothing local takes the account data; nothing anywhere is a no-op', () => {
    expect(planSync({ customerId: 'C1', meta: null, server: { data: mine, updatedAt: T1 }, local: data() }).action).toBe('apply-server')
    expect(planSync({ customerId: 'C1', meta: null, server: { data: data(), updatedAt: null }, local: data() }).action).toBe('noop')
  })
  it('a device that belonged to another account never leaks its data into this one', () => {
    const plan = planSync({ customerId: 'C2', meta: { customerId: 'C1', syncedAt: T1, hash: dataHash(mine) }, server: { data: data(), updatedAt: T1 }, local: mine })
    expect(plan).toEqual({ action: 'apply-server', data: data() })
  })
  it('same account: a newer server copy wins; local unsynced edits get pushed; identical is a no-op', () => {
    const synced = { customerId: 'C1', syncedAt: T1, hash: dataHash(mine) }
    const other = data({ wishlist: [wish('w1'), wish('wX')] })
    expect(planSync({ customerId: 'C1', meta: synced, server: { data: other, updatedAt: T2 }, local: mine }).action).toBe('apply-server')
    const edited = data({ wishlist: [wish('w1'), wish('w9')] })
    expect(planSync({ customerId: 'C1', meta: synced, server: { data: mine, updatedAt: T1 }, local: edited }).action).toBe('push-local')
    expect(planSync({ customerId: 'C1', meta: synced, server: { data: mine, updatedAt: T1 }, local: mine }).action).toBe('noop')
  })
})

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
const db = drizzle(new PGlite())
const state = vi.hoisted(() => ({ session: null as null | { customer: { id: string; publicId: string }; sessionId: string } }))
vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }))
vi.mock('@/lib/otp/session', async (orig) => ({ ...(await orig<typeof import('@/lib/otp/session')>()), resolveSession: async () => state.session }))

const route = await import('@/app/api/account/data/route')
const { revokeOtherSessions } = await import('@/lib/otp/session')

let customerId: string
beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
  const [c] = await db.insert(s.customers).values({ publicId: 'CUS_SYNC', phone: '967770000001' }).returning()
  customerId = c.id
})
beforeEach(() => { state.session = { customer: { id: customerId, publicId: 'CUS_SYNC' }, sessionId: 'x' } })

const put = (body: unknown, raw?: string) => route.PUT(new Request('http://x/api/account/data', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) }))

describe('/api/account/data', () => {
  it('requires a session', async () => {
    state.session = null
    expect((await route.GET()).status).toBe(401)
    expect((await put({ data: {} })).status).toBe(401)
  })

  it('stores and returns the customer data; an unknown customer starts empty', async () => {
    expect(await (await route.GET()).json()).toMatchObject({ ok: true, customerId: 'CUS_SYNC', data: EMPTY_CUSTOMER_DATA, updatedAt: null })
    const payload = { data: { cart: [item('a', 2)], wishlist: [wish('w1')], addresses: [addr('1', '2026-01-01')], recentlyViewed: [] } }
    const saved = await (await put(payload)).json()
    expect(saved.ok).toBe(true)
    const back = await (await route.GET()).json()
    expect(back.data.cart[0]).toMatchObject({ productId: 'a', quantity: 2 })
    expect(back.data.wishlist).toHaveLength(1)
    expect(back.updatedAt).toBe(saved.updatedAt)
    expect((await db.select().from(s.customerData)).length).toBe(1) // one row per customer, updated in place
    await put({ data: { cart: [] } })
    expect((await db.select().from(s.customerData)).length).toBe(1)
  })

  it('keeps the address label (home/work) through a save and reload', async () => {
    const withLabel = { ...addr('L1', '2026-02-01'), label: 'العمل' }
    expect((await put({ data: { addresses: [withLabel] } })).status).toBe(200)
    expect((await (await route.GET()).json()).data.addresses[0]).toMatchObject({ id: 'L1', label: 'العمل' })
  })

  it('rejects malformed, oversized and unsafe payloads without writing', async () => {
    const before = (await db.select().from(s.customerData).where(eq(s.customerData.customerId, customerId)))[0].updatedAt
    const bad: unknown[] = [
      { data: { cart: [{ productId: 'a', name: 'x', price: -5, image: '', size: 'M', color: 'c', quantity: 1 }] } },
      { data: { cart: [{ productId: 'a', name: 'x', price: 5, image: '', size: 'M', color: 'c', quantity: 0 }] } },
      { data: { cart: Array.from({ length: 61 }, (_, i) => item(String(i))) } },
      { data: { wishlist: [{ id: 5 }] } },
      { data: { addresses: [{ ...addr('1', 'x'), latitude: 999 }] } },
      { data: { cart: 'nope' } },
      { data: { wishlist: [{ ...wish('w'), blob: 'x'.repeat(130_000) }] } },
    ]
    for (const b of bad) expect((await put(b)).status, JSON.stringify(b).slice(0, 60)).toBe(b && (JSON.stringify(b).length > 150_000) ? 413 : 400)
    expect((await put(null, 'not json')).status).toBe(400)
    const after = (await db.select().from(s.customerData).where(eq(s.customerData.customerId, customerId)))[0].updatedAt
    expect(after.getTime()).toBe(before.getTime())
  })

  it('limits write frequency per customer', async () => {
    let last = 200
    for (let i = 0; i < 70; i++) last = (await put({ data: {} })).status
    expect(last).toBe(429)
  })
})

describe('revokeOtherSessions', () => {
  it('ends every other session of the customer but keeps the current one and other customers untouched', async () => {
    const [other] = await db.insert(s.customers).values({ publicId: 'CUS_OTHER', phone: '967770000002' }).returning()
    const exp = new Date(Date.now() + 86_400_000)
    const mk = (cid: string, hash: string) => db.insert(s.customerSessions).values({ customerId: cid, tokenHash: hash, expiresAt: exp }).returning().then((r) => r[0])
    const [keep, a, b, theirs] = [await mk(customerId, 'k'), await mk(customerId, 'a'), await mk(customerId, 'b'), await mk(other.id, 't')]
    expect(await revokeOtherSessions(customerId, keep.id)).toBe(2)
    const rows = new Map((await db.select().from(s.customerSessions)).map((r) => [r.id, r.revoked]))
    expect([rows.get(keep.id), rows.get(a.id), rows.get(b.id), rows.get(theirs.id)]).toEqual([false, true, true, false])
    expect(await revokeOtherSessions(customerId, keep.id)).toBe(0)
  })
})
