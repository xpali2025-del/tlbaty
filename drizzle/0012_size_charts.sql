CREATE TABLE "store"."size_charts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"columns" jsonb NOT NULL,
	"rows" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store"."products" ADD COLUMN "size_chart_id" uuid;--> statement-breakpoint
ALTER TABLE "store"."products" ADD COLUMN "custom_size_chart" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "size_charts_name_lower_idx" ON "store"."size_charts" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "store"."products" ADD CONSTRAINT "products_size_chart_id_size_charts_id_fk" FOREIGN KEY ("size_chart_id") REFERENCES "store"."size_charts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "store"."size_charts" ENABLE ROW LEVEL SECURITY;
