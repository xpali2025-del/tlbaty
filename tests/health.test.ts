import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
const db = drizzle(new PGlite())
const dbMock = vi.hoisted(() => ({ broken: false }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', () => ({
  db: new Proxy({}, { get: (_, p) => (dbMock.broken ? () => Promise.reject(new Error('down')) : Reflect.get(db, p)) }),
}))

const route = await import('@/app/api/health/route')
const get = (auth?: string) => route.GET(new Request('http://x/api/health', { headers: auth ? { authorization: auth } : {} }))

afterEach(() => {
  dbMock.broken = false
  delete process.env.CRON_SECRET
  delete process.env.WHATSAPP_WORKER_URL
})

describe('GET /api/health', () => {
  it('reports ok with status only for anonymous callers', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ status: 'ok' })
  })
  it('returns 503 when the database does not answer', async () => {
    dbMock.broken = true
    const res = await get()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ status: 'down' })
  })
  it('gives details only with the secret', async () => {
    process.env.CRON_SECRET = 's3cret'
    expect(await (await get('Bearer wrong')).json()).toEqual({ status: 'ok' })
    const body = await (await get('Bearer s3cret')).json()
    expect(body).toMatchObject({ status: 'ok', db: 'up', worker: 'unconfigured', storage: { images: expect.any(Boolean), proofs: expect.any(Boolean) } })
    expect(typeof body.dbLatencyMs).toBe('number')
  })
  it('is degraded (still 200) when the WhatsApp worker is unreachable', async () => {
    process.env.WHATSAPP_WORKER_URL = 'http://127.0.0.1:1'
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'degraded' })
  })
})
