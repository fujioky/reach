CREATE TABLE "refresh_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_item_id" uuid NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "translation_cache" (
	"text_hash" text NOT NULL,
	"target_lang" text NOT NULL,
	"source_text" text NOT NULL,
	"translated_text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "translation_cache_text_hash_target_lang_pk" PRIMARY KEY("text_hash","target_lang")
);
--> statement-breakpoint
ALTER TABLE "refresh_previews" ADD CONSTRAINT "refresh_previews_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_previews_content_item_id_idx" ON "refresh_previews" USING btree ("content_item_id");--> statement-breakpoint
CREATE INDEX "refresh_previews_expires_at_idx" ON "refresh_previews" USING btree ("expires_at");