ALTER TABLE "customers" ADD COLUMN "auth_user_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_auth_user_id_unique" UNIQUE("auth_user_id");