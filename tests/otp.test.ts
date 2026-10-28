import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'

process.env.SESSION_SECRET = 'test-secret-with-more-than-16-chars'
delete process.env.WHATSAPP_WORKER_URL
delete process.env.WHATSAPP_WORKER_TOKEN

const db = drizzle(new PGlite())
const jar = vi.hoisted(() => new Map<string, string>())

vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => void jar.set(n, v),
    delete: (n: string) => void jar.delete(n),
  }),
}))

const { createAndSendOtp } = await import('@/lib/otp/generate')
const { verifyOtp } = await import('@/lib/otp/verify')
const { consumeSendAttempt, consumeVerifyAttempt } = await import('@/lib/otp/rate-limit')
const { createSession, resolveSession, destroyCurrentSession, revokeAllSessions } = await import('@/lib/otp/session')
const { createCustomer } = await import('@/lib/otp/store')
const { whatsappProvider, buildMessage } = await import('@/lib/otp/providers/whatsapp')
const { resendCooldownSeconds } = await import('@/lib/otp/generate')
const sendRoute = await import('@/app/api/auth/send-otp/route')
const verifyRoute = await import('@/app/api/auth/verify-otp/route')
const meRoute = await import('@/app/api/auth/me/route')
const logoutRoute = await import('@/app/api/auth/logout/route')
const resendRoute = await import('@/app/api/auth/resend-otp/route')

const ctx = { ip: '1.2.3.4', userAgent: 'vitest' }
let phoneSeq = 0
const nextPhone = () => `9677${String(10000000 + ++phoneSeq)}`

/** Sends an OTP through the real flow and returns the plaintext code the dev provider logged. */
async function sendAndCapture(phone: string) {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const result = await createAndSendOtp({ phone, purpose: 'login', ...ctx })
  const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes(`code for ${phone}`))
  log.mockRestore()
  return { result, code: line?.split(': ')[1] ?? '' }
}

const json = (body: unknown) =>
  new Request('http://localhost/api', { method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: JSON.stringify(body) })

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
})
beforeEach(() => jar.clear())
afterEach(() => vi.unstubAllGlobals())

describe('OTP generation and verification', () => {
  it('stores only a salted hash, never the code', async () => {
    const phone = nextPhone()
    const { result, code } = await sendAndCapture(phone)
    expect(result.ok).toBe(true)
    expect(code).toMatch(/^\d{6}$/)
    const [row] = await db.select().from(s.otpCodes).where(eq(s.otpCodes.phone, phone))
    expect(JSON.stringify(row)).not.toContain(code)
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('accepts the right code once and rejects reuse', async () => {
    const phone = nextPhone()
    const { code } = await sendAndCapture(phone)
    expect(await verifyOtp({ phone, purpose: 'login', code })).toEqual({ ok: true })
    expect(await verifyOtp({ phone, purpose: 'login', code })).toEqual({ ok: false, error: 'NO_CODE' })
  })

  it('counts wrong attempts, then locks the code even for the right value', async () => {
    const phone = nextPhone()
    const { code } = await sendAndCapture(phone)
    const wrong = code === '000000' ? '111111' : '000000'
    expect(await verifyOtp({ phone, purpose: 'login', code: wrong })).toEqual({ ok: false, error: 'INVALID_CODE', remaining: 4 })
    for (let i = 0; i < 3; i++) await verifyOtp({ phone, purpose: 'login', code: wrong })
    expect(await verifyOtp({ phone, purpose: 'login', code: wrong })).toEqual({ ok: false, error: 'TOO_MANY_ATTEMPTS' })
    expect(await verifyOtp({ phone, purpose: 'login', code })).toEqual({ ok: false, error: 'NO_CODE' })
  })

  it('parallel wrong guesses cannot exceed the attempt limit, and the right code is locked out afterwards', async () => {
    const phone = nextPhone()
    const { code } = await sendAndCapture(phone)
    const wrong = code === '000000' ? '111111' : '000000'
    const results = await Promise.all(Array.from({ length: 12 }, () => verifyOtp({ phone, purpose: 'login', code: wrong })))
    const compared = results.filter((r) => !r.ok && r.error === 'INVALID_CODE').length
    expect(compared).toBeLessThanOrEqual(4)
    const [row] = await db.select().from(s.otpCodes).where(eq(s.otpCodes.phone, phone))
    expect(row.attempts).toBeLessThanOrEqual(5)
    expect(await verifyOtp({ phone, purpose: 'login', code })).toEqual({ ok: false, error: 'NO_CODE' })
  })

  it('rejects an expired code', async () => {
    const phone = nextPhone()
    const { code } = await sendAndCapture(phone)
    await db.update(s.otpCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.otpCodes.phone, phone))
    expect(await verifyOtp({ phone, purpose: 'login', code })).toEqual({ ok: false, error: 'EXPIRED' })
  })

  it('enforces the resend interval and invalidates the previous code on a new send', async () => {
    const phone = nextPhone()
    const first = await sendAndCapture(phone)
    const again = await createAndSendOtp({ phone, purpose: 'login', ...ctx })
    expect(again).toMatchObject({ ok: false, error: 'RESEND_TOO_SOON' })

    await db.update(s.otpCodes).set({ createdAt: new Date(Date.now() - 120_000) }).where(eq(s.otpCodes.phone, phone))
    const second = await sendAndCapture(phone)
    expect(second.result.ok).toBe(true)
    if (second.code !== first.code) {
      expect(await verifyOtp({ phone, purpose: 'login', code: first.code })).toMatchObject({ ok: false, error: 'INVALID_CODE' })
    }
    expect(await verifyOtp({ phone, purpose: 'login', code: second.code })).toEqual({ ok: true })
  })

  it('lets exactly one of several concurrent correct submissions succeed', async () => {
    const phone = nextPhone()
    const { code } = await sendAndCapture(phone)
    const results = await Promise.all(Array.from({ length: 5 }, () => verifyOtp({ phone, purpose: 'login', code })))
    expect(results.filter((r) => r.ok)).toHaveLength(1)
  })

  it('does not store a code when the worker fails to send', async () => {
    process.env.WHATSAPP_WORKER_URL = 'https://wa.example.com'
    process.env.WHATSAPP_WORKER_TOKEN = 'x'.repeat(32)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 502 })))
    const phone = nextPhone()
    try {
      expect(await createAndSendOtp({ phone, purpose: 'login', ...ctx })).toEqual({ ok: false, error: 'SEND_FAILED' })
      expect(await db.select().from(s.otpCodes).where(eq(s.otpCodes.phone, phone))).toHaveLength(0)
    } finally {
      delete process.env.WHATSAPP_WORKER_URL
      delete process.env.WHATSAPP_WORKER_TOKEN
    }
  })
})

describe('WhatsApp provider', () => {
  beforeEach(() => {
    process.env.WHATSAPP_WORKER_URL = 'https://wa.example.com/'
    process.env.WHATSAPP_WORKER_TOKEN = 'x'.repeat(32)
  })
  afterEach(() => {
    delete process.env.WHATSAPP_WORKER_URL
    delete process.env.WHATSAPP_WORKER_TOKEN
  })

  it('posts the phone and message to the worker with a bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await whatsappProvider.send({ phone: '967781234567', code: '123456', purpose: 'login' })).toEqual({ ok: true, provider: 'whatsapp' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://wa.example.com/send')
    expect(init.headers.Authorization).toBe(`Bearer ${'x'.repeat(32)}`)
    const body = JSON.parse(init.body)
    expect(body.phone).toBe('967781234567')
    expect(body.text).toContain('123456')
  })

  it('reports failure on HTTP errors and network errors without leaking the code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 422 })))
    expect(await whatsappProvider.send({ phone: '967781234567', code: '123456', purpose: 'login' })).toEqual({ ok: false, provider: 'whatsapp', errorCode: 'HTTP_422' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom 123456')))
    const res = await whatsappProvider.send({ phone: '967781234567', code: '123456', purpose: 'login' })
    expect(res).toEqual({ ok: false, provider: 'whatsapp', errorCode: 'SEND_FAILED' })
  })
})

describe('message variation (ban-risk mitigation)', () => {
  const at = (iso: string) => new Date(iso)

  it('includes the code, the Aden time to the second, and the validity period', () => {
    const msg = buildMessage('123456', 'login', at('2026-10-21T09:05:07Z'), () => 0)
    expect(msg).toContain('123456')
    expect(msg).toContain('12:05:07') // UTC+3
    expect(msg).toContain('5 دقائق')
  })

  it('never repeats the same text for the same code at different seconds', () => {
    const texts = new Set(
      Array.from({ length: 60 }, (_, i) => buildMessage('123456', 'login', new Date(Date.UTC(2026, 9, 21, 9, 0, i)), () => 0)),
    )
    expect(texts.size).toBe(60)
  })

  it('rotates among several wordings', () => {
    const when = at('2026-10-21T09:00:00Z')
    const variants = new Set([0, 0.3, 0.55, 0.9].map((r) => buildMessage('123456', 'login', when, () => r)))
    expect(variants.size).toBe(4)
  })

  it('words the change-phone purpose differently from login', () => {
    const when = at('2026-10-21T09:00:00Z')
    expect(buildMessage('111111', 'change_phone', when, () => 0)).toContain('تغيير رقم الهاتف')
    expect(buildMessage('111111', 'login', when, () => 0)).not.toContain('تغيير رقم الهاتف')
  })

  it('sends the varied text through the worker', async () => {
    process.env.WHATSAPP_WORKER_URL = 'https://wa.example.com'
    process.env.WHATSAPP_WORKER_TOKEN = 'x'.repeat(32)
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await whatsappProvider.send({ phone: '967781234567', code: '654321', purpose: 'login' })
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).text).toMatch(/\d{2}:\d{2}:\d{2}/)
    } finally {
      delete process.env.WHATSAPP_WORKER_URL
      delete process.env.WHATSAPP_WORKER_TOKEN
    }
  })
})

describe('escalating resend cooldown', () => {
  it('grows 1x, 2x, 5x, 15x and then stays at 15x', () => {
    expect([1, 2, 3, 4, 5, 9].map(resendCooldownSeconds)).toEqual([60, 120, 300, 900, 900, 900])
    expect(resendCooldownSeconds(0)).toBe(60)
  })

  it('makes the third request wait 5 minutes even after 2 minutes have passed', async () => {
    const phone = nextPhone()
    const row = (ageSeconds: number) => ({
      phone, codeHash: 'h', salt: 's', purpose: 'login' as const,
      expiresAt: new Date(Date.now() + 1e5), createdAt: new Date(Date.now() - ageSeconds * 1000),
    })
    await db.insert(s.otpCodes).values([row(600), row(400), row(180)])
    const blocked = await createAndSendOtp({ phone, purpose: 'login', ...ctx })
    expect(blocked).toMatchObject({ ok: false, error: 'RESEND_TOO_SOON' })
    expect((blocked as { retryAfter: number }).retryAfter).toBeGreaterThan(100)
    expect((blocked as { retryAfter: number }).retryAfter).toBeLessThanOrEqual(120)

    await db.update(s.otpCodes).set({ createdAt: new Date(Date.now() - 320_000) }).where(eq(s.otpCodes.phone, phone))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const allowed = await createAndSendOtp({ phone, purpose: 'login', ...ctx })
    log.mockRestore()
    expect(allowed.ok).toBe(true)
  })
})

describe('rate limiting', () => {
  it('blocks a phone after 5 codes in an hour', async () => {
    const phone = nextPhone()
    expect(await consumeSendAttempt(phone, 'unknown')).toBe(true)
    await db.insert(s.otpCodes).values(
      Array.from({ length: 5 }, () => ({ phone, codeHash: 'h', salt: 's', purpose: 'login' as const, expiresAt: new Date(Date.now() + 1e5) })),
    )
    expect(await consumeSendAttempt(phone, 'unknown')).toBe(false)
  })

  it('blocks an IP after 15 sends in an hour', async () => {
    const ip = '5.5.5.5'
    await db.insert(s.authEvents).values(Array.from({ length: 15 }, () => ({ event: 'otp_sent' as const, ip })))
    expect(await consumeSendAttempt(nextPhone(), ip)).toBe(false)
    expect(await consumeSendAttempt(nextPhone(), '6.6.6.6')).toBe(true)
  })

  it('counts resends toward the per-IP cap too', async () => {
    const ip = '7.7.7.7'
    await db.insert(s.authEvents).values([
      ...Array.from({ length: 10 }, () => ({ event: 'otp_resent' as const, ip })),
      ...Array.from({ length: 5 }, () => ({ event: 'otp_sent' as const, ip })),
    ])
    expect(await consumeSendAttempt(nextPhone(), ip)).toBe(false)
  })

  it('refuses a change-phone resend without a session, and a JSON null body', async () => {
    const r = await resendRoute.POST(json({ phone: nextPhone(), purpose: 'change_phone' }))
    expect(r.status).toBe(401)
    expect((await r.json()).error).toBe('AUTH_REQUIRED')
    const n = await resendRoute.POST(new Request('http://localhost/api', { method: 'POST', body: 'null' }))
    expect(n.status).toBe(400)
  })

  it('locks verification after 10 failures in 15 minutes', async () => {
    const phone = nextPhone()
    expect(await consumeVerifyAttempt(phone)).toBe(true)
    await db.insert(s.authEvents).values(Array.from({ length: 10 }, () => ({ event: 'otp_failed' as const, phone })))
    expect(await consumeVerifyAttempt(phone)).toBe(false)
  })
})

describe('sessions', () => {
  it('creates a cookie session whose token is stored only as a hash', async () => {
    const customer = await createCustomer(nextPhone())
    await createSession({ customerId: customer.id, ...ctx })
    const token = jar.get('tajline_session')!
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    const rows = await db.select().from(s.customerSessions).where(eq(s.customerSessions.customerId, customer.id))
    expect(rows[0].tokenHash).not.toBe(token)
    expect((await resolveSession())?.customer.id).toBe(customer.id)
  })

  it('rejects revoked, expired and blocked sessions and unknown tokens', async () => {
    const customer = await createCustomer(nextPhone())
    await createSession({ customerId: customer.id, ...ctx })
    await db.update(s.customerSessions).set({ expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 5000) }).where(eq(s.customerSessions.customerId, customer.id))
    expect(await resolveSession()).toBeNull()

    await createSession({ customerId: customer.id, ...ctx })
    await db.update(s.customers).set({ status: 'blocked' }).where(eq(s.customers.id, customer.id))
    expect(await resolveSession()).toBeNull()
    await db.update(s.customers).set({ status: 'active' }).where(eq(s.customers.id, customer.id))
    expect(await resolveSession()).not.toBeNull()

    await destroyCurrentSession()
    expect(jar.has('tajline_session')).toBe(false)
    jar.set('tajline_session', 'f'.repeat(64))
    expect(await resolveSession()).toBeNull()
  })

  it('revokes every session of a customer', async () => {
    const customer = await createCustomer(nextPhone())
    await createSession({ customerId: customer.id, ...ctx })
    const first = jar.get('tajline_session')!
    await createSession({ customerId: customer.id, ...ctx })
    await revokeAllSessions(customer.id)
    jar.set('tajline_session', first)
    expect(await resolveSession()).toBeNull()
  })

  it('createCustomer is race-safe for the same phone', async () => {
    const phone = nextPhone()
    const created = await Promise.all([createCustomer(phone), createCustomer(phone), createCustomer(phone)])
    expect(new Set(created.map((c) => c.id)).size).toBe(1)
  })
})

describe('auth API routes', () => {
  it('runs send -> verify -> me -> logout end to end and audits each step', async () => {
    const phone = '967781234567'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const sent = await sendRoute.POST(json({ phone: '+967 781 234 567' }))
    const code = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes(`code for ${phone}`))!.split(': ')[1]
    log.mockRestore()
    expect(sent.status).toBe(200)

    const bad = await verifyRoute.POST(json({ phone, code: code === '000000' ? '111111' : '000000' }))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ ok: false, error: 'INVALID_CODE', remaining: 4 })

    const ok = await verifyRoute.POST(json({ phone, code, next: '//evil.com' }))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true, redirect: '/' })

    const me = await (await meRoute.GET()).json()
    expect(me.authenticated).toBe(true)
    expect(me.customer.phone).toBe(phone)
    expect(me.customer.phoneMasked).toBe('+967 78•••••67')

    await logoutRoute.POST(json({}))
    expect((await (await meRoute.GET()).json()).authenticated).toBe(false)

    const events = (await db.select({ e: s.authEvents.event }).from(s.authEvents).where(eq(s.authEvents.phone, phone))).map((r) => r.e)
    expect(events).toEqual(expect.arrayContaining(['otp_sent', 'otp_failed', 'otp_verified', 'account_created', 'login']))
  })

  it('logs a Saudi customer in with a number typed in any format', async () => {
    await db.insert(s.siteSettings).values({ id: 1, loginCountries: ['967', '966'] }).onConflictDoUpdate({ target: s.siteSettings.id, set: { loginCountries: ['967', '966'] } })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect((await sendRoute.POST(json({ phone: '٠٥١٢٣٤٥٦٧٨' }))).status).toBe(200) // Arabic digits, local format
    const code = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes('code for 966512345678'))!.split(': ')[1]
    log.mockRestore()
    const ok = await verifyRoute.POST(json({ phone: '+966 51 234 5678', code }))
    expect(ok.status).toBe(200)
    const me = await (await meRoute.GET()).json()
    expect(me.customer.phone).toBe('966512345678')
    expect(me.customer.phoneMasked).toBe('+966 51•••••78')
    await db.update(s.siteSettings).set({ loginCountries: ['967'] })
  })

  it('validates input and refuses blocked accounts', async () => {
    expect((await sendRoute.POST(json({ phone: '123' }))).status).toBe(400)
    expect((await verifyRoute.POST(json({ phone: '781234560', code: '' }))).status).toBe(400)
    expect((await sendRoute.POST(json({ phone: '971501234567' }))).status).toBe(400) // unsupported country
    expect((await sendRoute.POST(json({ phone: '07123456' }))).status).toBe(400) // too short after the trunk zero
    expect((await sendRoute.POST(new Request('http://localhost/api', { method: 'POST', body: 'not json' }))).status).toBe(400)

    const phone = '967781234561'
    await db.insert(s.customers).values({ publicId: 'CUS_BLOCKED00001', phone, status: 'blocked' })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await sendRoute.POST(json({ phone: '0781234561' })) // typed locally, stored internationally
    const code = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes(`code for ${phone}`))!.split(': ')[1]
    log.mockRestore()
    expect((await verifyRoute.POST(json({ phone, code }))).status).toBe(403)
    expect(jar.has('tajline_session')).toBe(false)
  })

  it('answers 503 when SESSION_SECRET is missing in production', async () => {
    const saved = process.env.SESSION_SECRET
    delete process.env.SESSION_SECRET
    vi.stubEnv('NODE_ENV', 'production')
    try {
      expect((await sendRoute.POST(json({ phone: '781234562' }))).status).toBe(503)
    } finally {
      vi.unstubAllEnvs()
      process.env.SESSION_SECRET = saved
    }
  })

  it('keeps the audit table queryable by ip index', async () => {
    const r = await db.execute(sql`select indexname from pg_indexes where schemaname = 'store' and indexname = 'auth_events_ip_idx'`)
    expect(r.rows).toHaveLength(1)
  })
})
