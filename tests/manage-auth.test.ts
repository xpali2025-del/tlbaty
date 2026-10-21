import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const jar = new Map<string, string>()
const stored = vi.hoisted(() => ({ user: null as null | { _id: string; passwordHash: string; username: string; active: boolean; role: string; permissions: string[] } }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
}))
vi.mock('@/lib/manage-users', () => ({
  findUserByUsername: async (u: string) => (stored.user && stored.user.username.toLowerCase() === u.toLowerCase() ? stored.user : null),
  verifyStoredUser: async (u: string, p: string) => (stored.user && stored.user.username.toLowerCase() === u.toLowerCase() && p === 'pw' ? stored.user.username : null),
  verifyDummyPassword: () => {},
}))

const A = await import('@/lib/manage-auth')

beforeEach(() => {
  jar.clear()
  stored.user = null
  vi.unstubAllEnvs()
})
afterEach(() => vi.useRealTimers())

describe('manage auth', () => {
  it('is closed in production without a password and open in development', async () => {
    vi.stubEnv('MANAGE_PASSWORD', '')
    vi.stubEnv('NODE_ENV', 'production')
    expect(await A.isManageAuthenticated()).toBe(false)
    expect(await A.getManageSessionUser()).toBeNull()
    expect(await A.authenticate('odoo', 'anything')).toBeNull()
    await expect(A.assertManageAuthenticated()).rejects.toThrow()
    vi.stubEnv('NODE_ENV', 'development')
    expect(await A.isManageAuthenticated()).toBe(true)
  })

  it('signs in the owner, rejects wrong passwords and tampered cookies', async () => {
    vi.stubEnv('MANAGE_PASSWORD', 'owner-pass')
    expect(await A.authenticate('odoo', 'bad')).toBeNull()
    const user = await A.authenticate('odoo', 'owner-pass')
    expect(user).toBe('odoo')
    await A.createManageSession(user!)
    expect(await A.getManageSessionUser()).toBe('odoo')
    const [name, exp, fp, sig] = jar.get('manage_session')!.split('.')
    jar.set('manage_session', `${Buffer.from('admin2').toString('base64url')}.${exp}.${fp}.${sig}`)
    expect(await A.getManageSessionUser()).toBeNull()
    jar.set('manage_session', `${name}.${Number(exp) + 999999}.${fp}.${sig}`)
    expect(await A.getManageSessionUser()).toBeNull()
    jar.set('manage_session', 'legacy-token-without-expiry.abc')
    expect(await A.getManageSessionUser()).toBeNull()
  })

  it('expires sessions after 7 days', async () => {
    vi.stubEnv('MANAGE_PASSWORD', 'owner-pass')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    await A.createManageSession('odoo')
    vi.setSystemTime(new Date('2026-01-07T23:00:00Z'))
    expect(await A.getManageSessionUser()).toBe('odoo')
    vi.setSystemTime(new Date('2026-01-08T00:00:01Z'))
    expect(await A.getManageSessionUser()).toBeNull()
  })

  it('uses a dedicated secret: changing it invalidates sessions', async () => {
    vi.stubEnv('MANAGE_PASSWORD', 'owner-pass')
    vi.stubEnv('MANAGE_SESSION_SECRET', 'a'.repeat(20))
    await A.createManageSession('odoo')
    expect(await A.getManageSessionUser()).toBe('odoo')
    vi.stubEnv('MANAGE_SESSION_SECRET', 'b'.repeat(20))
    expect(await A.getManageSessionUser()).toBeNull()
  })

  it('ends the session of a stored user once disabled or deleted', async () => {
    vi.stubEnv('MANAGE_PASSWORD', 'owner-pass')
    stored.user = { _id: 'id-1', passwordHash: 'h1', username: 'sara', active: true, role: 'editor', permissions: ['products'] }
    expect(await A.authenticate('sara', 'pw')).toBe('sara')
    await A.createManageSession('sara')
    expect(await A.getManageSessionUser()).toBe('sara')
    stored.user = { _id: 'id-1', passwordHash: 'h1', username: 'sara', active: false, role: 'editor', permissions: ['products'] }
    expect(await A.getManageSessionUser()).toBeNull()
    stored.user = null
    expect(await A.isManageAuthenticated()).toBe(false)
  })

  it('derives permissions: owner has every screen, stored users only theirs, changes apply immediately', async () => {
    vi.stubEnv('MANAGE_PASSWORD', 'owner-pass')
    await A.createManageSession('odoo')
    expect(await A.getManageContext()).toMatchObject({ isOwner: true, role: 'owner' })
    await expect(A.assertManagePermission('users')).resolves.toBeTruthy()

    stored.user = { _id: 'id-1', passwordHash: 'h1', username: 'sara', active: true, role: 'editor', permissions: ['products'] }
    await A.createManageSession('sara')
    expect(await A.getManageContext()).toMatchObject({ isOwner: false, permissions: ['products'] })
    await expect(A.assertManagePermission('products')).resolves.toBeTruthy()
    await expect(A.assertManagePermission('settings')).rejects.toThrow('ليست لديك صلاحية')
    expect(await A.hasManagePermission('orders')).toBe(false)
    stored.user.permissions = ['orders']
    await expect(A.assertManagePermission('products')).rejects.toThrow()
    expect(await A.hasManagePermission('orders')).toBe(true)
  })

  it('invalidates sessions when the account is deleted and recreated, or its password changes', async () => {
    vi.stubEnv('MANAGE_PASSWORD', 'owner-pass')
    stored.user = { _id: 'id-1', passwordHash: 'h1', username: 'sara', active: true, role: 'editor', permissions: ['products'] }
    await A.createManageSession('sara')
    expect(await A.getManageSessionUser()).toBe('sara')
    stored.user = { ...stored.user, _id: 'id-2' } // deleted and recreated under the same name
    expect(await A.getManageSessionUser()).toBeNull()
    stored.user = { ...stored.user, _id: 'id-1' }
    expect(await A.getManageSessionUser()).toBe('sara')
    stored.user = { ...stored.user, passwordHash: 'h2' } // password reset
    expect(await A.getManageSessionUser()).toBeNull()
  })

  it('invalidates the owner session when the owner password changes, even with a dedicated secret', async () => {
    vi.stubEnv('MANAGE_PASSWORD', 'owner-pass')
    vi.stubEnv('MANAGE_SESSION_SECRET', 'c'.repeat(20))
    await A.createManageSession('odoo')
    expect(await A.getManageSessionUser()).toBe('odoo')
    vi.stubEnv('MANAGE_PASSWORD', 'new-owner-pass')
    expect(await A.getManageSessionUser()).toBeNull()
  })

  it('the owner username is reserved at login: a stored user with that name cannot sign in', async () => {
    vi.stubEnv('MANAGE_PASSWORD', 'owner-pass')
    stored.user = { _id: 'id-9', passwordHash: 'h', username: 'Odoo', active: true, role: 'admin', permissions: ['users'] }
    expect(await A.authenticate('odoo', 'pw')).toBeNull()
    expect(await A.authenticate('ODOO', 'owner-pass')).toBe('odoo')
  })
})
