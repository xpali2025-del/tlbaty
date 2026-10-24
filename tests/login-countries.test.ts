import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'

process.env.SESSION_SECRET = 'test-secret-with-more-than-16-chars'
delete process.env.WHATSAPP_WORKER_URL
delete process.env.WHATSAPP_WORKER_TOKEN

const db = drizzle(new PGlite())
const dbMock = vi.hoisted(() => ({ broken: false }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', () => ({
  db: new Proxy({}, { get: (_, p) => (dbMock.broken ? () => { throw new Error('down') } : Reflect.get(db, p)) }),
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }))

const C = await import('@/lib/otp/countries')
const send = await import('@/app/api/auth/send-otp/route')
const resend = await import('@/app/api/auth/resend-otp/route')
const verify = await import('@/app/api/auth/verify-otp/route')
const { countryCodeOf } = await import('@/lib/phone')
const { composePhone, hasPhoneDigits } = await import('@/components/auth/phone-field')

const post = (body: unknown) => new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const setCountries = (codes: string[]) =>
  db.insert(s.siteSettings).values({ id: 1, loginCountries: codes }).onConflictDoUpdate({ target: s.siteSettings.id, set: { loginCountries: codes } })

beforeAll(async () => { await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') }) })
afterEach(async () => { dbMock.broken = false; await db.delete(s.siteSettings) })

describe('which countries may log in', () => {
  it('is Yemen only when nothing is saved, and falls back to Yemen when the database is down', async () => {
    expect(await C.getLoginCountries()).toEqual(['967'])
    await setCountries(['967', '966'])
    dbMock.broken = true
    expect(await C.getLoginCountries()).toEqual(['967'])
  })
  it('sanitizes to supported codes in a stable order, never empty', () => {
    expect(C.sanitizeLoginCountries(['966', '967', '966', '971'])).toEqual(['967', '966'])
    expect(C.sanitizeLoginCountries(['971'])).toEqual(['967'])
    expect(C.sanitizeLoginCountries(null)).toEqual(['967'])
  })
  it('checks the country of an international number', async () => {
    expect(countryCodeOf('967781234567')).toBe('967')
    expect(countryCodeOf('15551234567')).toBeNull()
    expect(await C.isLoginCountryAllowed('966512345678')).toBe(false)
    await setCountries(['967', '966'])
    expect(await C.isLoginCountryAllowed('966512345678')).toBe(true)
    expect(await C.isLoginCountryAllowed('971501234567')).toBe(false)
    expect((await C.getLoginCountryOptions()).map((o) => o.code)).toEqual(['967', '966'])
  })
})

describe('the server refuses disabled countries', () => {
  it.each([
    ['send', () => send.POST(post({ phone: '+966512345678' }))],
    ['resend', () => resend.POST(post({ phone: '+966512345678' }))],
    ['verify', () => verify.POST(post({ phone: '+966512345678', code: '123456' }))],
  ])('%s answers COUNTRY_NOT_ALLOWED for Saudi when only Yemen is enabled', async (_n, call) => {
    const res = await call()
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('COUNTRY_NOT_ALLOWED')
  })
  it('lets Saudi through once enabled, and still validates the number first', async () => {
    await setCountries(['967', '966'])
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect((await send.POST(post({ phone: '+966512345678' }))).status).toBe(200)
    log.mockRestore()
    expect((await send.POST(post({ phone: '+966112345678' }))).status).toBe(400)
  })
})

describe('the phone field builds the international number', () => {
  it('uses the selected country for a local number and keeps an explicit prefix', () => {
    expect(composePhone('967', '777 123 456')).toBe('+967777123456')
    expect(composePhone('967', '0777123456')).toBe('+967777123456')
    expect(composePhone('966', '٠٥١٢٣٤٥٦٧٨')).toBe('+966512345678')
    expect(composePhone('967', '967777123456')).toBe('+967777123456')
    expect(composePhone('967', '+966 51 234 5678')).toBe('+966 51 234 5678')
    expect(composePhone('967', '00966512345678')).toBe('00966512345678')
  })
  it('needs at least 8 digits to try', () => {
    expect(hasPhoneDigits('7771234')).toBe(false)
    expect(hasPhoneDigits('777 12345')).toBe(true)
  })
})
