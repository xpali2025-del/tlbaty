CREATE TABLE "store"."login_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"browser_secret_hash" text NOT NULL,
	"phone" text,
	"claimed_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_challenges_token_unique" UNIQUE("token"),
	CONSTRAINT "login_challenges_browser_secret_hash_unique" UNIQUE("browser_secret_hash"),
	CONSTRAINT "login_challenges_claim_consistent" CHECK (("store"."login_challenges"."claimed_at" is null) = ("store"."login_challenges"."phone" is null))
);
--> statement-breakpoint
CREATE INDEX "login_challenges_expiry_idx" ON "store"."login_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "login_challenges_ip_idx" ON "store"."login_challenges" USING btree ("ip","created_at" DESC NULLS LAST) WHERE "store"."login_challenges"."ip" is not null;