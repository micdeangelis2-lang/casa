CREATE TABLE "engagement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"party_id" uuid NOT NULL,
	"asset_id" uuid,
	"matter_id" uuid,
	"subject" text NOT NULL,
	"engaged_on" date NOT NULL,
	"declared_fee_cents" bigint,
	"status" text DEFAULT 'active' NOT NULL,
	"document_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engagement_status_check" CHECK ("engagement"."status" in ('active','completed','cancelled')),
	CONSTRAINT "engagement_fee_check" CHECK ("engagement"."declared_fee_cents" is null or "engagement"."declared_fee_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "matter_deliverable" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"kind_label" text NOT NULL,
	"occurred_on" date NOT NULL,
	"document_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matter_deliverable_direction_check" CHECK ("matter_deliverable"."direction" in ('delivered','received'))
);
--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_matter_id_matter_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matter"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_deliverable" ADD CONSTRAINT "matter_deliverable_engagement_id_engagement_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_deliverable" ADD CONSTRAINT "matter_deliverable_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "engagement_party_idx" ON "engagement" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "engagement_asset_idx" ON "engagement" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "engagement_matter_idx" ON "engagement" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX "engagement_document_idx" ON "engagement" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "matter_deliverable_engagement_idx" ON "matter_deliverable" USING btree ("engagement_id","occurred_on");--> statement-breakpoint
CREATE INDEX "matter_deliverable_document_idx" ON "matter_deliverable" USING btree ("document_id");