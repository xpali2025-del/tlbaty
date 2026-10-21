CREATE SCHEMA "store";
--> statement-breakpoint
CREATE TYPE "store"."auth_event_type" AS ENUM('otp_sent', 'otp_resent', 'otp_verified', 'otp_failed', 'otp_expired', 'rate_limited', 'account_created', 'login', 'logout', 'logout_all', 'phone_changed');--> statement-breakpoint
CREATE TYPE "store"."courier_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "store"."customer_status" AS ENUM('active', 'blocked');--> statement-breakpoint
CREATE TYPE "store"."discount_type" AS ENUM('percent', 'fixed');--> statement-breakpoint
CREATE TYPE "store"."link_placement" AS ENUM('nav', 'footer');--> statement-breakpoint
CREATE TYPE "store"."manage_user_role" AS ENUM('admin', 'editor');--> statement-breakpoint
CREATE TYPE "store"."notification_priority" AS ENUM('normal', 'important');--> statement-breakpoint
CREATE TYPE "store"."notification_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "store"."order_status" AS ENUM('new', 'confirmed', 'processing', 'ready', 'assigned', 'on_the_way', 'delivered', 'failed', 'cancelled', 'returned');--> statement-breakpoint
CREATE TYPE "store"."otp_purpose" AS ENUM('login', 'change_phone');--> statement-breakpoint
CREATE TYPE "store"."payment_method" AS ENUM('cash_on_delivery', 'manual_transfer');--> statement-breakpoint
CREATE TYPE "store"."payment_status" AS ENUM('pending_on_delivery', 'pending_verification', 'verified', 'rejected', 'paid', 'refunded', 'cancelled');--> statement-breakpoint
CREATE TYPE "store"."shipping_icon" AS ENUM('express', 'standard', 'pickup');--> statement-breakpoint
CREATE TABLE "store"."brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sanity_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"image_key" text,
	"description" text,
	"featured" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"meta_title" text,
	"meta_description" text,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_sanity_id_unique" UNIQUE("sanity_id"),
	CONSTRAINT "brands_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "store"."categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sanity_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"image_key" text,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"meta_title" text,
	"meta_description" text,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_sanity_id_unique" UNIQUE("sanity_id"),
	CONSTRAINT "categories_slug_unique" UNIQUE("slug"),
	CONSTRAINT "categories_sort_nonneg" CHECK ("store"."categories"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "store"."product_colors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hex" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_colors_hex_format" CHECK ("store"."product_colors"."hex" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "store"."product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"image_key" text NOT NULL,
	"alt" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store"."products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sanity_id" text,
	"product_number" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"category_id" uuid NOT NULL,
	"subcategory_id" uuid,
	"brand_id" uuid,
	"price" numeric(14, 2) NOT NULL,
	"old_price" numeric(14, 2),
	"description" text NOT NULL,
	"is_new" boolean DEFAULT false NOT NULL,
	"is_bestseller" boolean DEFAULT false NOT NULL,
	"main_image_key" text,
	"stock" integer DEFAULT 0 NOT NULL,
	"sizes" text[] DEFAULT '{}'::text[] NOT NULL,
	"sku" text,
	"badge" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"rating" real DEFAULT 5 NOT NULL,
	"reviews_count" integer DEFAULT 0 NOT NULL,
	"meta_title" text,
	"meta_description" text,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_sanity_id_unique" UNIQUE("sanity_id"),
	CONSTRAINT "products_product_number_unique" UNIQUE("product_number"),
	CONSTRAINT "products_slug_unique" UNIQUE("slug"),
	CONSTRAINT "products_price_nonneg" CHECK ("store"."products"."price" >= 0),
	CONSTRAINT "products_old_price_nonneg" CHECK ("store"."products"."old_price" is null or "store"."products"."old_price" >= 0),
	CONSTRAINT "products_stock_nonneg" CHECK ("store"."products"."stock" >= 0),
	CONSTRAINT "products_rating_range" CHECK ("store"."products"."rating" between 0 and 5),
	CONSTRAINT "products_reviews_nonneg" CHECK ("store"."products"."reviews_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "store"."subcategories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store"."ad_categories" (
	"ad_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "ad_categories_ad_id_category_id_pk" PRIMARY KEY("ad_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "store"."ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sanity_id" text,
	"title" text NOT NULL,
	"image_key" text NOT NULL,
	"href" text,
	"active" boolean DEFAULT true NOT NULL,
	"frequency" integer DEFAULT 6 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ads_sanity_id_unique" UNIQUE("sanity_id"),
	CONSTRAINT "ads_frequency_min" CHECK ("store"."ads"."frequency" >= 1)
);
--> statement-breakpoint
CREATE TABLE "store"."coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sanity_id" text,
	"code" text NOT NULL,
	"discount" numeric(14, 2) NOT NULL,
	"type" "store"."discount_type" DEFAULT 'fixed' NOT NULL,
	"min_order" numeric(14, 2) DEFAULT 0 NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_sanity_id_unique" UNIQUE("sanity_id"),
	CONSTRAINT "coupons_discount_nonneg" CHECK ("store"."coupons"."discount" >= 0),
	CONSTRAINT "coupons_percent_max" CHECK ("store"."coupons"."type" <> 'percent' or "store"."coupons"."discount" <= 100),
	CONSTRAINT "coupons_min_order_nonneg" CHECK ("store"."coupons"."min_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "store"."currencies" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "currencies_rate_positive" CHECK ("store"."currencies"."rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "store"."manage_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sanity_id" text,
	"username" text NOT NULL,
	"name" text,
	"password_hash" text NOT NULL,
	"role" "store"."manage_user_role" DEFAULT 'editor' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manage_users_sanity_id_unique" UNIQUE("sanity_id")
);
--> statement-breakpoint
CREATE TABLE "store"."payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sanity_id" text,
	"provider_name" text NOT NULL,
	"account_display_name" text,
	"account_holder_name" text NOT NULL,
	"account_number" text NOT NULL,
	"image_key" text,
	"instructions" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_accounts_sanity_id_unique" UNIQUE("sanity_id"),
	CONSTRAINT "payment_accounts_sort_range" CHECK ("store"."payment_accounts"."sort_order" between 0 and 9999)
);
--> statement-breakpoint
CREATE TABLE "store"."reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sanity_id" text,
	"name" text NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text NOT NULL,
	"review_date" date NOT NULL,
	"avatar_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_sanity_id_unique" UNIQUE("sanity_id"),
	CONSTRAINT "reviews_rating_range" CHECK ("store"."reviews"."rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "store"."shipping_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" numeric(14, 2) DEFAULT 0 NOT NULL,
	"icon" "store"."shipping_icon" DEFAULT 'standard' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "shipping_methods_price_nonneg" CHECK ("store"."shipping_methods"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "store"."shipping_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sanity_id" text,
	"governorate" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_zones_sanity_id_unique" UNIQUE("sanity_id"),
	CONSTRAINT "shipping_zones_target" CHECK ("store"."shipping_zones"."is_default" or "store"."shipping_zones"."governorate" is not null)
);
--> statement-breakpoint
CREATE TABLE "store"."site_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"placement" "store"."link_placement" NOT NULL,
	"label" text NOT NULL,
	"href" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store"."site_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text,
	"tagline" text,
	"logo_key" text,
	"description" text,
	"default_currency" text DEFAULT 'YER' NOT NULL,
	"phone" text,
	"whatsapp" text,
	"email" text,
	"address" text,
	"working_hours" text,
	"instagram" text,
	"facebook" text,
	"tiktok" text,
	"copyright" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_settings_singleton" CHECK ("store"."site_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "store"."slides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sanity_id" text,
	"title" text NOT NULL,
	"subtitle" text,
	"cta" text,
	"href" text,
	"image_key" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slides_sanity_id_unique" UNIQUE("sanity_id")
);
--> statement-breakpoint
CREATE TABLE "store"."auth_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" "store"."auth_event_type" NOT NULL,
	"phone" text,
	"customer_id" uuid,
	"ip" text,
	"user_agent" text,
	"detail" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store"."customer_phone_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"from_phone" text NOT NULL,
	"to_phone" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store"."customer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"revoked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "customer_sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "customer_sessions_expiry_order" CHECK ("store"."customer_sessions"."expires_at" > "store"."customer_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "store"."customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sanity_id" text,
	"public_id" text NOT NULL,
	"phone" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"status" "store"."customer_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "customers_sanity_id_unique" UNIQUE("sanity_id"),
	CONSTRAINT "customers_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "customers_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "store"."login_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"browser_secret_hash" text NOT NULL,
	"phone" text,
	"claimed_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_challenges_token_unique" UNIQUE("token"),
	CONSTRAINT "login_challenges_browser_secret_hash_unique" UNIQUE("browser_secret_hash"),
	CONSTRAINT "login_challenges_claim_consistent" CHECK (("store"."login_challenges"."claimed_at" is null) = ("store"."login_challenges"."phone" is null))
);
--> statement-breakpoint
CREATE TABLE "store"."otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"salt" text NOT NULL,
	"purpose" "store"."otp_purpose" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL,
	"provider" text,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_codes_attempts_nonneg" CHECK ("store"."otp_codes"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "store"."couriers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sanity_id" text,
	"name" text NOT NULL,
	"phone" text,
	"image_key" text,
	"cities" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "store"."courier_status" DEFAULT 'active' NOT NULL,
	"admin_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "couriers_sanity_id_unique" UNIQUE("sanity_id")
);
--> statement-breakpoint
CREATE TABLE "store"."order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"product_number" text,
	"product_ref" text,
	"sku" text,
	"image_url" text,
	"name" text NOT NULL,
	"size" text,
	"color" text,
	"quantity" integer NOT NULL,
	"price" numeric(14, 2) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "order_items_quantity_positive" CHECK ("store"."order_items"."quantity" > 0),
	CONSTRAINT "order_items_price_nonneg" CHECK ("store"."order_items"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "store"."order_payment_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_version" text NOT NULL,
	"original_mime_type" text,
	"processed_mime_type" text,
	"byte_size" integer,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_payment_proofs_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "order_payment_proofs_size_nonneg" CHECK ("store"."order_payment_proofs"."byte_size" is null or "store"."order_payment_proofs"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "store"."order_payment_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "store"."payment_status" NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "store"."order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "store"."order_status",
	"to_status" "store"."order_status" NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "store"."orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sanity_id" text,
	"order_number" text NOT NULL,
	"status" "store"."order_status" DEFAULT 'new' NOT NULL,
	"customer_id" uuid,
	"customer_phone_normalized" text,
	"customer_name" text NOT NULL,
	"phone" text NOT NULL,
	"city" text,
	"address" text,
	"latitude" double precision,
	"longitude" double precision,
	"location_accuracy" real,
	"location_captured_at" timestamp with time zone,
	"address_source" text,
	"customer_note" text,
	"shipping_method" text,
	"shipping_price" numeric(14, 2) DEFAULT 0 NOT NULL,
	"coupon_code" text,
	"discount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"currency_symbol" text,
	"currency_code" text,
	"courier_id" uuid,
	"courier_snapshot" jsonb,
	"courier_assigned_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"payment_method" "store"."payment_method" DEFAULT 'cash_on_delivery' NOT NULL,
	"payment_status" "store"."payment_status" DEFAULT 'pending_on_delivery' NOT NULL,
	"payment_account_snapshot" jsonb,
	"transfer_sender_name" text,
	"transfer_reference" text,
	"transfer_submitted_at" timestamp with time zone,
	"payment_verified_at" timestamp with time zone,
	"payment_rejected_at" timestamp with time zone,
	"payment_rejection_reason" text,
	"payment_admin_note" text,
	"duplicate_transfer_reference" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_sanity_id_unique" UNIQUE("sanity_id"),
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number"),
	CONSTRAINT "orders_amounts_nonneg" CHECK ("store"."orders"."subtotal" >= 0 and "store"."orders"."total" >= 0 and "store"."orders"."discount" >= 0 and "store"."orders"."shipping_price" >= 0),
	CONSTRAINT "orders_latitude_range" CHECK ("store"."orders"."latitude" is null or "store"."orders"."latitude" between -90 and 90),
	CONSTRAINT "orders_longitude_range" CHECK ("store"."orders"."longitude" is null or "store"."orders"."longitude" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "store"."notification_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"customer_id" uuid,
	"device_id" text,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_reads_one_reader" CHECK (num_nonnulls("store"."notification_reads"."customer_id", "store"."notification_reads"."device_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "store"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sanity_id" text,
	"title" text NOT NULL,
	"body" text,
	"image_key" text,
	"link" text,
	"status" "store"."notification_status" DEFAULT 'draft' NOT NULL,
	"priority" "store"."notification_priority" DEFAULT 'normal' NOT NULL,
	"published_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_sanity_id_unique" UNIQUE("sanity_id")
);
--> statement-breakpoint
ALTER TABLE "store"."product_colors" ADD CONSTRAINT "product_colors_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "store"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "store"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "store"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."products" ADD CONSTRAINT "products_subcategory_id_subcategories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "store"."subcategories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "store"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."subcategories" ADD CONSTRAINT "subcategories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "store"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."ad_categories" ADD CONSTRAINT "ad_categories_ad_id_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "store"."ads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."ad_categories" ADD CONSTRAINT "ad_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "store"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."shipping_methods" ADD CONSTRAINT "shipping_methods_zone_id_shipping_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "store"."shipping_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."auth_events" ADD CONSTRAINT "auth_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "store"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."customer_phone_history" ADD CONSTRAINT "customer_phone_history_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "store"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."customer_sessions" ADD CONSTRAINT "customer_sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "store"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "store"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "store"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_payment_proofs" ADD CONSTRAINT "order_payment_proofs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "store"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_payment_status_history" ADD CONSTRAINT "order_payment_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "store"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "store"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "store"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."orders" ADD CONSTRAINT "orders_courier_id_couriers_id_fk" FOREIGN KEY ("courier_id") REFERENCES "store"."couriers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."notification_reads" ADD CONSTRAINT "notification_reads_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "store"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."notification_reads" ADD CONSTRAINT "notification_reads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "store"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brands_featured_idx" ON "store"."brands" USING btree ("sort_order") WHERE "store"."brands"."featured";--> statement-breakpoint
CREATE INDEX "product_colors_product_idx" ON "store"."product_colors" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE INDEX "product_images_product_idx" ON "store"."product_images" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE INDEX "products_category_sort_idx" ON "store"."products" USING btree ("category_id","sort_order");--> statement-breakpoint
CREATE INDEX "products_subcategory_idx" ON "store"."products" USING btree ("subcategory_id");--> statement-breakpoint
CREATE INDEX "products_brand_idx" ON "store"."products" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "products_bestseller_idx" ON "store"."products" USING btree ("sort_order") WHERE "store"."products"."is_bestseller";--> statement-breakpoint
CREATE INDEX "products_created_idx" ON "store"."products" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "subcategories_category_slug_idx" ON "store"."subcategories" USING btree ("category_id","slug");--> statement-breakpoint
CREATE INDEX "ad_categories_category_idx" ON "store"."ad_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "ads_active_sort_idx" ON "store"."ads" USING btree ("sort_order") WHERE "store"."ads"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_lower_idx" ON "store"."coupons" USING btree (lower("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "manage_users_username_lower_idx" ON "store"."manage_users" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "payment_accounts_active_sort_idx" ON "store"."payment_accounts" USING btree ("sort_order") WHERE "store"."payment_accounts"."is_active";--> statement-breakpoint
CREATE INDEX "reviews_date_idx" ON "store"."reviews" USING btree ("review_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "shipping_methods_zone_idx" ON "store"."shipping_methods" USING btree ("zone_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_zones_governorate_idx" ON "store"."shipping_zones" USING btree ("governorate") WHERE "store"."shipping_zones"."governorate" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_zones_one_default_idx" ON "store"."shipping_zones" USING btree ("is_default") WHERE "store"."shipping_zones"."is_default";--> statement-breakpoint
CREATE INDEX "site_links_placement_sort_idx" ON "store"."site_links" USING btree ("placement","sort_order");--> statement-breakpoint
CREATE INDEX "slides_sort_idx" ON "store"."slides" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "auth_events_customer_idx" ON "store"."auth_events" USING btree ("customer_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "auth_events_phone_idx" ON "store"."auth_events" USING btree ("phone","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "auth_events_event_idx" ON "store"."auth_events" USING btree ("event","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "auth_events_ip_idx" ON "store"."auth_events" USING btree ("ip","at" DESC NULLS LAST) WHERE "store"."auth_events"."ip" is not null;--> statement-breakpoint
CREATE INDEX "customer_phone_history_customer_idx" ON "store"."customer_phone_history" USING btree ("customer_id","changed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "customer_sessions_customer_idx" ON "store"."customer_sessions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_sessions_active_expiry_idx" ON "store"."customer_sessions" USING btree ("expires_at") WHERE not "store"."customer_sessions"."revoked";--> statement-breakpoint
CREATE INDEX "login_challenges_expiry_idx" ON "store"."login_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "login_challenges_ip_idx" ON "store"."login_challenges" USING btree ("ip","created_at" DESC NULLS LAST) WHERE "store"."login_challenges"."ip" is not null;--> statement-breakpoint
CREATE INDEX "otp_codes_phone_purpose_idx" ON "store"."otp_codes" USING btree ("phone","purpose","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "otp_codes_expiry_idx" ON "store"."otp_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "couriers_status_idx" ON "store"."couriers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "store"."order_items" USING btree ("order_id","position");--> statement-breakpoint
CREATE INDEX "order_items_product_idx" ON "store"."order_items" USING btree ("product_id") WHERE "store"."order_items"."product_id" is not null;--> statement-breakpoint
CREATE INDEX "order_payment_status_history_order_idx" ON "store"."order_payment_status_history" USING btree ("order_id","changed_at");--> statement-breakpoint
CREATE INDEX "order_status_history_order_idx" ON "store"."order_status_history" USING btree ("order_id","changed_at");--> statement-breakpoint
CREATE INDEX "orders_customer_created_idx" ON "store"."orders" USING btree ("customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_status_created_idx" ON "store"."orders" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_payment_status_idx" ON "store"."orders" USING btree ("payment_status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_courier_idx" ON "store"."orders" USING btree ("courier_id") WHERE "store"."orders"."courier_id" is not null;--> statement-breakpoint
CREATE INDEX "orders_phone_idx" ON "store"."orders" USING btree ("customer_phone_normalized");--> statement-breakpoint
CREATE INDEX "orders_transfer_reference_idx" ON "store"."orders" USING btree ("transfer_reference") WHERE "store"."orders"."transfer_reference" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_reads_customer_idx" ON "store"."notification_reads" USING btree ("notification_id","customer_id") WHERE "store"."notification_reads"."customer_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_reads_device_idx" ON "store"."notification_reads" USING btree ("notification_id","device_id") WHERE "store"."notification_reads"."device_id" is not null;--> statement-breakpoint
CREATE INDEX "notification_reads_customer_lookup_idx" ON "store"."notification_reads" USING btree ("customer_id") WHERE "store"."notification_reads"."customer_id" is not null;--> statement-breakpoint
CREATE INDEX "notifications_published_idx" ON "store"."notifications" USING btree ("published_at" DESC NULLS LAST) WHERE "store"."notifications"."status" = 'published';--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "store"."notifications" USING btree ("status","created_at" DESC NULLS LAST);