import { sql } from 'drizzle-orm'
import {
  boolean, check, date, index, integer, numeric, primaryKey, smallint, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import { categories } from './catalog'
import { pk, store, timestamps } from './common'
import { customers } from './customers'
import { discountType, linkPlacement, manageUserRole, shippingIcon } from './enums'

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' })

export const coupons = store.table('coupons', {
  id: pk(),
  code: text('code').notNull(),
  discount: money('discount').notNull(),
  type: discountType('type').notNull().default('fixed'),
  minOrder: money('min_order').notNull().default(0),
  description: text('description').notNull(),
  /** Personal coupon: only this customer can use it (and it never appears in the public coupon list). */
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  /** null = unlimited. A reminder coupon is single-use (1). */
  maxUses: integer('max_uses'),
  usedCount: integer('used_count').notNull().default(0),
  ...timestamps(),
}, (t) => [
  check('coupons_uses_valid', sql`${t.usedCount} >= 0 and (${t.maxUses} is null or (${t.maxUses} >= 1 and ${t.usedCount} <= ${t.maxUses}))`),
  uniqueIndex('coupons_code_lower_idx').on(sql`lower(${t.code})`),
  check('coupons_discount_nonneg', sql`${t.discount} >= 0`),
  check('coupons_percent_max', sql`${t.type} <> 'percent' or ${t.discount} <= 100`),
  check('coupons_min_order_nonneg', sql`${t.minOrder} >= 0`),
])

export const ads = store.table('ads', {
  id: pk(),
  title: text('title').notNull(),
  imageKey: text('image_key').notNull(),
  href: text('href'),
  active: boolean('active').notNull().default(true),
  frequency: integer('frequency').notNull().default(6),
  sortOrder: integer('sort_order').notNull().default(0),
  /** 'image' (الافتراضي) أو 'video': الفيديو يعرض image_key كغلاف (poster) قبل التشغيل وعند تعذّره. */
  kind: text('kind').notNull().default('image'),
  /** مفتاح ملف MP4 في R2 (ads/<uuid>.mp4)؛ مطلوب لنوع video فقط. */
  videoKey: text('video_key'),
  /** أماكن العرض (انظر lib/ads.ts)؛ الفارغ = كل الأماكن (سلوك الإعلانات القديمة). */
  placements: text('placements').array().notNull().default(sql`'{}'::text[]`),
  /** نافذة العرض بالتاريخ (توقيت عدن، شاملة الطرفين)؛ null = مفتوحة. */
  startsOn: date('starts_on'),
  endsOn: date('ends_on'),
  ...timestamps(),
}, (t) => [
  index('ads_active_sort_idx').on(t.sortOrder).where(sql`${t.active}`),
  check('ads_frequency_min', sql`${t.frequency} >= 1`),
  check('ads_kind_valid', sql`${t.kind} in ('image', 'video')`),
  check('ads_video_needs_key', sql`${t.kind} <> 'video' or ${t.videoKey} is not null`),
  check('ads_placements_valid', sql`${t.placements} <@ array['home_new','home_bestsellers','home_offers','home_categories','grid','category']::text[]`),
  check('ads_dates_order', sql`${t.startsOn} is null or ${t.endsOn} is null or ${t.startsOn} <= ${t.endsOn}`),
])

export const adCategories = store.table('ad_categories', {
  adId: uuid('ad_id').notNull().references(() => ads.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.adId, t.categoryId] }), index('ad_categories_category_idx').on(t.categoryId)])

export const slides = store.table('slides', {
  id: pk(),
  title: text('title').notNull(),
  subtitle: text('subtitle'),
  cta: text('cta'),
  href: text('href'),
  imageKey: text('image_key').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps(),
}, (t) => [index('slides_sort_idx').on(t.sortOrder)])

/** Site-level testimonials (the `review` type is not tied to a product). */
export const reviews = store.table('reviews', {
  id: pk(),
  name: text('name').notNull(),
  rating: smallint('rating').notNull(),
  comment: text('comment').notNull(),
  reviewDate: date('review_date').notNull(),
  avatarKey: text('avatar_key'),
  ...timestamps(),
}, (t) => [
  index('reviews_date_idx').on(t.reviewDate.desc()),
  check('reviews_rating_range', sql`${t.rating} between 1 and 5`),
])

export const paymentAccounts = store.table('payment_accounts', {
  id: pk(),
  providerName: text('provider_name').notNull(),
  accountDisplayName: text('account_display_name'),
  accountHolderName: text('account_holder_name').notNull(),
  accountNumber: text('account_number').notNull(),
  imageKey: text('image_key'),
  instructions: text('instructions'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps(),
}, (t) => [
  index('payment_accounts_active_sort_idx').on(t.sortOrder).where(sql`${t.isActive}`),
  check('payment_accounts_sort_range', sql`${t.sortOrder} between 0 and 9999`),
])

export const manageUsers = store.table('manage_users', {
  id: pk(),
  username: text('username').notNull(),
  name: text('name'),
  passwordHash: text('password_hash').notNull(),
  role: manageUserRole('role').notNull().default('editor'),
  /** Screens this user may open and change (see lib/permissions.ts). Empty = no access. */
  permissions: text('permissions').array().notNull().default(sql`'{}'::text[]`),
  active: boolean('active').notNull().default(true),
  ...timestamps(),
}, (t) => [uniqueIndex('manage_users_username_lower_idx').on(sql`lower(${t.username})`)])

/** Singleton row (id = 1) for the `siteSettings` document. */
export const siteSettings = store.table('site_settings', {
  id: smallint('id').primaryKey().default(1),
  name: text('name'),
  tagline: text('tagline'),
  logoKey: text('logo_key'),
  description: text('description'),
  defaultCurrency: text('default_currency').notNull().default('YER'),
  phone: text('phone'),
  whatsapp: text('whatsapp'),
  email: text('email'),
  address: text('address'),
  workingHours: text('working_hours'),
  instagram: text('instagram'),
  facebook: text('facebook'),
  tiktok: text('tiktok'),
  x: text('x'),
  youtube: text('youtube'),
  snapchat: text('snapchat'),
  telegram: text('telegram'),
  nameEn: text('name_en'),
  secondaryPhone: text('secondary_phone'),
  codEnabled: boolean('cod_enabled').notNull().default(true),
  transferEnabled: boolean('transfer_enabled').notNull().default(true),
  walletEnabled: boolean('wallet_enabled').notNull().default(true),
  /** Days after an order is delivered/cancelled/returned before its payment-proof image is deleted; null = keep forever. */
  proofRetentionDays: integer('proof_retention_days'),
  /** Number of the WhatsApp login bot (international digits). Null = use WHATSAPP_BOT_NUMBER from the environment. */
  loginBotNumber: text('login_bot_number'),
  /** Country calling codes customers may log in with (subset of SUPPORTED_COUNTRIES); Yemen only by default. */
  loginCountries: text('login_countries').array().notNull().default(sql`'{967}'::text[]`),
  /** How login/change-phone codes are delivered: whatsapp, sms, or whatsapp with sms fallback. */
  otpChannel: text('otp_channel').notNull().default('whatsapp'),
  copyright: text('copyright'),
  updatedAt: timestamps().updatedAt,
}, (t) => [
  check('site_settings_otp_channel_valid', sql`${t.otpChannel} in ('whatsapp', 'sms', 'whatsapp_sms')`),
  check('site_settings_singleton', sql`${t.id} = 1`),
  check('site_settings_login_bot_number_format', sql`${t.loginBotNumber} is null or ${t.loginBotNumber} ~ '^[0-9]{8,15}$'`),
  check('site_settings_login_countries_nonempty', sql`cardinality(${t.loginCountries}) >= 1`),
  check('site_settings_proof_retention_range', sql`${t.proofRetentionDays} is null or ${t.proofRetentionDays} between 7 and 365`),
])

export const currencies = store.table('currencies', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  symbol: text('symbol').notNull(),
  rate: numeric('rate', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  /** When this currency's rate (or definition) last changed; the panel warns when rates get stale. */
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check('currencies_rate_positive', sql`${t.rate} > 0`)])

export const siteLinks = store.table('site_links', {
  id: pk(),
  placement: linkPlacement('placement').notNull(),
  label: text('label').notNull(),
  href: text('href').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [index('site_links_placement_sort_idx').on(t.placement, t.sortOrder)])

export const shippingZones = store.table('shipping_zones', {
  id: pk(),
  governorate: text('governorate'),
  isDefault: boolean('is_default').notNull().default(false),
  ...timestamps(),
}, (t) => [
  uniqueIndex('shipping_zones_governorate_idx').on(t.governorate).where(sql`${t.governorate} is not null`),
  uniqueIndex('shipping_zones_one_default_idx').on(t.isDefault).where(sql`${t.isDefault}`),
  check('shipping_zones_target', sql`${t.isDefault} or ${t.governorate} is not null`),
])

export const shippingMethods = store.table('shipping_methods', {
  id: pk(),
  zoneId: uuid('zone_id').notNull().references(() => shippingZones.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  price: money('price').notNull().default(0),
  icon: shippingIcon('icon').notNull().default('standard'),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [
  index('shipping_methods_zone_idx').on(t.zoneId, t.sortOrder),
  check('shipping_methods_price_nonneg', sql`${t.price} >= 0`),
])

/** Automatic reminder rule, one row per kind ('cart' | 'wishlist'). Disabled until the owner turns it on. */
export const reminderRules = store.table('reminder_rules', {
  kind: text('kind').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  /** Hours the cart/wishlist must stay untouched before a reminder is sent. */
  delayHours: integer('delay_hours').notNull(),
  /** Minimum days between two reminders of this kind to the same customer. */
  cooldownDays: integer('cooldown_days').notNull().default(7),
  title: text('title').notNull(),
  /** Placeholders: {product} {code} {discount} {days}. */
  body: text('body').notNull(),
  discountType: discountType('discount_type').notNull().default('percent'),
  /** 0 = no coupon is attached. */
  discountValue: money('discount_value').notNull().default(0),
  minOrder: money('min_order').notNull().default(0),
  couponValidDays: integer('coupon_valid_days').notNull().default(7),
  updatedAt: timestamps().updatedAt,
}, (t) => [
  check('reminder_rules_kind', sql`${t.kind} in ('cart','wishlist')`),
  check('reminder_rules_delay', sql`${t.delayHours} between 1 and 2160`),
  check('reminder_rules_cooldown', sql`${t.cooldownDays} between 1 and 90`),
  check('reminder_rules_discount', sql`${t.discountValue} >= 0 and (${t.discountType} <> 'percent' or ${t.discountValue} <= 100)`),
  check('reminder_rules_coupon_days', sql`${t.couponValidDays} between 1 and 90`),
])

/** What was sent to whom and when (cooldown source, and one reminder per customer/kind/day even if the job runs twice). */
export const reminderLog = store.table('reminder_log', {
  id: pk(),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  couponId: uuid('coupon_id').references(() => coupons.id, { onDelete: 'set null' }),
  sentOn: date('sent_on').notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('reminder_log_once_per_day_idx').on(t.customerId, t.kind, t.sentOn),
  index('reminder_log_lookup_idx').on(t.customerId, t.kind, t.sentAt.desc()),
])
