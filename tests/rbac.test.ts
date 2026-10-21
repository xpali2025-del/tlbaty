import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { normalizePermissions, ROLE_PRESETS, SCREENS } from '@/lib/permissions'

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
const db = drizzle(new PGlite())
type Actor = { username: string; isOwner: boolean; permissions: string[]; role: string }
const state = vi.hoisted(() => ({ actor: null as null | Actor }))
vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('@/lib/storage/r2', () => ({ deleteImageObject: vi.fn(async () => {}) }))
vi.mock('ai', () => ({ generateText: vi.fn() }))
vi.mock('@/lib/manage-auth', () => ({
  getManageUsername: () => 'odoo',
  getManageSessionUser: async () => state.actor?.username ?? null,
  assertManageAuthenticated: async () => {
    if (!state.actor) throw new Error('غير مصرّح')
    return state.actor
  },
  assertManagePermission: async (screen: string) => {
    if (!state.actor) throw new Error('غير مصرّح')
    if (!state.actor.permissions.includes(screen)) throw new Error('ليست لديك صلاحية')
    return state.actor
  },
}))

const A = await import('@/app/manage/actions')
const form = (f: Record<string, string>) => {
  const d = new FormData()
  for (const [k, v] of Object.entries(f)) d.set(k, v)
  return d
}
const owner = (): Actor => ({ username: 'odoo', isOwner: true, permissions: [...SCREENS], role: 'owner' })
const manager = (): Actor => ({ username: 'mona', isOwner: false, permissions: [...ROLE_PRESETS.manager, 'users'], role: 'manager' })

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
})
beforeEach(async () => {
  state.actor = owner()
  await db.delete(s.manageUsers)
})

describe('permissions helpers', () => {
  it('presets are valid screens and operators cannot reach the catalog, settings or users', () => {
    for (const role of Object.keys(ROLE_PRESETS) as (keyof typeof ROLE_PRESETS)[]) {
      for (const sc of ROLE_PRESETS[role]) expect(SCREENS).toContain(sc)
    }
    expect(ROLE_PRESETS.operator).toEqual(['orders', 'couriers', 'notifications'])
    expect(ROLE_PRESETS.manager).not.toContain('users')
    expect(ROLE_PRESETS.admin).toEqual(SCREENS)
  })
  it('normalizes unknown, duplicate and malformed input', () => {
    expect(normalizePermissions(['products', 'products', 'hack', 5, 'orders'])).toEqual(['orders', 'products'])
    expect(normalizePermissions('products')).toEqual([])
  })
})

describe('user management rules', () => {
  const create = (over: Record<string, string> = {}) =>
    A.saveUser(null, form({ username: 'sara', password: 'secret1', role: 'editor', permissions: JSON.stringify(['products']), active: 'true', ...over }))

  it('stores role and permissions, falling back to the role preset', async () => {
    await create()
    expect((await db.select().from(s.manageUsers))[0]).toMatchObject({ role: 'editor', permissions: ['products'] })
    await create({ username: 'omar', role: 'operator', permissions: '' })
    const omar = (await db.select().from(s.manageUsers).where(eq(s.manageUsers.username, 'omar')))[0]
    expect(omar.permissions).toEqual(['orders', 'couriers', 'notifications'])
  })

  it('drops unknown screens sent by a tampered form', async () => {
    await create({ permissions: JSON.stringify(['products', 'root', 'users']) })
    expect((await db.select().from(s.manageUsers))[0].permissions).toEqual(['products', 'users'])
  })

  it('reserves the owner username so nobody can impersonate the owner', async () => {
    await expect(create({ username: 'odoo' })).rejects.toThrow('محجوز')
    await expect(create({ username: 'ODOO' })).rejects.toThrow('محجوز')
  })

  it('refuses users without the users screen', async () => {
    state.actor = { username: 'x', isOwner: false, permissions: ['products'], role: 'editor' }
    await expect(create()).rejects.toThrow('صلاحية')
  })

  it('does not let a non-owner grant screens they do not have', async () => {
    state.actor = { ...manager(), permissions: ['users', 'orders'] }
    await expect(create({ permissions: JSON.stringify(['orders', 'settings']) })).rejects.toThrow('لا تملكها')
    await expect(create({ permissions: JSON.stringify(['orders']) })).resolves.toBeUndefined()
  })

  it('protects the acting user from locking themselves out', async () => {
    await create({ username: 'mona', permissions: JSON.stringify(['users', 'orders']) })
    const mona = (await db.select().from(s.manageUsers))[0]
    state.actor = { username: 'mona', isOwner: false, permissions: ['users', 'orders'], role: 'manager' }
    await expect(A.saveUser(mona.id, form({ username: 'mona', role: 'manager', permissions: JSON.stringify(['orders']), active: 'true' }))).rejects.toThrow('إدارة المستخدمين')
    await expect(A.saveUser(mona.id, form({ username: 'mona', role: 'manager', permissions: JSON.stringify(['users']), active: 'false' }))).rejects.toThrow('تعطيل')
    await expect(A.deleteUser(mona.id)).rejects.toThrow('حذف حسابك')
    await expect(A.toggleUserActive(mona.id, false)).rejects.toThrow('تعطيل حسابك')
  })
})

describe('server-side enforcement on actions', () => {
  it('an editor can save catalog data but not settings, users or orders', async () => {
    state.actor = { username: 'ed', isOwner: false, permissions: [...ROLE_PRESETS.editor], role: 'editor' }
    await expect(A.saveSettings(null, form({ name: 'x' }))).rejects.toThrow('صلاحية')
    await expect(A.saveUser(null, form({ username: 'zed', password: 'secret1' }))).rejects.toThrow('صلاحية')
    await expect(A.saveCoupon(null, form({ code: 'A1', discount: '5', type: 'percent', description: 'خصم' }))).resolves.toBeUndefined()
    const orders = await import('@/app/manage/orders-actions')
    expect(await orders.updateOrderStatus('00000000-0000-4000-8000-000000000000', 'confirmed')).toMatchObject({ ok: false, error: 'ليست لديك صلاحية' })
  })
})

describe('privilege escalation through editing other users', () => {
  const mkUser = (username: string, role: string, permissions: string[]) =>
    A.saveUser(null, form({ username, password: 'secret1', role, permissions: JSON.stringify(permissions), active: 'true' }))
  const row = async (username: string) => (await db.select().from(s.manageUsers).where(eq(s.manageUsers.username, username)))[0]

  it('a limited user cannot reset the password, disable or delete someone with more power', async () => {
    await mkUser('boss', 'manager', ['settings', 'products', 'orders'])
    await mkUser('clerk', 'operator', ['users', 'orders'])
    const boss = await row('boss')
    state.actor = { username: 'clerk', isOwner: false, permissions: ['users', 'orders'], role: 'operator' }
    await expect(A.saveUser(boss.id, form({ username: 'boss', password: 'hacked1', role: 'manager', permissions: JSON.stringify(['orders']), active: 'true' }))).rejects.toThrow('أكثر منك')
    await expect(A.toggleUserActive(boss.id, false)).rejects.toThrow('أكثر منك')
    await expect(A.deleteUser(boss.id)).rejects.toThrow('أكثر منك')
    expect((await row('boss')).passwordHash).toBe(boss.passwordHash)
  })

  it('only the owner can touch or create general admins', async () => {
    await mkUser('chief', 'admin', [...SCREENS])
    const chief = await row('chief')
    state.actor = { username: 'x', isOwner: false, permissions: [...SCREENS], role: 'admin' }
    await expect(A.toggleUserActive(chief.id, false)).rejects.toThrow('المالك')
    await expect(mkUser('another', 'admin', ['orders'])).rejects.toThrow('المالك')
    state.actor = owner()
    await expect(A.toggleUserActive(chief.id, false)).resolves.toBeUndefined()
  })

  it('renaming yourself in the same save does not bypass the self-lockout guard', async () => {
    await mkUser('rita', 'operator', ['users', 'orders'])
    const rita = await row('rita')
    state.actor = { username: 'rita', isOwner: false, permissions: ['users', 'orders'], role: 'operator' }
    await expect(A.saveUser(rita.id, form({ username: 'rita2', role: 'operator', permissions: JSON.stringify(['orders']), active: 'true' }))).rejects.toThrow('إدارة المستخدمين')
    await expect(A.saveUser(rita.id, form({ username: 'rita2', role: 'operator', permissions: JSON.stringify(['users']), active: 'false' }))).rejects.toThrow('تعطيل')
  })
})
