import 'server-only'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { getServerEnv } from '@/lib/env'
import * as schema from './schema'

const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> }

// prepare:false is required for Supabase's transaction-mode pooler (port 6543).
const client =
  globalForDb.pg ?? postgres(getServerEnv().DATABASE_URL, { prepare: false, max: 10 })

if (process.env.NODE_ENV !== 'production') globalForDb.pg = client

export const db = drizzle(client, { schema })
