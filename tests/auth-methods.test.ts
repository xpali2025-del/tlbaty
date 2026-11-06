import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { openTestDb } from './helpers/test-db'
import * as s from '@/lib/db/store'
import { unwrapAll } from '@/lib/action-result'

const testDb = await openTestDb()
const db = testDb.db
const mocks = vi.hoisted(() => ({
  wa: vi.fn(async (): Promise<{ ok: boolean; provider: string; errorCode?: string }> => ({ ok: true, provider: 'whatsapp' })),
  sms: vi.fn(async (): Promise<{ ok: boolean; provider: string; errorCode?: string }> => ({ ok: true, provider: 'sms' })),
}))

vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('@/lib/manage-auth', () => ({
  assertManagePermission: async () => ({ username: 'tester', isOwner: true, permissions: [], role: 'owner' }),
  assertManageAuthenticated: async () => ({ username: 'tester', isOwner: true, permissions: [], role: 'owner' }),
  getManageUsername: () => 'odoo',
  getManageSessionUser: async () => 'tester',
}))
vi.mock('@/lib/storage/r2', () => ({ deleteImageObject: vi.fn(async () => {}), createImageUpload: vi.fn(), createVideoUpload: vi.fn() }))
vi.mock('ai', () => ({ generateText: vi.fn() }))
vi.mock('@/lib/otp/providers/whatsapp', () => ({ whatsappProvider: { name: 'whatsapp', send: mocks.wa } }))
vi.mock('@/lib/otp/providers/sms', () => ({ smsProvider: { name: 'sms', send: mocks.sms }, isSmsConfigured: () => true }))

const { channelForLegacy, legacyChannelFor, methodKind, METHOD_KEYS, getActiveMethod } = await import('@/lib/auth/methods')
const { sendOtp, getOtpChannel } = await import('@/lib/otp/provider')
const A = unwrapAll(await import('@/app/manage/actions'))

const input = { phone: '967771234567', code: '123456', purpose: 'login' as const }
const setMethod = (m: string) => db.update(s.siteSettings).set({ loginMethod: m })

beforeAll(async () => {
  await testDb.migrate()
  await db.insert(s.siteSettings).values({ id: 1 })
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.wa.mockResolvedValue({ ok: true, provider: 'whatsapp' })
  mocks.sms.mockResolvedValue({ ok: true, provider: 'sms' })
})

describe('login method keys', () => {
  it('channelForLegacy and legacyChannelFor round-trip the three legacy channels', () => {
    for (const channel of ['whatsapp', 'sms', 'whatsapp_sms'] as const) expect(legacyChannelFor(channelForLegacy(channel))).toBe(channel)
    expect([channelForLegacy('whatsapp'), channelForLegacy('sms'), channelForLegacy('whatsapp_sms')]).toEqual(['wa_web', 'sms', 'wa_web_sms'])
    expect(legacyChannelFor('wa_cloud')).toBe('whatsapp') // لا مقابل قديم له
    expect(legacyChannelFor('puk')).toBe('whatsapp')
  })

  it('methodKind classifies all six methods', () => {
    expect(METHOD_KEYS).toHaveLength(6)
    expect(methodKind('wa_chat')).toBe('chat')
    expect(methodKind('puk')).toBe('puk')
    for (const k of ['wa_cloud', 'wa_web', 'sms', 'wa_web_sms'] as const) expect(methodKind(k)).toBe('code')
  })
})

describe('getActiveMethod', () => {
  it('reads the setting without cache', async () => {
    await setMethod('sms')
    expect(await getActiveMethod()).toBe('sms')
    expect(await getOtpChannel()).toBe('sms')
    await setMethod('wa_chat')
    expect(await getActiveMethod()).toBe('wa_chat')
  })

  it('falls back to OTP_PROVIDER when the read fails', async () => {
    vi.resetModules()
    vi.stubEnv('OTP_PROVIDER', 'sms')
    const spy = vi.spyOn(db, 'select').mockImplementationOnce(() => {
      throw new Error('db down')
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fresh = await import('@/lib/auth/methods')
    expect(await fresh.getActiveMethod()).toBe('sms')
    expect(errors).toHaveBeenCalled()
    spy.mockRestore()
    errors.mockRestore()
    vi.unstubAllEnvs()
    vi.resetModules()
  })
})

describe('sendOtp routes by method', () => {
  it('uses the WhatsApp worker for wa_web and wa_chat, SMS for sms', async () => {
    await setMethod('wa_web')
    expect(await sendOtp(input)).toMatchObject({ ok: true, provider: 'whatsapp' })
    expect([mocks.wa.mock.calls.length, mocks.sms.mock.calls.length]).toEqual([1, 0])
    await setMethod('sms')
    expect(await sendOtp(input)).toMatchObject({ ok: true, provider: 'sms' })
    expect([mocks.wa.mock.calls.length, mocks.sms.mock.calls.length]).toEqual([1, 1])
  })

  it('wa_web_sms falls back to SMS only when WhatsApp fails', async () => {
    await setMethod('wa_web_sms')
    expect((await sendOtp(input)).provider).toBe('whatsapp')
    expect(mocks.sms).not.toHaveBeenCalled()
    mocks.wa.mockResolvedValueOnce({ ok: false, provider: 'whatsapp', errorCode: 'HTTP_500' })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await sendOtp(input)).provider).toBe('sms')
    errors.mockRestore()
    expect([mocks.wa.mock.calls.length, mocks.sms.mock.calls.length]).toEqual([2, 1])
  })

  it('wa_cloud is not implemented yet', async () => {
    await setMethod('wa_cloud')
    await expect(sendOtp(input)).rejects.toThrow('wa_cloud not implemented')
  })
})

describe('sendOtp in puk mode', () => {
  it('refuses to send and calls no provider', async () => {
    await setMethod('puk')
    expect(await sendOtp(input)).toEqual({ ok: false, provider: 'none', errorCode: 'METHOD_DISABLED' })
    expect(mocks.wa).not.toHaveBeenCalled()
    expect(mocks.sms).not.toHaveBeenCalled()
  })
})

describe('saveSettings and login_method', () => {
  it('keeps login_method in sync with the submitted otpChannel', async () => {
    const form = (fields: Record<string, string>) => {
      const f = new FormData()
      for (const [k, v] of Object.entries(fields)) f.set(k, v)
      return f
    }
    await A.saveSettings(null, form({ name: 'م', codEnabled: 'true', otpChannel: 'whatsapp_sms' }))
    let [row] = await db.select().from(s.siteSettings)
    expect([row.otpChannel, row.loginMethod]).toEqual(['whatsapp_sms', 'wa_web_sms'])
    await A.saveSettings(null, form({ name: 'م', codEnabled: 'true', otpChannel: 'sms' }))
    ;[row] = await db.select().from(s.siteSettings)
    expect([row.otpChannel, row.loginMethod]).toEqual(['sms', 'sms'])
    // بلا otpChannel لا يتغير شيء
    await A.saveSettings(null, form({ name: 'م', codEnabled: 'true' }))
    ;[row] = await db.select().from(s.siteSettings)
    expect([row.otpChannel, row.loginMethod]).toEqual(['sms', 'sms'])
  })

  it('a write to otp_channel alone (previous release) also updates login_method, and an explicit login_method sticks', async () => {
    await db.update(s.siteSettings).set({ otpChannel: 'whatsapp' })
    expect((await db.select().from(s.siteSettings))[0].loginMethod).toBe('wa_web')
    await db.update(s.siteSettings).set({ loginMethod: 'puk' })
    await db.update(s.siteSettings).set({ name: 'اسم جديد' })
    expect((await db.select().from(s.siteSettings))[0].loginMethod).toBe('puk')
  })
})
