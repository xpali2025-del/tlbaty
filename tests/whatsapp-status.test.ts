import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'

const db = drizzle(new PGlite())
vi.mock('@/lib/db/client', () => ({ db }))
const { checkWorker, getWhatsappStatus } = await import('@/lib/whatsapp-status')

const reply = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch

beforeAll(async () => { await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') }) })

describe('checkWorker', () => {
  it('reports unconfigured, ready, not ready and unreachable', async () => {
    delete process.env.WHATSAPP_WORKER_URL
    expect(await checkWorker(reply({ ready: true }))).toBe('unconfigured')
    process.env.WHATSAPP_WORKER_URL = 'https://wa.example.com/'
    expect(await checkWorker(reply({ ok: true, ready: true }))).toBe('ready')
    expect(await checkWorker(reply({ ok: true, ready: false }))).toBe('not_ready')
    expect(await checkWorker(reply({}, false))).toBe('unreachable')
    expect(await checkWorker((async () => { throw new Error('down') }) as unknown as typeof fetch)).toBe('unreachable')
  })

  it('asks the /health endpoint of the worker', async () => {
    process.env.WHATSAPP_WORKER_URL = 'https://wa.example.com/'
    const f = vi.fn(reply({ ready: true }))
    await checkWorker(f)
    expect(f).toHaveBeenCalledWith('https://wa.example.com/health', expect.objectContaining({ cache: 'no-store' }))
  })
})

describe('getWhatsappStatus', () => {
  it('shows the configured number, its source and recent bot logins', async () => {
    delete process.env.WHATSAPP_WORKER_URL
    delete process.env.WHATSAPP_BOT_NUMBER
    expect(await getWhatsappStatus()).toMatchObject({ botNumber: null, botNumberSource: 'none', worker: 'unconfigured', lastLoginAt: null, logins24h: 0 })

    await db.insert(s.siteSettings).values({ id: 1, loginBotNumber: '967700000009' })
    const day = 86_400_000
    await db.insert(s.authEvents).values([
      { event: 'otp_sent', phone: '967771', detail: 'whatsapp-reply', at: new Date(Date.now() - 1000) },
      { event: 'otp_sent', phone: '967772', detail: 'whatsapp-reply', at: new Date(Date.now() - 3 * day) },
      { event: 'otp_sent', phone: '967773', detail: 'something-else', at: new Date() },
    ])
    const st = await getWhatsappStatus()
    expect(st).toMatchObject({ botNumber: '967700000009', botNumberSource: 'settings', logins24h: 1 })
    expect(st.lastLoginAt).not.toBeNull()
  })
})
