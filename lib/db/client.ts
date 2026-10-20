import 'server-only'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { getServerEnv } from '@/lib/env'
import * as schema from './schema'

type Db = PostgresJsDatabase<typeof schema>
const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres>; db?: Db }

function getDb(): Db {
  if (!globalForDb.db) {
    // prepare:false is required for Supabase's transaction-mode pooler (port 6543).
    const client = postgres(getServerEnv().DATABASE_URL, { prepare: false, max: 10 })
    globalForDb.pg = client
    globalForDb.db = drizzle(client, { schema })
  }
  return globalForDb.db
}

// Created on first use so builds and imports don't require DATABASE_URL.
export const db = new Proxy({} as Db, {
  get: (_, prop) => Reflect.get(getDb(), prop),
})
