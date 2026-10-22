CREATE TABLE "store"."product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"size" text DEFAULT '' NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_variants_stock_nonneg" CHECK ("store"."product_variants"."stock" >= 0)
);
--> statement-breakpoint
ALTER TABLE "store"."product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "store"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_unique_idx" ON "store"."product_variants" USING btree ("product_id","color","size");
--> statement-breakpoint
ALTER TABLE "store"."product_variants" ENABLE ROW LEVEL SECURITY;
