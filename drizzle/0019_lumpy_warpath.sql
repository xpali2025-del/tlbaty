CREATE TABLE "store"."puk_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" text NOT NULL,
	"request_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"setup_token_hash" text,
	"setup_token_expires_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "puk_codes_purpose_valid" CHECK ("store"."puk_codes"."purpose" in ('first_setup', 'recovery')),
	CONSTRAINT "puk_codes_attempts_nonneg" CHECK ("store"."puk_codes"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "store"."puk_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"full_name" text,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handled_at" timestamp with time zone,
	"handled_by" text,
	CONSTRAINT "puk_requests_purpose_valid" CHECK ("store"."puk_requests"."purpose" in ('first_setup', 'recovery')),
	CONSTRAINT "puk_requests_status_valid" CHECK ("store"."puk_requests"."status" in ('pending', 'issued', 'rejected', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "store"."puk_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."puk_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."site_settings" ADD COLUMN "login_method" text DEFAULT 'wa_web' NOT NULL;--> statement-breakpoint
ALTER TABLE "store"."site_settings" ADD COLUMN "puk_ttl_hours" integer DEFAULT 72 NOT NULL;--> statement-breakpoint
ALTER TABLE "store"."site_settings" ADD COLUMN "puk_max_attempts" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "store"."customers" ADD COLUMN "full_name" text;--> statement-breakpoint
ALTER TABLE "store"."customers" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "store"."customers" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "store"."customers" ADD COLUMN "password_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store"."customers" ADD COLUMN "profile_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store"."customers" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store"."customers" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store"."puk_codes" ADD CONSTRAINT "puk_codes_request_id_puk_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "store"."puk_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "puk_codes_one_live_idx" ON "store"."puk_codes" USING btree ("phone") WHERE "store"."puk_codes"."used_at" is null and "store"."puk_codes"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "puk_requests_pending_idx" ON "store"."puk_requests" USING btree ("created_at" DESC NULLS LAST) WHERE "store"."puk_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "puk_requests_phone_idx" ON "store"."puk_requests" USING btree ("phone","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "store"."site_settings" ADD CONSTRAINT "site_settings_login_method_valid" CHECK ("store"."site_settings"."login_method" in ('wa_cloud', 'wa_web', 'sms', 'wa_web_sms', 'wa_chat', 'puk'));--> statement-breakpoint
ALTER TABLE "store"."site_settings" ADD CONSTRAINT "site_settings_puk_ttl_range" CHECK ("store"."site_settings"."puk_ttl_hours" between 1 and 720);--> statement-breakpoint
ALTER TABLE "store"."site_settings" ADD CONSTRAINT "site_settings_puk_attempts_range" CHECK ("store"."site_settings"."puk_max_attempts" between 1 and 20);--> statement-breakpoint
ALTER TABLE "store"."customers" ADD CONSTRAINT "customers_full_name_len" CHECK ("store"."customers"."full_name" is null or char_length("store"."customers"."full_name") between 5 and 80);--> statement-breakpoint
ALTER TABLE "store"."customers" ADD CONSTRAINT "customers_email_len" CHECK ("store"."customers"."email" is null or char_length("store"."customers"."email") <= 254);--> statement-breakpoint
UPDATE "store"."site_settings" SET "login_method" = CASE "otp_channel" WHEN 'sms' THEN 'sms' WHEN 'whatsapp_sms' THEN 'wa_web_sms' ELSE 'wa_web' END;--> statement-breakpoint
-- otp_channel يبقى لإصدار واحد: أي كتابة له وحده (كود الإصدار السابق عند التراجع، أو أي أداة) تحدّث login_method تلقائياً،
-- وأي كتابة صريحة لـlogin_method (وضع PUK أو واتساب الرسمي) تبقى كما هي.
CREATE FUNCTION "store"."site_settings_sync_login_method"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.login_method = 'wa_web' THEN
      NEW.login_method := CASE NEW.otp_channel WHEN 'sms' THEN 'sms' WHEN 'whatsapp_sms' THEN 'wa_web_sms' ELSE 'wa_web' END;
    END IF;
  ELSIF NEW.otp_channel IS DISTINCT FROM OLD.otp_channel AND NEW.login_method IS NOT DISTINCT FROM OLD.login_method THEN
    NEW.login_method := CASE NEW.otp_channel WHEN 'sms' THEN 'sms' WHEN 'whatsapp_sms' THEN 'wa_web_sms' ELSE 'wa_web' END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "site_settings_sync_login_method" BEFORE INSERT OR UPDATE ON "store"."site_settings" FOR EACH ROW EXECUTE FUNCTION "store"."site_settings_sync_login_method"();
