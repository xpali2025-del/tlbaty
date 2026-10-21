# Phase 1: Sanity -> PostgreSQL schema mapping

All tables live in the Postgres schema `store` (`lib/db/store/*`, migration `drizzle/0002_*`).
They coexist with the interim `public` tables until the app is switched over.
Every migrated table keeps the original Sanity `_id` in `sanity_id` (unique) so the data
migration is idempotent and references can be remapped.

| Sanity type | Tables |
|---|---|
| `product` | `products`, `product_images`, `product_colors` |
| `category` | `categories`, `subcategories` |
| `brand` | `brands` |
| `coupon` | `coupons` (code unique case-insensitively) |
| `ad` | `ads`, `ad_categories` |
| `slide` | `slides` |
| `review` | `reviews` (site-level testimonials, not tied to a product) |
| `paymentAccount` | `payment_accounts` |
| `manageUser` | `manage_users` |
| `siteSettings` | `site_settings` (singleton), `currencies`, `site_links` (nav/footer) |
| `shippingZone` | `shipping_zones`, `shipping_methods` |
| `order` | `orders`, `order_items`, `order_payment_proofs`, `order_status_history`, `order_payment_status_history` |
| `customer` | `customers`, `customer_phone_history` |
| `customerSession` | `customer_sessions` (token hash only) |
| `otpCode` | `otp_codes` |
| `authEvent` | `auth_events` |
| `courier` | `couriers` |
| `notification` | `notifications`, `notification_reads` (new; reader is a customer or an anonymous device id) |

## Decisions to review
- Images are stored as object keys (`*_key`) for R2, not Sanity asset refs; `order_items.image_url` stays a URL snapshot.
- `products.subcategory` (a string in Sanity) becomes `subcategory_id`; the migration must resolve it by category + slug/name.
- `orders.customer_id`, `courier_id`, and `order_items.product_id` are `ON DELETE SET NULL`; snapshot columns keep the history readable.
- The payment-proof blob stays encrypted in object storage; only its metadata (iv, auth tag, key version, mime types) is in `order_payment_proofs`.
- Not generated yet: order-number sequence, the data-migration script, and the app's data layer (later phases).
