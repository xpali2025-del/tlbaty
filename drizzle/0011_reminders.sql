CREATE TABLE "store"."reminder_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"coupon_id" uuid,
	"sent_on" date DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store"."reminder_rules" (
	"kind" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"delay_hours" integer NOT NULL,
	"cooldown_days" integer DEFAULT 7 NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"discount_type" "store"."discount_type" DEFAULT 'percent' NOT NULL,
	"discount_value" numeric(14, 2) DEFAULT 0 NOT NULL,
	"min_order" numeric(14, 2) DEFAULT 0 NOT NULL,
	"coupon_valid_days" integer DEFAULT 7 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_rules_kind" CHECK ("store"."reminder_rules"."kind" in ('cart','wishlist')),
	CONSTRAINT "reminder_rules_delay" CHECK ("store"."reminder_rules"."delay_hours" between 1 and 2160),
	CONSTRAINT "reminder_rules_cooldown" CHECK ("store"."reminder_rules"."cooldown_days" between 1 and 90),
	CONSTRAINT "reminder_rules_discount" CHECK ("store"."reminder_rules"."discount_value" >= 0 and ("store"."reminder_rules"."discount_type" <> 'percent' or "store"."reminder_rules"."discount_value" <= 100)),
	CONSTRAINT "reminder_rules_coupon_days" CHECK ("store"."reminder_rules"."coupon_valid_days" between 1 and 90)
);
--> statement-breakpoint
ALTER TABLE "store"."coupons" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "store"."coupons" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store"."coupons" ADD COLUMN "max_uses" integer;--> statement-breakpoint
ALTER TABLE "store"."coupons" ADD COLUMN "used_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store"."notifications" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "store"."notifications" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "store"."reminder_log" ADD CONSTRAINT "reminder_log_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "store"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."reminder_log" ADD CONSTRAINT "reminder_log_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "store"."coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_log_once_per_day_idx" ON "store"."reminder_log" USING btree ("customer_id","kind","sent_on");--> statement-breakpoint
CREATE INDEX "reminder_log_lookup_idx" ON "store"."reminder_log" USING btree ("customer_id","kind","sent_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "store"."coupons" ADD CONSTRAINT "coupons_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "store"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."notifications" ADD CONSTRAINT "notifications_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "store"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_customer_idx" ON "store"."notifications" USING btree ("customer_id","published_at" DESC NULLS LAST) WHERE "store"."notifications"."customer_id" is not null;--> statement-breakpoint
ALTER TABLE "store"."coupons" ADD CONSTRAINT "coupons_uses_valid" CHECK ("store"."coupons"."used_count" >= 0 and ("store"."coupons"."max_uses" is null or ("store"."coupons"."max_uses" >= 1 and "store"."coupons"."used_count" <= "store"."coupons"."max_uses")));
--> statement-breakpoint
ALTER TABLE "store"."reminder_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."reminder_log" ENABLE ROW LEVEL SECURITY;
