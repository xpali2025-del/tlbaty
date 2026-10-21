import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { pk, sanityId, store } from './common'
import { authEventType, customerStatus, otpPurpose } from './enums'

const at = (name: string) => timestamp(name, { withTimezone: true })

export const customers = store.table('customers', {
  id: pk(),
  sanityId: sanityId(),
  /** Legacy public customer identifier (Sanity `customerId`). */
  publicId: text('public_id').notNull().unique(),
  /** Normalized phone number; phone + OTP is the login identity. */
  phone: text('phone').notNull().unique(),
  verified: boolean('verified').notNull().default(true),
  status: customerStatus('status').notNull().default('active'),
  createdAt: at('created_at').notNull().defaultNow(),
  lastLoginAt: at('last_login_at'),
})

export const customerPhoneHistory = store.table('customer_phone_history', {
  id: pk(),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  fromPhone: text('from_phone').notNull(),
  toPhone: text('to_phone').notNull(),
  changedAt: at('changed_at').notNull().defaultNow(),
}, (t) => [index('customer_phone_history_customer_idx').on(t.customerId, t.changedAt.desc())])

export const customerSessions = store.table('customer_sessions', {
  id: pk(),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  /** Only the hash of the session token is stored. */
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: at('created_at').notNull().defaultNow(),
  expiresAt: at('expires_at').notNull(),
  lastActivityAt: at('last_activity_at').notNull().defaultNow(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  revoked: boolean('revoked').notNull().default(false),
}, (t) => [
  index('customer_sessions_customer_idx').on(t.customerId),
  index('customer_sessions_active_expiry_idx').on(t.expiresAt).where(sql`not ${t.revoked}`),
  check('customer_sessions_expiry_order', sql`${t.expiresAt} > ${t.createdAt}`),
])

export const otpCodes = store.table('otp_codes', {
  id: pk(),
  phone: text('phone').notNull(),
  codeHash: text('code_hash').notNull(),
  salt: text('salt').notNull(),
  purpose: otpPurpose('purpose').notNull(),
  expiresAt: at('expires_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
  verified: boolean('verified').notNull().default(false),
  consumed: boolean('consumed').notNull().default(false),
  provider: text('provider'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: at('created_at').notNull().defaultNow(),
}, (t) => [
  index('otp_codes_phone_purpose_idx').on(t.phone, t.purpose, t.createdAt.desc()),
  index('otp_codes_expiry_idx').on(t.expiresAt),
  check('otp_codes_attempts_nonneg', sql`${t.attempts} >= 0`),
])

export const authEvents = store.table('auth_events', {
  id: pk(),
  event: authEventType('event').notNull(),
  phone: text('phone'),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  ip: text('ip'),
  userAgent: text('user_agent'),
  detail: text('detail'),
  at: at('at').notNull().defaultNow(),
}, (t) => [
  index('auth_events_customer_idx').on(t.customerId, t.at.desc()),
  index('auth_events_phone_idx').on(t.phone, t.at.desc()),
  index('auth_events_event_idx').on(t.event, t.at.desc()),
])

