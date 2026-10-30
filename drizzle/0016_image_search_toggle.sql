ALTER TABLE "store"."site_settings" ADD COLUMN "image_search_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "store"."products" ADD COLUMN "image_palette_retry_at" timestamp with time zone;
