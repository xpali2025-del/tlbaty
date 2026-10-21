import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const jar = new Map<string, string>()
const stored = vi.hoisted(() => ({ user: null as null | { username: string; active: boolean; role: string; permissions: string[] } }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
}))
vi.mock('@/lib/manage-users', () => ({
  findUserByUsername: async () => stored.user,
  verifyStoredUser: async (u: string, p: string) => (stored.user && p === 'pw' ? stored.user.username : null),
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
    const [name, exp, sig] = jar.get('manage_session')!.split('.')
    jar.set('manage_session', `${Buffer.from('admin2').toString('base64url')}.${exp}.${sig}`)
    expect(await A.getManageSessionUser()).toBeNull()
    jar.set('manage_session', `${name}.${Number(exp) + 999999}.${sig}`)
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
    stored.user = { username: 'sara', active: true, role: 'editor', permissions: ['products'] }
    expect(await A.authenticate('sara', 'pw')).toBe('sara')
    await A.createManageSession('sara')
    expect(await A.getManageSessionUser()).toBe('sara')
    stored.user = { username: 'sara', active: false, role: 'editor', permissions: ['products'] }
    expect(await A.getManageSessionUser()).toBeNull()
    stored.user = null
    expect(await A.isManageAuthenticated()).toBe(false)
  })

  it('derives permissions: owner has every screen, stored users only theirs, changes apply immediately', async () => {
    vi.stubEnv('MANAGE_PASSWORD', 'owner-pass')
    await A.createManageSession('odoo')
    expect(await A.getManageContext()).toMatchObject({ isOwner: true, role: 'owner' })
    await expect(A.assertManagePermission('users')).resolves.toBeTruthy()

    stored.user = { username: 'sara', active: true, role: 'editor', permissions: ['products'] }
    await A.createManageSession('sara')
    expect(await A.getManageContext()).toMatchObject({ isOwner: false, permissions: ['products'] })
    await expect(A.assertManagePermission('products')).resolves.toBeTruthy()
    await expect(A.assertManagePermission('settings')).rejects.toThrow('ليست لديك صلاحية')
    expect(await A.hasManagePermission('orders')).toBe(false)
    stored.user.permissions = ['orders']
    await expect(A.assertManagePermission('products')).rejects.toThrow()
    expect(await A.hasManagePermission('orders')).toBe(true)
  })
})
