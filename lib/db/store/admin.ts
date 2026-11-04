import { index, uuid, text, timestamp } from 'drizzle-orm/pg-core'
import { store } from './common'

/**
 * Admin saves are idempotent: the browser sends a request id with every save and keeps it across retries,
 * so a retry after a lost response returns the first result instead of creating a duplicate.
 * Written in the same transaction as the save; rows older than a week are purged by the daily cron.
 */
export const saveRequests = store.table('save_requests', {
  requestId: uuid('request_id').primaryKey(),
  screen: text('screen').notNull(),
  entityId: uuid('entity_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('save_requests_created_idx').on(t.createdAt)])
