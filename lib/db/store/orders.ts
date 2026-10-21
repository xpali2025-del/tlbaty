import { sql } from 'drizzle-orm'
import {
  boolean, check, doublePrecision, index, integer, jsonb, numeric, real, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import { products } from './catalog'
import { pk, store } from './common'
import { customers } from './customers'
import { courierStatus, orderStatus, paymentMethod, paymentStatus } from './enums'

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' })
const at = (name: string) => timestamp(name, { withTimezone: true })

export const couriers = store.table('couriers', {
  id: pk(),
  name: text('name').notNull(),
  phone: text('phone'),
  imageKey: text('image_key'),
  cities: text('cities').array().notNull().default(sql`'{}'::text[]`),
  status: courierStatus('status').notNull().default('active'),
  adminNote: text('admin_note'),
  createdAt: at('created_at').notNull().defaultNow(),
}, (t) => [index('couriers_status_idx').on(t.status)])

export const orders = store.table('orders', {
  id: pk(),
  orderNumber: text('order_number').notNull().unique(),
  status: orderStatus('status').notNull().default('new'),

  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  customerPhoneNormalized: text('customer_phone_normalized'),
  customerName: text('customer_name').notNull(),
  phone: text('phone').notNull(),
  city: text('city'),
  address: text('address'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  locationAccuracy: real('location_accuracy'),
  locationCapturedAt: at('location_captured_at'),
  addressSource: text('address_source'),
  customerNote: text('customer_note'),

  shippingMethod: text('shipping_method'),
  shippingPrice: money('shipping_price').notNull().default(0),
  couponCode: text('coupon_code'),
  discount: money('discount').notNull().default(0),
  subtotal: money('subtotal').notNull(),
  total: money('total').notNull(),
  currencySymbol: text('currency_symbol'),
  currencyCode: text('currency_code'),

  courierId: uuid('courier_id').references(() => couriers.id, { onDelete: 'set null' }),
  /** Courier details as they were at assignment time. */
  courierSnapshot: jsonb('courier_snapshot').$type<{ courierId?: string; name?: string; phone?: string }>(),
  courierAssignedAt: at('courier_assigned_at'),
  deliveredAt: at('delivered_at'),

  paymentMethod: paymentMethod('payment_method').notNull().default('cash_on_delivery'),
  paymentStatus: paymentStatus('payment_status').notNull().default('pending_on_delivery'),
  paymentAccountSnapshot: jsonb('payment_account_snapshot').$type<{
    sourceDocumentId?: string; providerName?: string; accountDisplayName?: string
    accountHolderName?: string; accountNumber?: string; imageUrl?: string
  }>(),
  transferSenderName: text('transfer_sender_name'),
  /** Sender's phone number as digits (international when Yemeni/Saudi), required for bank transfers. */
  transferSenderPhone: text('transfer_sender_phone'),
  transferReference: text('transfer_reference'),
  /** Client-generated key per checkout attempt: a retry (after a dropped connection or re-login) returns the same order instead of creating a second one. */
  idempotencyKey: text('idempotency_key'),
  transferSubmittedAt: at('transfer_submitted_at'),
  paymentVerifiedAt: at('payment_verified_at'),
  paymentRejectedAt: at('payment_rejected_at'),
  paymentRejectionReason: text('payment_rejection_reason'),
  paymentAdminNote: text('payment_admin_note'),
  duplicateTransferReference: boolean('duplicate_transfer_reference').notNull().default(false),

  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at').notNull().defaultNow(),
}, (t) => [
  index('orders_customer_created_idx').on(t.customerId, t.createdAt.desc()),
  index('orders_status_created_idx').on(t.status, t.createdAt.desc()),
  index('orders_payment_status_idx').on(t.paymentStatus, t.createdAt.desc()),
  index('orders_courier_idx').on(t.courierId).where(sql`${t.courierId} is not null`),
  index('orders_phone_idx').on(t.customerPhoneNormalized),
  uniqueIndex('orders_customer_idempotency_idx').on(t.customerId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
  index('orders_transfer_reference_idx').on(t.transferReference).where(sql`${t.transferReference} is not null`),
  check('orders_amounts_nonneg', sql`${t.subtotal} >= 0 and ${t.total} >= 0 and ${t.discount} >= 0 and ${t.shippingPrice} >= 0`),
  check('orders_latitude_range', sql`${t.latitude} is null or ${t.latitude} between -90 and 90`),
  check('orders_longitude_range', sql`${t.longitude} is null or ${t.longitude} between -180 and 180`),
])

export const orderItems = store.table('order_items', {
  id: pk(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  /** Nullable so deleting a product keeps the order history (the snapshot columns remain). */
  productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
  /** Display number (TJ-XXXXXXXX), derived from the product id at order time. */
  productNumber: text('product_number'),
  /** The product id (products.product_number) at order time; survives deleting the product. */
  productRef: text('product_ref'),
  sku: text('sku'),
  imageUrl: text('image_url'),
  name: text('name').notNull(),
  size: text('size'),
  color: text('color'),
  quantity: integer('quantity').notNull(),
  price: money('price').notNull(),
  /** Order of the line as the customer placed it (the first line is shown in summaries). */
  position: integer('position').notNull().default(0),
}, (t) => [
  index('order_items_order_idx').on(t.orderId, t.position),
  index('order_items_product_idx').on(t.productId).where(sql`${t.productId} is not null`),
  check('order_items_quantity_positive', sql`${t.quantity} > 0`),
  check('order_items_price_nonneg', sql`${t.price} >= 0`),
])

/** Payment-proof file metadata; the encrypted blob itself lives in object storage. */
export const orderPaymentProofs = store.table('order_payment_proofs', {
  id: pk(),
  orderId: uuid('order_id').notNull().unique().references(() => orders.id, { onDelete: 'cascade' }),
  objectKey: text('object_key').notNull(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),
  keyVersion: text('key_version').notNull(),
  originalMimeType: text('original_mime_type'),
  processedMimeType: text('processed_mime_type'),
  byteSize: integer('byte_size'),
  uploadedAt: at('uploaded_at').notNull().defaultNow(),
}, (t) => [check('order_payment_proofs_size_nonneg', sql`${t.byteSize} is null or ${t.byteSize} >= 0`)])

export const orderStatusHistory = store.table('order_status_history', {
  id: pk(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  fromStatus: orderStatus('from_status'),
  toStatus: orderStatus('to_status').notNull(),
  changedAt: at('changed_at').notNull().defaultNow(),
  changedBy: text('changed_by'),
  note: text('note'),
}, (t) => [index('order_status_history_order_idx').on(t.orderId, t.changedAt)])

export const orderPaymentStatusHistory = store.table('order_payment_status_history', {
  id: pk(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  status: paymentStatus('status').notNull(),
  changedAt: at('changed_at').notNull().defaultNow(),
  changedBy: text('changed_by'),
  note: text('note'),
}, (t) => [index('order_payment_status_history_order_idx').on(t.orderId, t.changedAt)])
