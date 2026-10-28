import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'

const db = drizzle(new PGlite())
vi.mock('@/lib/db/client', () => ({ db }))

const { smsProvider, buildSmsText, isSmsConfigured } = await import('@/lib/otp/providers/sms')
const { sendOtp, getOtpChannel } = await import('@/lib/otp/provider')

const input = { phone: '967771234567', code: '123456', purpose: 'login' as const }
const SMS_URL = 'https://api.sms-gate.app/3rdparty/v1/messages'
const WA_URL = 'https://wa.example.com'

type Call = { url: string; init: RequestInit }
function stubFetch(handler: (url: string) => { ok: boolean; status?: number } | Error) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const r = handler(url)
    if (r instanceof Error) throw r
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500) }
  })
  return calls
}

async function setChannel(otpChannel: 'whatsapp' | 'sms' | 'whatsapp_sms') {
  await db.insert(s.siteSettings).values({ id: 1, otpChannel }).onConflictDoUpdate({ target: s.siteSettings.id, set: { otpChannel } })
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
})
beforeEach(() => {
  process.env.SMS_GATE_USERNAME = 'user'
  process.env.SMS_GATE_PASSWORD = 'pass'
  delete process.env.SMS_GATE_URL
  process.env.WHATSAPP_WORKER_URL = WA_URL
  process.env.WHATSAPP_WORKER_TOKEN = 'tok'
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('SMS Gateway provider', () => {
  it('posts the message with Basic auth to the gateway and a +E.164 number', async () => {
    const calls = stubFetch(() => ({ ok: true }))
    expect(await smsProvider.send(input)).toEqual({ ok: true, provider: 'sms' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(SMS_URL)
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`)
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.phoneNumbers).toEqual(['+967771234567'])
    expect(body.textMessage.text).toContain('123456')
    expect(buildSmsText('999999', 'change_phone')).toContain('تغيير رقم الهاتف')
  })

  it('honours a custom gateway URL (local or self-hosted)', async () => {
    process.env.SMS_GATE_URL = 'https://sms.example.com/messages'
    const calls = stubFetch(() => ({ ok: true }))
    await smsProvider.send(input)
    expect(calls[0].url).toBe('https://sms.example.com/messages')
  })

  it('reports HTTP and network failures without leaking the code', async () => {
    stubFetch(() => ({ ok: false, status: 401 }))
    expect(await smsProvider.send(input)).toEqual({ ok: false, provider: 'sms', errorCode: 'HTTP_401' })
    stubFetch(() => new Error('boom'))
    expect(await smsProvider.send(input)).toEqual({ ok: false, provider: 'sms', errorCode: 'SEND_FAILED' })
  })

  it('refuses to send in production when credentials are missing', async () => {
    delete process.env.SMS_GATE_USERNAME
    vi.stubEnv('NODE_ENV', 'production')
    expect(isSmsConfigured()).toBe(false)
    expect(await smsProvider.send(input)).toEqual({ ok: false, provider: 'sms', errorCode: 'SMS_NOT_CONFIGURED' })
  })
})

describe('OTP channel switching', () => {
  it('defaults to whatsapp and follows the saved setting', async () => {
    expect(await getOtpChannel()).toBe('whatsapp')
    await setChannel('sms')
    expect(await getOtpChannel()).toBe('sms')
  })

  it('whatsapp only: never touches the SMS gateway, even when WhatsApp fails', async () => {
    await setChannel('whatsapp')
    const calls = stubFetch((url) => (url.startsWith(WA_URL) ? { ok: false, status: 502 } : { ok: true }))
    const r = await sendOtp(input)
    expect(r.ok).toBe(false)
    expect(calls.map((c) => c.url)).toEqual([`${WA_URL}/send`])
  })

  it('sms only: never touches WhatsApp', async () => {
    await setChannel('sms')
    const calls = stubFetch(() => ({ ok: true }))
    expect(await sendOtp(input)).toEqual({ ok: true, provider: 'sms' })
    expect(calls.map((c) => c.url)).toEqual([SMS_URL])
  })

  it('whatsapp then sms: falls back to SMS only when WhatsApp fails', async () => {
    await setChannel('whatsapp_sms')
    let calls = stubFetch(() => ({ ok: true }))
    expect(await sendOtp(input)).toEqual({ ok: true, provider: 'whatsapp' })
    expect(calls.map((c) => c.url)).toEqual([`${WA_URL}/send`])

    calls = stubFetch((url) => (url.startsWith(WA_URL) ? { ok: false, status: 502 } : { ok: true }))
    expect(await sendOtp(input)).toEqual({ ok: true, provider: 'sms' })
    expect(calls.map((c) => c.url)).toEqual([`${WA_URL}/send`, SMS_URL])
  })
})
