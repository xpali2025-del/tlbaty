import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { planDistribution } from '@/lib/distribution'
import { unwrapAll } from '@/lib/action-result'

const d = (n: number) => new Date(Date.UTC(2026, 9, n))
const order = (id: string, city: string, day = 1) => ({ id, city, createdAt: d(day) })
const courier = (id: string, cities: string[], load = 0, name = id) => ({ id, name, cities, load })

describe('planDistribution', () => {
  it('spreads orders evenly, accounting for the current load', () => {
    const plan = planDistribution(
      ['a', 'b', 'c', 'd', 'e'].map((id, i) => order(id, 'صنعاء', i + 1)),
      [courier('c1', ['صنعاء'], 3), courier('c2', ['صنعاء'], 0)],
    )
    const count = (id: string) => plan.assignments.filter((a) => a.courierId === id).length
    expect([count('c1'), count('c2')]).toEqual([1, 4]) // c2 absorbs until loads even out: 3 vs 4 then alternate
    expect(plan.skipped).toEqual([])
  })

  it('considers city couriers plus all-area couriers, prefers the city courier on equal load, otherwise skips', () => {
    const plan = planDistribution(
      [order('o1', 'عدن'), order('o2', 'تعز'), order('o3', 'مأرب')],
      [courier('aden', ['عدن']), courier('any', []), courier('taiz', ['تعز'], 10)],
    )
    const to = (id: string) => plan.assignments.find((a) => a.orderId === id)?.courierId
    expect(to('o1')).toBe('aden') // tie on load -> the city courier
    expect(to('o2')).toBe('any') // taiz courier is heavily loaded, the idle all-area courier takes it
    expect(to('o3')).toBe('any') // only the all-area courier covers it (its load is now 1, still the only candidate)
    const strict = planDistribution([order('x', 'مأرب')], [courier('aden', ['عدن'])])
    expect(strict.assignments).toEqual([])
    expect(strict.skipped).toEqual([{ orderId: 'x', reason: 'no_city_match' }])
  })

  it('handles no couriers, oldest-first order and ties deterministically', () => {
    expect(planDistribution([order('x', 'a')], []).skipped).toEqual([{ orderId: 'x', reason: 'no_courier' }])
    const plan = planDistribution([order('new', 'a', 5), order('old', 'a', 1)], [courier('c1', []), courier('c2', [])])
    expect(plan.assignments.map((a) => a.orderId)).toEqual(['old', 'new'])
    expect(plan.assignments.map((a) => a.courierId)).toEqual(['c1', 'c2'])
  })
})

const db = drizzle(new PGlite())
const auth = vi.hoisted(() => vi.fn(async () => ({ username: 'm' })))
vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('@/lib/manage-auth', () => ({ assertManagePermission: auth, getManageSessionUser: async () => 'm' }))
vi.mock('@/lib/storage/proofs', () => ({ deletePaymentProof: vi.fn() }))
const A = unwrapAll(await import('@/app/manage/orders-actions'))

let seq = 0
const mk = (over: Partial<typeof s.orders.$inferInsert> = {}) =>
  db.insert(s.orders).values({ orderNumber: `ORD-D-${++seq}`, customerName: 'ع', phone: '7', subtotal: 1, total: 1, city: 'صنعاء', ...over }).returning().then((r) => r[0])

beforeAll(async () => { await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') }) })
beforeEach(async () => {
  vi.clearAllMocks()
  await db.delete(s.orders)
  await db.delete(s.couriers)
})

describe('autoDistributeOrders', () => {
  it('assigns only open, unassigned orders to active couriers and snapshots them', async () => {
    const [a, b, off] = await db.insert(s.couriers).values([{ name: 'أحمد', phone: '700', cities: ['صنعاء'] }, { name: 'بدر', cities: ['صنعاء'] }, { name: 'موقوف', status: 'suspended' }]).returning()
    const open = [await mk(), await mk(), await mk(), await mk()]
    const done = await mk({ status: 'delivered' })
    const taken = await mk({ courierId: a.id })
    const r = await A.autoDistributeOrders()
    expect(r).toMatchObject({ ok: true, assigned: 4, skipped: 0 })
    const rows = await db.select().from(s.orders)
    const byId = new Map(rows.map((x) => [x.id, x]))
    expect(byId.get(done.id)!.courierId).toBeNull()
    expect(byId.get(taken.id)!.courierId).toBe(a.id)
    const loads = new Map<string, number>()
    for (const o of open) {
      const row = byId.get(o.id)!
      expect([a.id, b.id]).toContain(row.courierId)
      expect(row.courierId).not.toBe(off.id)
      expect(row.courierSnapshot).toMatchObject({ courierId: row.courierId })
      expect(row.courierAssignedAt).not.toBeNull()
      loads.set(row.courierId!, (loads.get(row.courierId!) ?? 0) + 1)
    }
    // a already holds 1 open order (taken): b takes the first, then they alternate -> 2 and 2 new (final loads 3 vs 2)
    expect([loads.get(a.id), loads.get(b.id)]).toEqual([2, 2])
    expect((loads.get(a.id) ?? 0) + 1 - (loads.get(b.id) ?? 0)).toBeLessThanOrEqual(1)
  })

  it('distributes only the selected ids and leaves the rest', async () => {
    await db.insert(s.couriers).values({ name: 'أحمد' })
    const [x, y] = [await mk(), await mk()]
    expect(await A.autoDistributeOrders([x.id])).toMatchObject({ ok: true, assigned: 1 })
    expect((await db.select().from(s.orders).where(eq(s.orders.id, y.id)))[0].courierId).toBeNull()
  })

  it('reports skipped orders when no courier covers the city, and nothing to do', async () => {
    await db.insert(s.couriers).values({ name: 'عدني', cities: ['عدن'] })
    await mk({ city: 'مأرب' })
    expect(await A.autoDistributeOrders()).toMatchObject({ ok: true, assigned: 0, skipped: 1 })
    await db.delete(s.orders)
    expect(await A.autoDistributeOrders()).toMatchObject({ ok: true, assigned: 0, skipped: 0 })
  })

  it('requires the couriers permission and validates ids', async () => {
    auth.mockRejectedValueOnce(new Error('ليست لديك صلاحية'))
    expect(await A.autoDistributeOrders()).toEqual({ ok: false, error: 'ليست لديك صلاحية' })
    expect((await A.autoDistributeOrders(['nope'])).ok).toBe(false)
  })
})
