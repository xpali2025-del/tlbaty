import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { maskPhone } from '@/lib/phone'

process.env.SESSION_SECRET = 'test-secret-with-more-than-16-chars'
process.env.WHATSAPP_WORKER_TOKEN = 'w'.repeat(32)
process.env.WHATSAPP_BOT_NUMBER = '+967 700 000 000'

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

const start = await import('@/app/api/auth/chat-login/start/route')
const claim = await import('@/app/api/auth/chat-login/claim/route')
const status = await import('@/app/api/auth/chat-login/status/route')
const verify = await import('@/app/api/auth/chat-login/verify/route')
const me = await import('@/app/api/auth/me/route')

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api', { method: 'POST', headers: { 'x-forwarded-for': '8.8.8.8', ...headers }, body: JSON.stringify(body) })
const asWorker = { authorization: `Bearer ${'w'.repeat(32)}` }

let seq = 0
const phone = () => `9677${String(20000000 + ++seq)}`

async function startFlow() {
  const res = await start.POST(post({}))
  return { res, data: await res.json() }
}
const codeFrom = (text: string) => /\b(\d{6})\b/.exec(text.replace(/\d{2}:\d{2}:\d{2}/, ''))![1]
const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000')

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
})
beforeEach(() => jar.clear())

describe('start', () => {
  it('creates a challenge bound to the browser and returns a wa.me link with the token', async () => {
    const { res, data } = await startFlow()
    expect(res.status).toBe(200)
    expect(data.token).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
    expect(data.link).toBe(`https://wa.me/967700000000?text=${encodeURIComponent(`رمز الدخول: ${data.token}`)}`)
    const secret = jar.get('login_challenge')!
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    const [row] = await db.select().from(s.loginChallenges).where(eq(s.loginChallenges.token, data.token))
    expect(row.browserSecretHash).not.toBe(secret)
    expect(row.phone).toBeNull()
  })

  it('limits challenge creation per IP and reports missing configuration', async () => {
    await db.insert(s.loginChallenges).values(
      Array.from({ length: 20 }, (_, i) => ({
        token: `ZZZZ${String(i).padStart(2, '2')}`.slice(0, 6), browserSecretHash: `limit-${i}`,
        expiresAt: new Date(Date.now() + 1e5), ip: '7.7.7.7',
      })),
    )
    const limited = await start.POST(post({}, { 'x-forwarded-for': '7.7.7.7' }))
    expect(limited.status).toBe(429)

    const saved = process.env.WHATSAPP_BOT_NUMBER
    delete process.env.WHATSAPP_BOT_NUMBER
    expect((await start.POST(post({}))).status).toBe(503)
    process.env.WHATSAPP_BOT_NUMBER = saved
  })
})

describe('bot number from settings', () => {
  it('prefers the number saved in the panel over the environment, so a banned number can be swapped without a deploy', async () => {
    await db.insert(s.siteSettings).values({ id: 1, loginBotNumber: '966500000001' }).onConflictDoUpdate({ target: s.siteSettings.id, set: { loginBotNumber: '966500000001' } })
    const { data } = await startFlow()
    expect(data.link).toContain('https://wa.me/966500000001?text=')

    await db.update(s.siteSettings).set({ loginBotNumber: null })
    const env = await startFlow()
    expect(env.data.link).toContain('https://wa.me/967700000000?text=')

    const saved = process.env.WHATSAPP_BOT_NUMBER
    delete process.env.WHATSAPP_BOT_NUMBER
    expect((await start.POST(post({}))).status).toBe(503)
    await db.update(s.siteSettings).set({ loginBotNumber: '966500000002' })
    expect((await start.POST(post({}))).status).toBe(200)
    await db.update(s.siteSettings).set({ loginBotNumber: null })
    process.env.WHATSAPP_BOT_NUMBER = saved
  })

  it('the database refuses a malformed number', async () => {
    await expect(db.insert(s.siteSettings).values({ id: 1, loginBotNumber: '+967 7' }).onConflictDoUpdate({ target: s.siteSettings.id, set: { loginBotNumber: '+967 7' } })).rejects.toThrow()
  })
})

describe('claim (called by the WhatsApp worker)', () => {
  it('requires the worker bearer token', async () => {
    const { data } = await startFlow()
    expect((await claim.POST(post({ phone: phone(), token: data.token }))).status).toBe(401)
    expect((await claim.POST(post({ phone: phone(), token: data.token }, { authorization: 'Bearer wrong' }))).status).toBe(401)
    const [row] = await db.select().from(s.loginChallenges).where(eq(s.loginChallenges.token, data.token))
    expect(row.claimedAt).toBeNull()
  })

  it('claims once, returns a varied reply with a fresh code, and stores only its hash', async () => {
    const { data } = await startFlow()
    const p = phone()
    const res = await claim.POST(post({ phone: p, token: data.token.toLowerCase() }, asWorker))
    expect(res.status).toBe(200)
    const { text } = await res.json()
    const code = codeFrom(text)
    expect(text).toMatch(/\d{2}:\d{2}:\d{2}/)
    const [otp] = await db.select().from(s.otpCodes).where(eq(s.otpCodes.phone, p))
    expect(JSON.stringify(otp)).not.toContain(code)
    expect(otp.provider).toBe('whatsapp-reply')

    const again = await claim.POST(post({ phone: phone(), token: data.token }, asWorker))
    expect(again.status).toBe(404)
  })

  it('rejects bad input, unknown tokens and expired challenges without issuing codes', async () => {
    const p = phone()
    expect((await claim.POST(post({ phone: '123', token: 'ABCDEF' }, asWorker))).status).toBe(400)
    expect((await claim.POST(post({ phone: '781234567', token: 'ABCDEF' }, asWorker))).status).toBe(400) // not international
    expect((await claim.POST(post({ phone: '971501234567', token: 'ABCDEF' }, asWorker))).status).toBe(400) // unsupported country
    expect((await claim.POST(post({ phone: p, token: 'bad' }, asWorker))).status).toBe(400)
    expect((await claim.POST(post({ phone: p, token: 'ABCDEF' }, asWorker))).status).toBe(404)

    const { data } = await startFlow()
    await db.update(s.loginChallenges).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.loginChallenges.token, data.token))
    expect((await claim.POST(post({ phone: p, token: data.token }, asWorker))).status).toBe(404)
    expect(await db.select().from(s.otpCodes).where(eq(s.otpCodes.phone, p))).toHaveLength(0)
  })

  it('applies the resend cooldown without burning the new challenge', async () => {
    const p = phone()
    const first = await startFlow()
    expect((await claim.POST(post({ phone: p, token: first.data.token }, asWorker))).status).toBe(200)
    const second = await startFlow()
    const res = await claim.POST(post({ phone: p, token: second.data.token }, asWorker))
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ error: 'RESEND_TOO_SOON' })
    const [row] = await db.select().from(s.loginChallenges).where(eq(s.loginChallenges.token, second.data.token))
    expect(row.claimedAt).toBeNull()
  })
})

describe('Saudi customers', () => {
  afterEach(async () => { await db.update(s.siteSettings).set({ loginCountries: ['967'] }) })
  it('log in through the same flow with a +966 number', async () => {
    await db.insert(s.siteSettings).values({ id: 1, loginCountries: ['967', '966'] }).onConflictDoUpdate({ target: s.siteSettings.id, set: { loginCountries: ['967', '966'] } })
    const { data } = await startFlow()
    const saudi = '966512345678'
    const { text } = await (await claim.POST(post({ phone: saudi, token: data.token }, asWorker))).json()
    expect(await (await status.GET()).json()).toEqual({ state: 'claimed', phoneMasked: '+966 51•••••78' })
    expect((await verify.POST(post({ code: codeFrom(text) }))).status).toBe(200)
    const me = await (await import('@/app/api/auth/me/route')).GET()
    expect((await me.json()).customer.phone).toBe(saudi)
  })
})

describe('login countries', () => {
  it('refuses a Saudi number by default (Yemen only) without consuming the token', async () => {
    const { data } = await startFlow()
    const res = await claim.POST(post({ phone: '966512345678', token: data.token }, asWorker))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('COUNTRY_NOT_ALLOWED')
    expect(await (await status.GET()).json()).toEqual({ state: 'waiting' })
  })
})

describe('status and verify (the browser side)', () => {
  it('walks waiting -> claimed -> verified, then creates the customer and session once', async () => {
    const { data } = await startFlow()
    expect(await (await status.GET()).json()).toEqual({ state: 'waiting' })
    expect((await verify.POST(post({ code: '123456' }))).status).toBe(409)

    const p = phone()
    const { text } = await (await claim.POST(post({ phone: p, token: data.token }, asWorker))).json()
    const code = codeFrom(text)
    expect(await (await status.GET()).json()).toEqual({ state: 'claimed', phoneMasked: maskPhone(p) })

    const bad = await verify.POST(post({ code: wrongCode(code) }))
    expect(await bad.json()).toMatchObject({ ok: false, error: 'INVALID_CODE', remaining: 4 })

    const ok = await verify.POST(post({ code, next: '//evil.com' }))
    expect(await ok.json()).toEqual({ ok: true, redirect: '/' })
    expect(jar.has('tajline_session')).toBe(true)
    expect(jar.has('login_challenge')).toBe(false)
    expect((await (await me.GET()).json()).customer.phone).toBe(p)

    const [customer] = await db.select().from(s.customers).where(eq(s.customers.phone, p))
    expect(customer).toBeDefined()
    const events = (await db.select({ e: s.authEvents.event }).from(s.authEvents).where(eq(s.authEvents.phone, p))).map((r) => r.e)
    expect(events).toEqual(expect.arrayContaining(['otp_sent', 'otp_failed', 'otp_verified', 'account_created', 'login']))
  })

  it('refuses a different browser, even with the correct code', async () => {
    const { data } = await startFlow()
    const { text } = await (await claim.POST(post({ phone: phone(), token: data.token }, asWorker))).json()
    jar.set('login_challenge', 'f'.repeat(64)) // another browser's cookie
    expect((await verify.POST(post({ code: codeFrom(text) }))).status).toBe(410)
    jar.delete('login_challenge')
    expect((await verify.POST(post({ code: codeFrom(text) }))).status).toBe(410)
    expect(jar.has('tajline_session')).toBe(false)
  })

  it('takes the phone from the challenge and ignores any phone in the request', async () => {
    const { data } = await startFlow()
    const p = phone()
    const { text } = await (await claim.POST(post({ phone: p, token: data.token }, asWorker))).json()
    await verify.POST(post({ code: codeFrom(text), phone: '967777777777' }))
    expect(await db.select().from(s.customers).where(eq(s.customers.phone, '967777777777'))).toHaveLength(0)
    expect(await db.select().from(s.customers).where(eq(s.customers.phone, p))).toHaveLength(1)
  })

  it('lets only one of several concurrent correct submissions log in', async () => {
    const { data } = await startFlow()
    const { text } = await (await claim.POST(post({ phone: phone(), token: data.token }, asWorker))).json()
    const code = codeFrom(text)
    const results = await Promise.all(Array.from({ length: 5 }, () => verify.POST(post({ code }))))
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
  })

  it('refuses blocked customers and expired challenges', async () => {
    const p = phone()
    await db.insert(s.customers).values({ publicId: `CUS_BLK${seq}`, phone: p, status: 'blocked' })
    const { data } = await startFlow()
    const { text } = await (await claim.POST(post({ phone: p, token: data.token }, asWorker))).json()
    expect((await verify.POST(post({ code: codeFrom(text) }))).status).toBe(403)
    expect(jar.has('tajline_session')).toBe(false)

    const other = await startFlow()
    await db.update(s.loginChallenges).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.loginChallenges.token, other.data.token))
    expect(await (await status.GET()).json()).toEqual({ state: 'expired' })
  })

  it('kills the code after too many wrong attempts', async () => {
    const { data } = await startFlow()
    const { text } = await (await claim.POST(post({ phone: phone(), token: data.token }, asWorker))).json()
    const code = codeFrom(text)
    for (let i = 0; i < 4; i++) await verify.POST(post({ code: wrongCode(code) }))
    expect((await verify.POST(post({ code: wrongCode(code) }))).status).toBe(429)
    expect((await verify.POST(post({ code }))).status).toBe(400)
    expect(jar.has('tajline_session')).toBe(false)
  })
})
