CREATE TABLE "store"."pending_uploads" (
	"object_key" text PRIMARY KEY NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pending_uploads_created_idx" ON "store"."pending_uploads" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "store"."pending_uploads" ENABLE ROW LEVEL SECURITY;
