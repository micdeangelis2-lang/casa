ALTER TABLE "asset" ADD COLUMN "declared_value_cents" bigint;--> statement-breakpoint
ALTER TABLE "ins_coverage" ADD COLUMN "asset_id" uuid;--> statement-breakpoint
ALTER TABLE "ins_coverage" ADD CONSTRAINT "ins_coverage_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ins_coverage_asset_idx" ON "ins_coverage" USING btree ("asset_id");--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_declared_value_check" CHECK ("asset"."declared_value_cents" is null or "asset"."declared_value_cents" >= 0);