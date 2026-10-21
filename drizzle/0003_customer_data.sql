CREATE TABLE "store"."customer_data" (
	"customer_id" uuid PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store"."customer_data" ADD CONSTRAINT "customer_data_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "store"."customers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "store"."customer_data" ENABLE ROW LEVEL SECURITY;
