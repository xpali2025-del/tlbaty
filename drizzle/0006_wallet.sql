CREATE TYPE "store"."wallet_topup_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "store"."wallet_txn_kind" AS ENUM('topup', 'order_payment', 'order_refund', 'admin_credit', 'admin_debit');--> statement-breakpoint
ALTER TYPE "store"."payment_method" ADD VALUE 'wallet';--> statement-breakpoint
CREATE TABLE "store"."wallet_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store"."wallet_topups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "store"."wallet_topup_status" DEFAULT 'pending' NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency_code" text NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"amount_base" numeric(14, 2) NOT NULL,
	"payment_account_snapshot" jsonb,
	"sender_name" text NOT NULL,
	"sender_phone" text NOT NULL,
	"reference" text NOT NULL,
	"reference_used_on_order" boolean DEFAULT false NOT NULL,
	"credited_amount_base" numeric(14, 2),
	"rejection_reason" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_topups_amount_positive" CHECK ("store"."wallet_topups"."amount" > 0 and "store"."wallet_topups"."amount_base" > 0 and "store"."wallet_topups"."rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "store"."wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" "store"."wallet_txn_kind" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"balance_after" numeric(14, 2) NOT NULL,
	"order_id" uuid,
	"topup_id" uuid,
	"note" text,
	"reason" text,
	"actor" text NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_transactions_amount_nonzero" CHECK ("store"."wallet_transactions"."amount" <> 0),
	CONSTRAINT "wallet_transactions_balance_nonneg" CHECK ("store"."wallet_transactions"."balance_after" >= 0),
	CONSTRAINT "wallet_transactions_sign" CHECK (("store"."wallet_transactions"."kind" in ('topup','order_refund','admin_credit') and "store"."wallet_transactions"."amount" > 0) or ("store"."wallet_transactions"."kind" in ('order_payment','admin_debit') and "store"."wallet_transactions"."amount" < 0)),
	CONSTRAINT "wallet_transactions_admin_reason" CHECK ("store"."wallet_transactions"."kind" not in ('admin_credit','admin_debit') or length(trim(coalesce("store"."wallet_transactions"."reason", ''))) >= 3)
);
--> statement-breakpoint
CREATE TABLE "store"."wallets" (
	"customer_id" uuid PRIMARY KEY NOT NULL,
	"balance" numeric(14, 2) DEFAULT 0 NOT NULL,
	"frozen" boolean DEFAULT false NOT NULL,
	"frozen_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_balance_nonneg" CHECK ("store"."wallets"."balance" >= 0)
);
--> statement-breakpoint
ALTER TABLE "store"."site_settings" ADD COLUMN "wallet_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "store"."wallet_audit_log" ADD CONSTRAINT "wallet_audit_log_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "store"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."wallet_topups" ADD CONSTRAINT "wallet_topups_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "store"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."wallet_transactions" ADD CONSTRAINT "wallet_transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "store"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."wallet_transactions" ADD CONSTRAINT "wallet_transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "store"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."wallet_transactions" ADD CONSTRAINT "wallet_transactions_topup_id_wallet_topups_id_fk" FOREIGN KEY ("topup_id") REFERENCES "store"."wallet_topups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store"."wallets" ADD CONSTRAINT "wallets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "store"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_audit_customer_idx" ON "store"."wallet_audit_log" USING btree ("customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "wallet_audit_action_idx" ON "store"."wallet_audit_log" USING btree ("action","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "wallet_topups_customer_idx" ON "store"."wallet_topups" USING btree ("customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "wallet_topups_status_idx" ON "store"."wallet_topups" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_topups_live_reference_idx" ON "store"."wallet_topups" USING btree ("reference") WHERE "store"."wallet_topups"."status" in ('pending','approved');--> statement-breakpoint
CREATE INDEX "wallet_transactions_customer_idx" ON "store"."wallet_transactions" USING btree ("customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_transactions_idempotency_idx" ON "store"."wallet_transactions" USING btree ("customer_id","idempotency_key") WHERE "store"."wallet_transactions"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_transactions_order_kind_idx" ON "store"."wallet_transactions" USING btree ("order_id","kind") WHERE "store"."wallet_transactions"."order_id" is not null and "store"."wallet_transactions"."kind" in ('order_payment','order_refund');
--> statement-breakpoint
ALTER TABLE "store"."wallets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."wallet_topups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."wallet_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store"."wallet_audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The ledger and audit log are append-only: no DELETE and no changing of recorded values, not even for the server role.
-- The only allowed UPDATE on the ledger is the FK action ON DELETE SET NULL (deleting an order/top-up detaches the link).
CREATE FUNCTION "store"."wallet_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'wallet ledger is append-only (%)', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "store"."wallet_ledger_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.id, NEW.customer_id, NEW.kind, NEW.amount, NEW.balance_after, NEW.note, NEW.reason, NEW.actor, NEW.idempotency_key, NEW.created_at)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.customer_id, OLD.kind, OLD.amount, OLD.balance_after, OLD.note, OLD.reason, OLD.actor, OLD.idempotency_key, OLD.created_at)
     AND (NEW.order_id IS NULL OR NEW.order_id IS NOT DISTINCT FROM OLD.order_id)
     AND (NEW.topup_id IS NULL OR NEW.topup_id IS NOT DISTINCT FROM OLD.topup_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'wallet ledger is append-only (%)', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "wallet_transactions_append_only" BEFORE UPDATE OR DELETE ON "store"."wallet_transactions" FOR EACH ROW EXECUTE FUNCTION "store"."wallet_ledger_guard"();--> statement-breakpoint
CREATE TRIGGER "wallet_audit_log_append_only" BEFORE UPDATE OR DELETE ON "store"."wallet_audit_log" FOR EACH ROW EXECUTE FUNCTION "store"."wallet_append_only"();
