import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { unwrapAll } from '@/lib/action-result'

// المرحلة 6: 50 حفظاً متوازياً على Postgres حقيقي عبر الاتصال الحقيقي (lib/db/client) بالمكتبة المختارة، بلا أخطاء ولا تعليق ولا تكرار.
// يعمل فقط حين يتوفر خادم Postgres:
//   TEST_DATABASE_URL=postgresql://USER:PASS@HOST:5432/postgres DB_DRIVER=pg|postgres pnpm vitest run tests/db-driver-concurrency.test.ts
// (بدون DB_DRIVER يُختبر الافتراضي postgres.js). يُنشأ لهذا الاختبار قاعدة مؤقتة وتُحذف.

const adminUrl = process.env.TEST_DATABASE_URL
const dbName = `tajline_c_${Date.now().toString(36)}`

vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('@/lib/manage-auth', () => ({
  assertManagePermission: async () => ({ username: 'tester', isOwner: true, permissions: [], role: 'owner' }),
  getManageUsername: () => 'odoo',
  getManageSessionUser: async () => 'tester',
}))
vi.mock('@/lib/storage/r2', () => ({ deleteImageObject: vi.fn(async () => {}) }))
vi.mock('ai', () => ({ generateText: vi.fn(async () => ({ text: 'x' })) }))

describe.skipIf(!adminUrl)('real connection under parallel saves', () => {
  let admin: Pool
  let A: ReturnType<typeof unwrapAll<typeof import('@/app/manage/actions')>>
  let categoryId: string
  let client: typeof import('@/lib/db/client')

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl, max: 1 })
    await admin.query(`create database ${dbName}`)
    const url = new URL(adminUrl!)
    url.pathname = `/${dbName}`
    const setup = new Pool({ connectionString: url.toString(), max: 1 })
    await migrate(drizzle(setup), { migrationsFolder: path.resolve(__dirname, '../drizzle') })
    const { rows } = await setup.query<{ id: string }>(`insert into store.categories (name, slug) values ('قسم', 'concurrency') returning id`)
    categoryId = rows[0].id
    await setup.end()
    process.env.DATABASE_URL = url.toString()
    client = await import('@/lib/db/client')
    A = unwrapAll(await import('@/app/manage/actions'))
  }, 60_000)

  afterAll(async () => {
    // اتصالات التطبيق تُغلق قبل حذف القاعدة (الحذف القسري يقطعها فتصل أخطاء قطع إلى مستمعين لا نملكهم)
    const globals = globalThis as unknown as { pool?: Pool; pg?: { end: () => Promise<void> } }
    await globals.pool?.end().catch(() => {})
    await globals.pg?.end().catch(() => {})
    await admin?.query(`drop database if exists ${dbName} with (force)`).catch(() => {})
    await admin?.end()
  })

  const form = (name: string, requestId: string) => {
    const f = new FormData()
    f.set('name', name)
    f.set('categoryId', categoryId)
    f.set('price', '10')
    f.set('slug', name)
    f.set('requestId', requestId)
    return f
  }

  it('uses the driver the environment selects', () => {
    expect(client.dbDriver()).toBe(process.env.DB_DRIVER === 'pg' ? 'pg' : 'postgres')
  })

  it('50 parallel creates all succeed with unique product numbers, and replaying them creates nothing', async () => {
    const ids = Array.from({ length: 50 }, () => crypto.randomUUID())
    const started = Date.now()
    const results = await Promise.all(ids.map((id, i) => A.saveProduct(null, form(`p-${i}`, id))))
    expect(results.every((r) => r.status === 'saved')).toBe(true)
    const numbers = results.map((r) => (r.status === 'saved' ? r.item.productId : null))
    expect(new Set(numbers).size).toBe(50)
    expect(Date.now() - started).toBeLessThan(30_000)

    const replays = await Promise.all(ids.map((id, i) => A.saveProduct(null, form(`p-${i}`, id))))
    expect(replays.every((r) => r.status === 'saved' && r.replayed)).toBe(true)
    const check = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
    const { rows } = await check.query<{ n: string }>(`select count(*) n from store.products where slug like 'p-%'`)
    await check.end()
    expect(Number(rows[0].n)).toBe(50)
  }, 60_000)

  it('parallel edits of one product: every request either saves or reports a conflict, none hangs or errors', async () => {
    const created = await A.saveProduct(null, form('shared', crypto.randomUUID()))
    if (created.status !== 'saved') throw new Error('setup failed')
    const id = created.item._id
    const edits = await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        const f = form('shared', crypto.randomUUID())
        f.set('price', String(20 + i))
        f.set('expectedVersion', String(created.item.version))
        return A.saveProduct(id, f)
      }),
    )
    const saved = edits.filter((r) => r.status === 'saved').length
    const conflicts = edits.filter((r) => r.status === 'conflict').length
    expect(saved).toBe(1) // all 20 saw the same version: exactly one wins, the rest are told it changed
    expect(conflicts).toBe(19)
  }, 60_000)
})
