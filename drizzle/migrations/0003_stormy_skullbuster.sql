CREATE TABLE "share_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" uuid NOT NULL,
	"visitor_cookie" text NOT NULL,
	"visitor_ip" text NOT NULL,
	"visited_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "max_views" integer;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "max_unique_visitors" integer;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "burn_after_read" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "view_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "unique_visitor_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "share_visits" ADD CONSTRAINT "share_visits_share_id_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "share_visits_share_id_idx" ON "share_visits" USING btree ("share_id");