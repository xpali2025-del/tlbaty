import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { pk, store } from './common'
import { authEventType, customerStatus, otpPurpose } from './enums'

const at = (name: string) => timestamp(name, { withTimezone: true })

export const customers = store.table('customers', {
  id: pk(),
  /** Legacy public customer identifier ( `customerId`). */
  publicId: text('public_id').notNull().unique(),
  /** International digits without + (e.g. 967781234567); phone + OTP is the login identity. */
  phone: text('phone').notNull().unique(),
  verified: boolean('verified').notNull().default(true),
  status: customerStatus('status').notNull().default('active'),
  /** Customer agreed to receive promotional messages (cart/wishlist reminders, offers). Off by default; changed only by the customer. */
  marketingOptIn: boolean('marketing_opt_in').notNull().default(false),
  marketingOptInUpdatedAt: at('marketing_opt_in_updated_at'),
  /** الاسم الثلاثي بعد توحيده؛ null للعملاء القدامى حتى يكملوا ملفهم. */
  fullName: text('full_name'),
  /** اختياري بحروف صغيرة؛ غير فريد ولا يُستعمل للدخول. */
  email: text('email'),
  /** وضع PUK فقط: `scrypt$1$N$r$p$salt$hash`. */
  passwordHash: text('password_hash'),
  passwordSetAt: at('password_set_at'),
  profileCompletedAt: at('profile_completed_at'),
  /** بداية مهلة الحذف؛ الدخول خلالها يلغيه. */
  deletionRequestedAt: at('deletion_requested_at'),
  /** صف الحساب المحذوف (شاهد) بعد التنفيذ؛ لا يُحذف الصف لأن سجل المحفظة لا يُحذف. */
  deletedAt: at('deleted_at'),
  createdAt: at('created_at').notNull().defaultNow(),
  lastLoginAt: at('last_login_at'),
}, (t) => [
  check('customers_full_name_len', sql`${t.fullName} is null or char_length(${t.fullName}) between 5 and 80`),
  check('customers_email_len', sql`${t.email} is null or char_length(${t.email}) <= 254`),
])

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
  index('auth_events_ip_idx').on(t.ip, t.at.desc()).where(sql`${t.ip} is not null`),
])


/**
 * Click-to-chat login. The browser starts a challenge (short token shown in a wa.me link);
 * the WhatsApp worker claims it with the sender's verified number and replies with an OTP;
 * the same browser (bound by a secret cookie, stored hashed) then verifies the code.
 */
export const loginChallenges = store.table('login_challenges', {
  id: pk(),
  token: text('token').notNull().unique(),
  browserSecretHash: text('browser_secret_hash').notNull().unique(),
  phone: text('phone'),
  claimedAt: at('claimed_at'),
  consumedAt: at('consumed_at'),
  expiresAt: at('expires_at').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: at('created_at').notNull().defaultNow(),
}, (t) => [
  index('login_challenges_expiry_idx').on(t.expiresAt),
  index('login_challenges_ip_idx').on(t.ip, t.createdAt.desc()).where(sql`${t.ip} is not null`),
  check('login_challenges_claim_consistent', sql`(${t.claimedAt} is null) = (${t.phone} is null)`),
])

/**
 * Cart, wishlist, saved addresses and recently viewed items of a signed-in customer, one JSON row each,
 * so they follow the customer to any device. Written once (debounced) per shopping session, never per click.
 */
export const customerData = store.table('customer_data', {
  customerId: uuid('customer_id').primaryKey().references(() => customers.id, { onDelete: 'cascade' }),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  updatedAt: at('updated_at').notNull().defaultNow(),
})

/** طلبات PUK (العميل يطلب والمدير يعالج الطابور). */
export const pukRequests = store.table('puk_requests', {
  id: pk(),
  phone: text('phone').notNull(),
  /** يُعطى في الطلبات الأولى. */
  fullName: text('full_name'),
  purpose: text('purpose').notNull(),
  status: text('status').notNull().default('pending'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: at('created_at').notNull().defaultNow(),
  handledAt: at('handled_at'),
  handledBy: text('handled_by'),
}, (t) => [
  index('puk_requests_pending_idx').on(t.createdAt.desc()).where(sql`${t.status} = 'pending'`),
  index('puk_requests_phone_idx').on(t.phone, t.createdAt.desc()),
  check('puk_requests_purpose_valid', sql`${t.purpose} in ('first_setup', 'recovery')`),
  check('puk_requests_status_valid', sql`${t.status} in ('pending', 'issued', 'rejected', 'expired')`),
])

/** رموز PUK: يُخزَّن تجزئة مفتاحية فقط ويراها المدير مرة واحدة. */
export const pukCodes = store.table('puk_codes', {
  id: pk(),
  phone: text('phone').notNull(),
  purpose: text('purpose').notNull(),
  /** HMAC-SHA256(PUK_PEPPER, phone || ':' || code). */
  codeHash: text('code_hash').notNull(),
  requestId: uuid('request_id').references(() => pukRequests.id, { onDelete: 'set null' }),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: at('expires_at').notNull(),
  usedAt: at('used_at'),
  revokedAt: at('revoked_at'),
  /** تجزئة رمز الإعداد المؤقت بعد نجاح PUK في أول إعداد (المرحلة 4). */
  setupTokenHash: text('setup_token_hash'),
  setupTokenExpiresAt: at('setup_token_expires_at'),
  createdBy: text('created_by').notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
}, (t) => [
  // رمز حي واحد على الأكثر لكل هاتف: إنشاء جديد يُبطل القديم في المعاملة نفسها
  uniqueIndex('puk_codes_one_live_idx').on(t.phone).where(sql`${t.usedAt} is null and ${t.revokedAt} is null`),
  check('puk_codes_purpose_valid', sql`${t.purpose} in ('first_setup', 'recovery')`),
  check('puk_codes_attempts_nonneg', sql`${t.attempts} >= 0`),
])
