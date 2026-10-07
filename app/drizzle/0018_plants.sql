CREATE TABLE "plant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"installed_on" date,
	"installer_party_id" uuid,
	"maintainer_party_id" uuid,
	"serial_number" text,
	"note" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plant_kind_check" CHECK ("plant"."kind" in ('solar','electrical','lift','fire','cooling','gas','heating','water','other'))
);
--> statement-breakpoint
CREATE TABLE "plant_document" (
	"plant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	CONSTRAINT "plant_document_plant_id_document_id_pk" PRIMARY KEY("plant_id","document_id")
);
--> statement-breakpoint
ALTER TABLE "maint_inspection_plan" ADD COLUMN "plant_id" uuid;--> statement-breakpoint
ALTER TABLE "maint_warranty" ADD COLUMN "plant_id" uuid;--> statement-breakpoint
ALTER TABLE "maint_work" ADD COLUMN "plant_id" uuid;--> statement-breakpoint
ALTER TABLE "plant" ADD CONSTRAINT "plant_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant" ADD CONSTRAINT "plant_installer_party_id_party_id_fk" FOREIGN KEY ("installer_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant" ADD CONSTRAINT "plant_maintainer_party_id_party_id_fk" FOREIGN KEY ("maintainer_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_document" ADD CONSTRAINT "plant_document_plant_id_plant_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."plant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_document" ADD CONSTRAINT "plant_document_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plant_asset_idx" ON "plant" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "plant_installer_party_idx" ON "plant" USING btree ("installer_party_id");--> statement-breakpoint
CREATE INDEX "plant_maintainer_party_idx" ON "plant" USING btree ("maintainer_party_id");--> statement-breakpoint
CREATE INDEX "plant_document_document_idx" ON "plant_document" USING btree ("document_id");--> statement-breakpoint
ALTER TABLE "maint_inspection_plan" ADD CONSTRAINT "maint_inspection_plan_plant_id_plant_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."plant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_warranty" ADD CONSTRAINT "maint_warranty_plant_id_plant_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."plant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_work" ADD CONSTRAINT "maint_work_plant_id_plant_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."plant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maint_inspection_plan_plant_idx" ON "maint_inspection_plan" USING btree ("plant_id");--> statement-breakpoint
CREATE INDEX "maint_warranty_plant_idx" ON "maint_warranty" USING btree ("plant_id");--> statement-breakpoint
CREATE INDEX "maint_work_plant_idx" ON "maint_work" USING btree ("plant_id");