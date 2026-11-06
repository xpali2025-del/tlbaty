ALTER TYPE "store"."auth_event_type" ADD VALUE 'profile_completed';--> statement-breakpoint
ALTER TYPE "store"."auth_event_type" ADD VALUE 'password_set';--> statement-breakpoint
ALTER TYPE "store"."auth_event_type" ADD VALUE 'password_login';--> statement-breakpoint
ALTER TYPE "store"."auth_event_type" ADD VALUE 'password_failed';--> statement-breakpoint
ALTER TYPE "store"."auth_event_type" ADD VALUE 'puk_requested';--> statement-breakpoint
ALTER TYPE "store"."auth_event_type" ADD VALUE 'puk_issued';--> statement-breakpoint
ALTER TYPE "store"."auth_event_type" ADD VALUE 'puk_used';--> statement-breakpoint
ALTER TYPE "store"."auth_event_type" ADD VALUE 'puk_failed';--> statement-breakpoint
ALTER TYPE "store"."auth_event_type" ADD VALUE 'puk_revoked';--> statement-breakpoint
ALTER TYPE "store"."auth_event_type" ADD VALUE 'deletion_requested';--> statement-breakpoint
ALTER TYPE "store"."auth_event_type" ADD VALUE 'deletion_cancelled';--> statement-breakpoint
ALTER TYPE "store"."auth_event_type" ADD VALUE 'account_deleted';--> statement-breakpoint
ALTER TYPE "store"."customer_status" ADD VALUE 'deleted';--> statement-breakpoint
ALTER TYPE "store"."otp_purpose" ADD VALUE 'delete_account';