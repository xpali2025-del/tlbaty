import { pgSchema, timestamp, uuid } from 'drizzle-orm/pg-core'

// All store tables live in the `store` Postgres schema, separate from Supabase's own `public` schema.
export const store = pgSchema('store')

export const pk = () => uuid('id').primaryKey().defaultRandom()
export const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
