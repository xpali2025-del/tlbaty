import { sql } from 'drizzle-orm'
import {
  boolean, check, date, index, integer, numeric, primaryKey, smallint, text, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import { categories } from './catalog'
import { pk, sanityId, store, timestamps } from './common'
import { discountType, linkPlacement, manageUserRole, shippingIcon } from './enums'

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' })

export const coupons = store.table('coupons', {
  id: pk(),
  sanityId: sanityId(),
  code: text('code').notNull(),
  discount: money('discount').notNull(),
  type: discountType('type').notNull().default('fixed'),
  minOrder: money('min_order').notNull().default(0),
  description: text('description').notNull(),
  ...timestamps(),
}, (t) => [
  uniqueIndex('coupons_code_lower_idx').on(sql`lower(${t.code})`),
  check('coupons_discount_nonneg', sql`${t.discount} >= 0`),
  check('coupons_percent_max', sql`${t.type} <> 'percent' or ${t.discount} <= 100`),
  check('coupons_min_order_nonneg', sql`${t.minOrder} >= 0`),
])

export const ads = store.table('ads', {
  id: pk(),
  sanityId: sanityId(),
  title: text('title').notNull(),
  imageKey: text('image_key').notNull(),
  href: text('href'),
  active: boolean('active').notNull().default(true),
  frequency: integer('frequency').notNull().default(6),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps(),
}, (t) => [
  index('ads_active_sort_idx').on(t.sortOrder).where(sql`${t.active}`),
  check('ads_frequency_min', sql`${t.frequency} >= 1`),
])

export const adCategories = store.table('ad_categories', {
  adId: uuid('ad_id').notNull().references(() => ads.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.adId, t.categoryId] }), index('ad_categories_category_idx').on(t.categoryId)])

export const slides = store.table('slides', {
  id: pk(),
  sanityId: sanityId(),
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
  sanityId: sanityId(),
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
  sanityId: sanityId(),
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
  sanityId: sanityId(),
  username: text('username').notNull(),
  name: text('name'),
  passwordHash: text('password_hash').notNull(),
  role: manageUserRole('role').notNull().default('editor'),
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
  copyright: text('copyright'),
  updatedAt: timestamps().updatedAt,
}, (t) => [check('site_settings_singleton', sql`${t.id} = 1`)])

export const currencies = store.table('currencies', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  symbol: text('symbol').notNull(),
  rate: numeric('rate', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
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
  sanityId: sanityId(),
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
