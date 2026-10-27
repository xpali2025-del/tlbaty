ALTER TABLE "store"."ads" ADD COLUMN "kind" text DEFAULT 'image' NOT NULL;--> statement-breakpoint
ALTER TABLE "store"."ads" ADD COLUMN "video_key" text;--> statement-breakpoint
ALTER TABLE "store"."ads" ADD COLUMN "placements" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "store"."ads" ADD COLUMN "starts_on" date;--> statement-breakpoint
ALTER TABLE "store"."ads" ADD COLUMN "ends_on" date;--> statement-breakpoint
ALTER TABLE "store"."ads" ADD CONSTRAINT "ads_kind_valid" CHECK ("store"."ads"."kind" in ('image', 'video'));--> statement-breakpoint
ALTER TABLE "store"."ads" ADD CONSTRAINT "ads_video_needs_key" CHECK ("store"."ads"."kind" <> 'video' or "store"."ads"."video_key" is not null);--> statement-breakpoint
ALTER TABLE "store"."ads" ADD CONSTRAINT "ads_placements_valid" CHECK ("store"."ads"."placements" <@ array['home_new','home_bestsellers','home_offers','home_categories','grid','category']::text[]);--> statement-breakpoint
ALTER TABLE "store"."ads" ADD CONSTRAINT "ads_dates_order" CHECK ("store"."ads"."starts_on" is null or "store"."ads"."ends_on" is null or "store"."ads"."starts_on" <= "store"."ads"."ends_on");