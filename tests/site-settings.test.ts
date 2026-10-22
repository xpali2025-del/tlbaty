import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { SITE_CONFIG } from '@/lib/site'

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
const db = drizzle(new PGlite())
vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }))
vi.mock('@/lib/storage/r2', () => ({ deleteImageObject: vi.fn(async () => {}) }))
vi.mock('ai', () => ({ generateText: vi.fn() }))
vi.mock('@/lib/manage-auth', () => ({
  getManageUsername: () => 'odoo',
  getManageSessionUser: async () => 'm',
  assertManagePermission: async () => ({ username: 'm', isOwner: true, permissions: [], role: 'owner' }),
}))

const { mergeSiteConfig, getSiteConfig, whatsappDigits } = await import('@/lib/site-config')
const A = await import('@/app/manage/actions')
const form = (f: Record<string, string>) => {
  const d = new FormData()
  for (const [k, v] of Object.entries(f)) d.set(k, v)
  return d
}
const both = { codEnabled: 'true', transferEnabled: 'true' }

beforeAll(async () => { await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') }) })
beforeEach(async () => { await db.delete(s.siteSettings) })

describe('mergeSiteConfig', () => {
  it('uses the built-in defaults when nothing is saved', () => {
    const c = mergeSiteConfig(null)
    expect(c.name).toBe(SITE_CONFIG.name)
    expect(c.contact.whatsapp).toBe(SITE_CONFIG.contact.whatsapp)
    expect(c.payments).toEqual({ cashOnDelivery: true, manualTransfer: true, wallet: true })
    expect(c.logoUrl).toBeNull()
  })

  it('applies saved values; blank contact/social fields are hidden, blank brand fields fall back', async () => {
    await A.saveSettings(null, form({ name: 'متجر النور', tagline: 'جودة وثقة', phone: '+967 777 123 456', whatsapp: '+967 777 123 456', email: 'a@b.co', instagram: '@noor', telegram: 'https://t.me/noor', ...both }))
    const c = await getSiteConfig()
    expect(c).toMatchObject({ name: 'متجر النور', tagline: 'جودة وثقة', nameEn: SITE_CONFIG.nameEn })
    expect(c.contact).toMatchObject({ phone: '+967777123456', phoneDisplay: '+967 777 123 456', whatsapp: '967777123456', email: 'a@b.co', address: '' })
    expect(c.social).toMatchObject({ whatsapp: 'https://wa.me/967777123456', instagram: 'https://instagram.com/noor', telegram: 'https://t.me/noor', facebook: '', tiktok: '' })
    expect(c.footer.copyright).toContain('متجر النور')
  })

  it('normalizes whatsapp numbers', () => {
    expect(whatsappDigits('+967 77-123 4567')).toBe('967771234567')
    expect(whatsappDigits('00967771234567')).toBe('967771234567')
  })
})

describe('saveSettings validation', () => {
  it.each([
    ['bad phone', { phone: 'abc' }],
    ['bad whatsapp', { whatsapp: '123' }],
    ['bad email', { email: 'nope' }],
    ['javascript social', { instagram: 'javascript:alert(1)' }],
    ['non-http url', { facebook: 'ftp://x.com/a' }],
    ['spaces in handle', { tiktok: 'my name' }],
  ])('rejects %s', async (_n, extra) => {
    await expect(A.saveSettings(null, form({ name: 'x', ...both, ...extra }))).rejects.toThrow()
    expect(await db.select().from(s.siteSettings)).toHaveLength(0)
  })

  it('requires at least one payment method', async () => {
    await expect(A.saveSettings(null, form({ name: 'x' }))).rejects.toThrow('طريقة دفع')
    await A.saveSettings(null, form({ name: 'x', transferEnabled: 'true' }))
    expect((await getSiteConfig()).payments).toEqual({ cashOnDelivery: false, manualTransfer: true, wallet: false })
  })
})

describe('proof retention setting', () => {
  it('is off by default, saves a valid period, clears when unchecked, and rejects out-of-range values', async () => {
    await A.saveSettings(null, form({ name: 'x', ...both }))
    expect((await db.select().from(s.siteSettings))[0].proofRetentionDays).toBeNull()
    await A.saveSettings(null, form({ name: 'x', ...both, proofRetentionEnabled: 'true', proofRetentionDays: '45' }))
    expect((await db.select().from(s.siteSettings))[0].proofRetentionDays).toBe(45)
    for (const bad of ['6', '366', '', 'abc', '10.5']) {
      await expect(A.saveSettings(null, form({ name: 'x', ...both, proofRetentionEnabled: 'true', proofRetentionDays: bad }))).rejects.toThrow('7 إلى 365')
    }
    expect((await db.select().from(s.siteSettings))[0].proofRetentionDays).toBe(45)
    await A.saveSettings(null, form({ name: 'x', ...both, proofRetentionDays: '45' }))
    expect((await db.select().from(s.siteSettings))[0].proofRetentionDays).toBeNull()
  })
})

describe('login bot number setting', () => {
  it('saves digits only, tolerates formatting, clears when empty and rejects garbage', async () => {
    await A.saveSettings(null, form({ name: 'x', ...both, loginBotNumber: '+967 777-000 000' }))
    expect((await db.select().from(s.siteSettings))[0].loginBotNumber).toBe('967777000000')
    for (const bad of ['abc', '12345', '9677770000001234567']) {
      await expect(A.saveSettings(null, form({ name: 'x', ...both, loginBotNumber: bad }))).rejects.toThrow('رقم بوت الدخول')
    }
    expect((await db.select().from(s.siteSettings))[0].loginBotNumber).toBe('967777000000')
    await A.saveSettings(null, form({ name: 'x', ...both }))
    expect((await db.select().from(s.siteSettings))[0].loginBotNumber).toBeNull()
  })
})

