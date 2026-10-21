import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ ip: '1.2.3.4' }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': state.ip }), cookies: async () => ({ set: () => {}, delete: () => {}, get: () => undefined }) }))
vi.mock('@/lib/manage-users', () => ({ findUserByUsername: async () => null, verifyStoredUser: async () => null, verifyDummyPassword: () => {} }))

const { login } = await import('@/app/manage/auth-actions')

describe('admin login throttling', () => {
  beforeEach(() => vi.stubEnv('MANAGE_PASSWORD', 'owner-pass'))

  it('locks a username after 8 failed guesses, even from different addresses, and lets the right password in before that', async () => {
    for (let i = 0; i < 8; i++) {
      state.ip = `10.0.0.${i}`
      expect((await login('victim', 'wrong')).error).toContain('غير صحيحة')
    }
    state.ip = '10.0.0.99'
    expect((await login('victim', 'wrong')).error).toContain('محاولات كثيرة')
    state.ip = '10.1.0.1'
    expect(await login('odoo', 'owner-pass')).toEqual({})
  })

  it('limits one address across many usernames', async () => {
    state.ip = '9.9.9.9'
    let last = ''
    for (let i = 0; i < 25; i++) last = (await login(`user${i}`, 'x')).error ?? ''
    expect(last).toContain('محاولات كثيرة')
  })
})
