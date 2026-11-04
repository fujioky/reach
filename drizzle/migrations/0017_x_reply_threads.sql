ALTER TABLE "comments" ADD COLUMN "in_reply_to" text;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "reply_count" integer DEFAULT 0 NOT NULL;