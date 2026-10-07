CREATE TABLE "condo_unit_other" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_id" uuid NOT NULL,
	"label" text NOT NULL,
	"value" numeric(12, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "condo_unit_other_value_check" CHECK ("condo_unit_other"."value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "condo_budget" ADD COLUMN "scope" text DEFAULT 'owner_only' NOT NULL;--> statement-breakpoint
ALTER TABLE "condo_unit_other" ADD CONSTRAINT "condo_unit_other_table_id_millesimal_table_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."millesimal_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "condo_unit_other_table_idx" ON "condo_unit_other" USING btree ("table_id");--> statement-breakpoint
ALTER TABLE "condo_budget" ADD CONSTRAINT "condo_budget_scope_check" CHECK ("condo_budget"."scope" in ('building','owner_only'));