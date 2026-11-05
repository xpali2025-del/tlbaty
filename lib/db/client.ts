import 'server-only'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Pool } from 'pg'
import postgres from 'postgres'
import { getServerEnv } from '@/lib/env'
import * as schema from './store'

type Db = PostgresJsDatabase<typeof schema>
const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres>; pool?: Pool; db?: Db }

/**
 * مكتبة الاتصال بقاعدة البيانات. الافتراضي postgres.js. `DB_DRIVER=pg` يختار node-postgres:
 * postgres.js مع prepare:false (لازم للـ transaction pooler، منفذ 6543) يرسل كل استعلام بمعاملات في ذهابين وإيابين
 * (وصف الأنواع ثم التنفيذ)، أما node-postgres فيرسل التحليل والربط والتنفيذ في رحلة واحدة (جملة غير مسمّاة تقبلها الـ poolers).
 * القياس في docs/admin-save-benchmarks.md. الرجوع: احذف المتغير.
 */
export function dbDriver(): 'pg' | 'postgres' {
  return process.env.DB_DRIVER === 'pg' ? 'pg' : 'postgres'
}

/** نفس سلوك postgres.js: التشفير يُفعَّل إن طلبه الرابط (sslmode غير disable)، بلا تحقق من الشهادة (شهادة الـ pooler غير موثوقة من النظام). */
export function pgSsl(connectionString: string): false | { rejectUnauthorized: false } {
  try {
    const mode = new URL(connectionString).searchParams.get('sslmode')
    return mode && mode !== 'disable' ? { rejectUnauthorized: false } : false
  } catch {
    return false
  }
}

/** الرابط بلا sslmode: مكتبة pg تفسّر sslmode=require كـ verify-full وتفشل مع شهادة الـ pooler، والتشفير يُضبط عندنا صراحةً. */
function withoutSslMode(connectionString: string): string {
  try {
    const url = new URL(connectionString)
    url.searchParams.delete('sslmode')
    return url.toString()
  } catch {
    return connectionString
  }
}

/** DB_LOG=1: يطبع كل استعلام (للتشخيص وعدّ الذهاب والإياب). */
const logger = process.env.DB_LOG === '1' ? { logQuery: (query: string) => console.log('[sql]', Date.now() % 100000, query.replace(/\s+/g, ' ').slice(0, 150)) } : undefined

function getDb(): Db {
  if (!globalForDb.db) {
    // Each serverless instance keeps a small pool: many instances x a large pool exhausts the database.
    const max = Math.min(20, Math.max(1, Number(process.env.DB_POOL_MAX) || 5))
    const url = getServerEnv().DATABASE_URL
    if (dbDriver() === 'pg') {
      const pool = new Pool({
        connectionString: withoutSslMode(url),
        ssl: pgSsl(url),
        max,
        idleTimeoutMillis: 20_000,
        connectionTimeoutMillis: 10_000,
        // إرسال الاستعلامات المتزامنة على الاتصال نفسه معاً (كما يفعل postgres.js): قراءات القفل داخل معاملة الحفظ تمر في رحلة واحدة.
        // بدونه تُنفَّذ بالتتابع وتنبّه pg إلى أن ذلك سيُزال في الإصدار 9. تجريبي في pg 8.23؛ DB_PG_PIPELINE=0 يعطّله.
        ...(process.env.DB_PG_PIPELINE === '0' ? {} : ({ pipeline: true } as object)),
      })
      // خطأ على اتصال خامل (قطعه الـ pooler) لا يجوز أن يُسقط العملية؛ يُستبدل الاتصال عند الحاجة.
      pool.on('error', (error) => console.error('db pool error:', error.message))
      globalForDb.pool = pool
      globalForDb.db = drizzlePg(pool, { schema, logger }) as unknown as Db
    } else {
      // prepare:false is required for Supabase's transaction-mode pooler (port 6543).
      const client = postgres(url, { prepare: false, max, idle_timeout: 20, connect_timeout: 10 })
      globalForDb.pg = client
      globalForDb.db = drizzle(client, { schema, logger })
    }
  }
  return globalForDb.db
}

// Created on first use so builds and imports don't require DATABASE_URL.
export const db = new Proxy({} as Db, {
  get: (_, prop) => Reflect.get(getDb(), prop),
})
