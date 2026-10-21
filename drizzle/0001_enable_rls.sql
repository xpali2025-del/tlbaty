-- Defense in depth: Supabase exposes tables to its REST API roles (anon/authenticated) unless RLS is on.
-- No policies are created: only the server's database role (owner / BYPASSRLS) can read or write.
ALTER TABLE "store"."brands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."product_colors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."product_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."subcategories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."ad_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."ads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."coupons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."currencies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."manage_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."payment_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."shipping_methods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."shipping_zones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."site_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."site_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."slides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."auth_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."customer_phone_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."customer_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."login_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."otp_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."couriers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."order_payment_proofs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."order_payment_status_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."order_status_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."notification_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."notifications" ENABLE ROW LEVEL SECURITY;
