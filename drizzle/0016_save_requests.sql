CREATE TABLE "store"."save_requests" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"screen" text NOT NULL,
	"entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store"."products" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "save_requests_created_idx" ON "store"."save_requests" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "store"."save_requests" ENABLE ROW LEVEL SECURITY;
