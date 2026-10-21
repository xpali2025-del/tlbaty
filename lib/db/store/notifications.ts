import { sql } from 'drizzle-orm'
import { check, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { pk, store, timestamps } from './common'
import { customers } from './customers'
import { notificationPriority, notificationStatus } from './enums'

export const notifications = store.table('notifications', {
  id: pk(),
  title: text('title').notNull(),
  body: text('body'),
  imageKey: text('image_key'),
  link: text('link'),
  status: notificationStatus('status').notNull().default('draft'),
  priority: notificationPriority('priority').notNull().default('normal'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdBy: text('created_by'),
  ...timestamps(),
}, (t) => [
  index('notifications_published_idx').on(t.publishedAt.desc()).where(sql`${t.status} = 'published'`),
  index('notifications_status_idx').on(t.status, t.createdAt.desc()),
])

/**
 * Read tracking. The legacy app kept read ids in the browser's localStorage, so a
 * read belongs to either a signed-in customer or an anonymous device id (exactly one).
 */
export const notificationReads = store.table('notification_reads', {
  id: pk(),
  notificationId: uuid('notification_id').notNull().references(() => notifications.id, { onDelete: 'cascade' }),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'cascade' }),
  deviceId: text('device_id'),
  readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('notification_reads_customer_idx').on(t.notificationId, t.customerId).where(sql`${t.customerId} is not null`),
  uniqueIndex('notification_reads_device_idx').on(t.notificationId, t.deviceId).where(sql`${t.deviceId} is not null`),
  index('notification_reads_customer_lookup_idx').on(t.customerId).where(sql`${t.customerId} is not null`),
  check('notification_reads_one_reader', sql`num_nonnulls(${t.customerId}, ${t.deviceId}) = 1`),
])
