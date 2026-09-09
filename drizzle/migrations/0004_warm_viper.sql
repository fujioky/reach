CREATE TABLE "mirror_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_item_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mirror_versions" ADD CONSTRAINT "mirror_versions_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mirror_versions_content_item_version_unique" ON "mirror_versions" USING btree ("content_item_id","version_number");--> statement-breakpoint
CREATE INDEX "mirror_versions_content_item_id_idx" ON "mirror_versions" USING btree ("content_item_id");