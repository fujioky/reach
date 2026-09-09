CREATE TABLE "analytics_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"events" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"content_item_id" uuid NOT NULL,
	"share_id" uuid,
	"visitor_id" text NOT NULL,
	"ip" text,
	"ua" text,
	"screen_w" integer,
	"screen_h" integer,
	"viewport_w" integer,
	"viewport_h" integer,
	"dpr_x100" integer,
	"lang" text,
	"referrer" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_event_at" timestamp DEFAULT now() NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visit_events" ALTER COLUMN "share_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "visit_events" ADD COLUMN "content_item_id" uuid;--> statement-breakpoint
ALTER TABLE "visit_events" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "visit_events" ADD COLUMN "ip" text;--> statement-breakpoint
ALTER TABLE "analytics_chunks" ADD CONSTRAINT "analytics_chunks_session_id_analytics_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."analytics_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_sessions" ADD CONSTRAINT "analytics_sessions_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_sessions" ADD CONSTRAINT "analytics_sessions_share_id_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_chunks_session_seq_unique" ON "analytics_chunks" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX "analytics_sessions_content_started_idx" ON "analytics_sessions" USING btree ("content_item_id","started_at");--> statement-breakpoint
CREATE INDEX "analytics_sessions_started_idx" ON "analytics_sessions" USING btree ("started_at");--> statement-breakpoint
ALTER TABLE "visit_events" ADD CONSTRAINT "visit_events_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visit_events_content_ts_idx" ON "visit_events" USING btree ("content_item_id","ts");--> statement-breakpoint
CREATE INDEX "visit_events_content_type_idx" ON "visit_events" USING btree ("content_item_id","type");--> statement-breakpoint
CREATE INDEX "visit_events_session_idx" ON "visit_events" USING btree ("session_id");--> statement-breakpoint
UPDATE "visit_events" ve SET "content_item_id" = s."content_item_id" FROM "shares" s WHERE ve."share_id" = s."id" AND ve."content_item_id" IS NULL;