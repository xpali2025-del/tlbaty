import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { unwrapAll } from '@/lib/action-result'

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
const db = drizzle(new PGlite())
const auth = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('@/lib/manage-auth', () => ({ assertManagePermission: auth, assertManageAuthenticated: auth, getManageUsername: () => 'odoo', getManageSessionUser: async () => 'm' }))

const A = unwrapAll(await import('@/app/manage/shipping-actions'))
const { getAdminShipping } = await import('@/lib/admin')

const method = (price = 1000) => ({ name: 'عادي', description: '', price, icon: 'standard' as const })
const YER = { code: 'YER', name: 'ريال', symbol: 'ر.ي', rate: 1 }
const SAR = { code: 'SAR', name: 'سعودي', symbol: 'ر.س', rate: 140 }

beforeAll(async () => { await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') }) })
beforeEach(async () => { vi.clearAllMocks(); await db.delete(s.shippingZones); await db.delete(s.currencies) })

describe('currencies', () => {
  it('saves list and default, and reads back in order', async () => {
    await A.saveCurrencies([YER, SAR], 'SAR')
    const r = await getAdminShipping()
    expect(r.currencies.map((c) => c.code)).toEqual(['YER', 'SAR'])
    expect(r.defaultCurrency).toBe('SAR')
  })
  it.each([
    ['missing base', [SAR], 'SAR'],
    ['base rate not 1', [{ ...YER, rate: 2 }], 'YER'],
    ['duplicate code', [YER, YER], 'YER'],
    ['zero rate', [YER, { ...SAR, rate: 0 }], 'YER'],
    ['unknown default', [YER], 'SAR'],
    ['bad code', [YER, { ...SAR, code: 'sa r' }], 'YER'],
  ])('rejects %s', async (_n, list, def) => {
    await expect(A.saveCurrencies(list, def)).rejects.toThrow()
    expect(await db.select().from(s.currencies)).toHaveLength(0)
  })
  it('requires auth', async () => {
    auth.mockRejectedValueOnce(new Error('غير مصرّح'))
    await expect(A.saveCurrencies([YER], 'YER')).rejects.toThrow('غير مصرّح')
  })
  it('checks the currencies permission, not shipping', async () => {
    await A.saveCurrencies([YER], 'YER')
    expect(auth).toHaveBeenCalledWith('currencies')
  })
  it('keeps updatedAt for unchanged rates and bumps it for changed ones', async () => {
    await A.saveCurrencies([YER, SAR], 'YER')
    const first = (await getAdminShipping()).currencies
    expect(first.every((c) => !!c.updatedAt)).toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    await A.saveCurrencies([YER, { ...SAR, rate: 150 }], 'YER')
    const second = (await getAdminShipping()).currencies
    expect(second.find((c) => c.code === 'YER')!.updatedAt).toBe(first.find((c) => c.code === 'YER')!.updatedAt)
    expect(second.find((c) => c.code === 'SAR')!.updatedAt).not.toBe(first.find((c) => c.code === 'SAR')!.updatedAt)
  })
})

describe('shipping zones', () => {
  it('creates, edits (replacing methods), and deletes', async () => {
    await A.saveShippingZone(null, { governorate: 'عدن', isDefault: false, methods: [method(500), { ...method(900), name: 'سريع', icon: 'express' }] })
    let { zones } = await getAdminShipping()
    expect(zones).toHaveLength(1)
    expect(zones[0].methods.map((m) => [m.name, m.price])).toEqual([['عادي', 500], ['سريع', 900]])
    await A.saveShippingZone(zones[0]._id, { governorate: 'عدن', isDefault: false, methods: [method(700)] })
    ;({ zones } = await getAdminShipping())
    expect(zones[0].methods).toHaveLength(1)
    await A.deleteShippingZone(zones[0]._id)
    expect((await getAdminShipping()).zones).toHaveLength(0)
    expect(await db.select().from(s.shippingMethods)).toHaveLength(0)
  })
  it('enforces one zone per governorate, one default, valid governorate and valid methods', async () => {
    await A.saveShippingZone(null, { governorate: 'عدن', isDefault: false, methods: [method()] })
    await expect(A.saveShippingZone(null, { governorate: 'عدن', isDefault: false, methods: [method()] })).rejects.toThrow('بالفعل')
    await A.saveShippingZone(null, { governorate: null, isDefault: true, methods: [method()] })
    await expect(A.saveShippingZone(null, { governorate: null, isDefault: true, methods: [method()] })).rejects.toThrow('بالفعل')
    await expect(A.saveShippingZone(null, { governorate: 'مريخ', isDefault: false, methods: [method()] })).rejects.toThrow()
    await expect(A.saveShippingZone(null, { governorate: 'تعز', isDefault: false, methods: [] })).rejects.toThrow()
    await expect(A.saveShippingZone(null, { governorate: 'تعز', isDefault: false, methods: [method(-1)] })).rejects.toThrow()
    expect((await getAdminShipping()).zones).toHaveLength(2)
  })
  it('a failed edit keeps the old methods', async () => {
    await A.saveShippingZone(null, { governorate: 'عدن', isDefault: false, methods: [method(500)] })
    const [z] = (await getAdminShipping()).zones
    await expect(A.saveShippingZone(z._id, { governorate: 'عدن', isDefault: false, methods: [method(-5)] })).rejects.toThrow()
    expect((await getAdminShipping()).zones[0].methods[0].price).toBe(500)
  })
})
