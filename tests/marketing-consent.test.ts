import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'

const db = drizzle(new PGlite())
const session = vi.hoisted(() => ({ customerId: null as string | null }))
vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('@/lib/otp/session', () => ({
  resolveSession: async () => (session.customerId ? { customer: { id: session.customerId }, sessionId: 's' } : null),
}))
const route = await import('@/app/api/account/marketing/route')

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://shop.test/api/account/marketing', { method: 'POST', headers: { 'content-type': 'application/json', host: 'shop.test', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
const row = async (id: string) => (await db.select().from(s.customers).where(eq(s.customers.id, id)))[0]

let a: string
let b: string
beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
  a = (await db.insert(s.customers).values({ publicId: 'MK_A', phone: '967770000201' }).returning())[0].id
  b = (await db.insert(s.customers).values({ publicId: 'MK_B', phone: '967770000202' }).returning())[0].id
})

describe('marketing consent', () => {
  it('is off by default and never pre-ticked', async () => {
    expect(await row(a)).toMatchObject({ marketingOptIn: false, marketingOptInUpdatedAt: null })
  })

  it('requires a session', async () => {
    session.customerId = null
    expect((await route.POST(post({ optIn: true }))).status).toBe(401)
    expect((await row(a)).marketingOptIn).toBe(false)
  })

  it('lets the signed-in customer opt in and out, recording when, and only for themselves', async () => {
    session.customerId = a
    expect((await route.POST(post({ optIn: true }))).status).toBe(200)
    const on = await row(a)
    expect(on.marketingOptIn).toBe(true)
    expect(on.marketingOptInUpdatedAt).not.toBeNull()
    expect((await row(b)).marketingOptIn).toBe(false)

    expect((await route.POST(post({ optIn: false }))).status).toBe(200)
    expect((await row(a)).marketingOptIn).toBe(false)
  })

  it('rejects non-boolean values, bad JSON and cross-site origins without changing anything', async () => {
    session.customerId = a
    for (const bad of ['true', 1, null, undefined, 'yes']) expect((await route.POST(post({ optIn: bad }))).status).toBe(400)
    expect((await route.POST(post('{nope'))).status).toBe(400)
    expect((await route.POST(post({ optIn: true }, { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await row(a)).marketingOptIn).toBe(false)
  })
})
