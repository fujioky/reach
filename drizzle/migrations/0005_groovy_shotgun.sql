CREATE TABLE "visit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" uuid NOT NULL,
	"visitor_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"ts" timestamp DEFAULT now() NOT NULL,
	"ua" text,
	"ip_hash" text
);
--> statement-breakpoint
ALTER TABLE "visit_events" ADD CONSTRAINT "visit_events_share_id_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visit_events_share_ts_idx" ON "visit_events" USING btree ("share_id","ts");--> statement-breakpoint
CREATE INDEX "visit_events_share_type_idx" ON "visit_events" USING btree ("share_id","type");