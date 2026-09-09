CREATE TABLE "article_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_item_id" uuid NOT NULL,
	"author_name" text NOT NULL,
	"author_email" text,
	"body" text NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "excerpt" text;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "cover_image_url" text;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "comments_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_comments_content_item_idx" ON "article_comments" USING btree ("content_item_id","created_at");--> statement-breakpoint
CREATE INDEX "article_comments_ip_hash_idx" ON "article_comments" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_items_slug_unique" ON "content_items" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "content_items_type_status_idx" ON "content_items" USING btree ("type","status");