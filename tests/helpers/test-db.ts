import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import { migrate as migratePgDriver } from 'drizzle-orm/node-postgres/migrator'
import { drizzle as drizzlePostgresJs } from 'drizzle-orm/postgres-js'
import { migrate as migratePostgresJs } from 'drizzle-orm/postgres-js/migrator'
import { Pool } from 'pg'
import postgres from 'postgres'

// قاعدة اختبار للاختبارات التي تمرّ على الإجراءات والاستعلامات الحقيقية.
// الافتراضي PGlite (سريع، بلا خادم). لفحص مكتبات الاتصال على Postgres حقيقي (المرحلة 6):
//   TEST_DB_DRIVER=pg|postgres  TEST_DATABASE_URL=postgresql://USER:PASS@HOST:5432/postgres  pnpm vitest run tests/manage-actions.test.ts
// تُنشأ قاعدة مؤقتة لكل ملف اختبار وتُحذف في النهاية.

type TestDb = ReturnType<typeof drizzlePglite>

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

type Options = { logger?: { logQuery: (query: string, params: unknown[]) => void } }

export async function openTestDb(options: Options = {}) {
  const kind = process.env.TEST_DB_DRIVER
  if (!kind || kind === 'pglite') {
    const db = drizzlePglite(new PGlite(), options)
    return { db, migrate: () => migratePglite(db, { migrationsFolder }), close: async () => {}, driver: 'pglite' as const }
  }

  const adminUrl = process.env.TEST_DATABASE_URL
  if (!adminUrl) throw new Error('TEST_DATABASE_URL مطلوب مع TEST_DB_DRIVER')
  const name = `tajline_t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  const admin = new Pool({ connectionString: adminUrl, max: 1 })
  await admin.query(`create database ${name}`)
  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  const dropAfter = async () => {
    await admin.query(`drop database if exists ${name} with (force)`).catch(() => {})
    await admin.end().catch(() => {})
  }

  if (kind === 'pg') {
    // pipeline كما في lib/db/client.ts عند DB_DRIVER=pg
    const pool = new Pool({ connectionString: url.toString(), max: 5, ...({ pipeline: true } as object) })
    const db = drizzlePg(pool, options) as unknown as TestDb
    return { db, migrate: () => migratePgDriver(db as never, { migrationsFolder }), close: async () => { await pool.end(); await dropAfter() }, driver: 'pg' as const }
  }
  if (kind === 'postgres') {
    const client = postgres(url.toString(), { prepare: false, max: 5 })
    const db = drizzlePostgresJs(client, options) as unknown as TestDb
    return { db, migrate: () => migratePostgresJs(db as never, { migrationsFolder }), close: async () => { await client.end(); await dropAfter() }, driver: 'postgres' as const }
  }
  throw new Error(`TEST_DB_DRIVER غير معروف: ${kind}`)
}

/** صفوف نتيجة db.execute: PGlite وnode-postgres يعيدانها في `rows`، وpostgres.js يعيدها مصفوفةً مباشرة. */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[]
}
