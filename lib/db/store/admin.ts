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

/**
 * Objects uploaded straight to R2 from the admin forms (signed URL) that no saved row references yet.
 * A row is written when the URL is signed and removed when a successful save claims the key, or when the
 * admin cancels the form. The daily cron deletes what is still here after a day (and was never referenced).
 */
export const pendingUploads = store.table('pending_uploads', {
  objectKey: text('object_key').primaryKey(),
  /** Panel username that asked for the URL: only that admin can discard or claim the key. */
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('pending_uploads_created_idx').on(t.createdAt)])
