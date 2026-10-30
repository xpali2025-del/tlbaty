import { sql } from 'drizzle-orm'
import {
  boolean, check, index, integer, jsonb, numeric, real, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import { pk, store, timestamps } from './common'

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' })
const seo = () => ({
  metaTitle: text('meta_title'),
  metaDescription: text('meta_description'),
  keywords: text('keywords').array().notNull().default(sql`'{}'::text[]`),
})

export const categories = store.table('categories', {
  id: pk(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  /** Short code that prefixes product codes (e.g. DR -> DR-012). */
  code: text('code').unique(),
  /** Last number handed out for this category; never reused, so codes stay stable. */
  productSeq: integer('product_seq').notNull().default(0),
  imageKey: text('image_key'),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  ...seo(),
  ...timestamps(),
}, (t) => [check('categories_sort_nonneg', sql`${t.sortOrder} >= 0`)])

export const subcategories = store.table('subcategories', {
  id: pk(),
  categoryId: uuid('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [uniqueIndex('subcategories_category_slug_idx').on(t.categoryId, t.slug)])

export const brands = store.table('brands', {
  id: pk(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  imageKey: text('image_key'),
  description: text('description'),
  featured: boolean('featured').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  ...seo(),
  ...timestamps(),
}, (t) => [index('brands_featured_idx').on(t.sortOrder).where(sql`${t.featured}`)])

/** Reusable size guide (measurements in cm per size). A product points to one, or carries its own custom copy. */
export const sizeCharts = store.table('size_charts', {
  id: pk(),
  name: text('name').notNull(),
  columns: jsonb('columns').$type<{ key: string; label: string }[]>().notNull(),
  rows: jsonb('rows').$type<{ size: string; ranges: Record<string, [number, number]> }[]>().notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps(),
}, (t) => [uniqueIndex('size_charts_name_lower_idx').on(sql`lower(${t.name})`)])

export const products = store.table('products', {
  id: pk(),
  /** Human-facing product number ( `productId`). */
  productNumber: text('product_number').notNull().unique(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  categoryId: uuid('category_id').notNull().references(() => categories.id, { onDelete: 'restrict' }),
  subcategoryId: uuid('subcategory_id').references(() => subcategories.id, { onDelete: 'set null' }),
  brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
  price: money('price').notNull(),
  oldPrice: money('old_price'),
  description: text('description').notNull(),
  isNew: boolean('is_new').notNull().default(false),
  isBestseller: boolean('is_bestseller').notNull().default(false),
  mainImageKey: text('main_image_key'),
  stock: integer('stock').notNull().default(0),
  sizes: text('sizes').array().notNull().default(sql`'{}'::text[]`),
  /** Size guide shown on the product page: a shared chart, or a custom one for this product; both null = none. */
  sizeChartId: uuid('size_chart_id').references(() => sizeCharts.id, { onDelete: 'set null' }),
  customSizeChart: jsonb('custom_size_chart').$type<{ name: string; columns: { key: string; label: string }[]; rows: { size: string; ranges: Record<string, [number, number]> }[] }>(),
  sku: text('sku'),
  badge: text('badge'),
  /** Legacy merchandising tags (new / bestseller / offer / regular); the storefront lists use them. */
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  /** Normalized text (name, brand, category, colors, code, keywords) the storefront search matches against. */
  searchText: text('search_text').notNull().default(''),
  /** Dominant colors of the main image, [{ hex, weight }], used by search-by-image. */
  imagePalette: jsonb('image_palette').$type<{ hex: string; weight: number }[]>().notNull().default(sql`'[]'::jsonb`),
  /** Retry time for a failed search palette; no effect on the product image. */
  imagePaletteRetryAt: timestamp('image_palette_retry_at', { withTimezone: true }),
  sortOrder: integer('sort_order').notNull().default(0),
  rating: real('rating').notNull().default(5),
  reviewsCount: integer('reviews_count').notNull().default(0),
  ...seo(),
  ...timestamps(),
}, (t) => [
  index('products_category_sort_idx').on(t.categoryId, t.sortOrder),
  index('products_subcategory_idx').on(t.subcategoryId),
  index('products_brand_idx').on(t.brandId),
  index('products_bestseller_idx').on(t.sortOrder).where(sql`${t.isBestseller}`),
  index('products_created_idx').on(t.createdAt.desc()),
  check('products_price_nonneg', sql`${t.price} >= 0`),
  check('products_old_price_nonneg', sql`${t.oldPrice} is null or ${t.oldPrice} >= 0`),
  check('products_stock_nonneg', sql`${t.stock} >= 0`),
  check('products_rating_range', sql`${t.rating} between 0 and 5`),
  check('products_reviews_nonneg', sql`${t.reviewsCount} >= 0`),
])

export const productImages = store.table('product_images', {
  id: pk(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  imageKey: text('image_key').notNull(),
  alt: text('alt'),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [index('product_images_product_idx').on(t.productId, t.sortOrder)])

export const productColors = store.table('product_colors', {
  id: pk(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  hex: text('hex').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [
  index('product_colors_product_idx').on(t.productId, t.sortOrder),
  check('product_colors_hex_format', sql`${t.hex} ~ '^#[0-9a-fA-F]{6}$'`),
])


/**
 * Stock per colour/size combination. A product with at least one row here is tracked per variant:
 * `products.stock` then mirrors the sum of its variants (kept in sync by the admin save and by orders).
 * `color` / `size` are '' when the product has no colours / no sizes.
 */
export const productVariants = store.table('product_variants', {
  id: pk(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  color: text('color').notNull().default(''),
  size: text('size').notNull().default(''),
  stock: integer('stock').notNull().default(0),
}, (t) => [
  uniqueIndex('product_variants_unique_idx').on(t.productId, t.color, t.size),
  check('product_variants_stock_nonneg', sql`${t.stock} >= 0`),
])
