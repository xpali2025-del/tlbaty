import { pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'

// All migrated-from-Sanity tables live in the `store` Postgres schema so they can
// coexist with the interim `public` tables until the app is switched over.
export const store = pgSchema('store')

export const pk = () => uuid('id').primaryKey().defaultRandom()
/** Original Sanity `_id`, kept so the data migration is idempotent and references can be remapped. */
export const sanityId = () => text('sanity_id').unique()
export const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
