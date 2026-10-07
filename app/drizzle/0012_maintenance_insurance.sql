CREATE TABLE "maint_inspection_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"title" text NOT NULL,
	"interval_months" integer NOT NULL,
	"first_due_on" date NOT NULL,
	"supplier_party_id" uuid,
	"note" text,
	"deadline_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maint_inspection_interval_check" CHECK ("maint_inspection_plan"."interval_months" between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "maint_invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"number" text,
	"issued_on" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"paid_on" date,
	"document_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maint_invoice_amount_check" CHECK ("maint_invoice"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "maint_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"recorded_on" date NOT NULL,
	"percent" smallint,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maint_progress_percent_check" CHECK ("maint_progress"."percent" is null or ("maint_progress"."percent" between 0 and 100))
);
--> statement-breakpoint
CREATE TABLE "maint_quote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"supplier_party_id" uuid,
	"amount_cents" bigint NOT NULL,
	"quoted_on" date,
	"valid_until" date,
	"status" text DEFAULT 'received' NOT NULL,
	"document_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maint_quote_status_check" CHECK ("maint_quote"."status" in ('received','accepted','rejected')),
	CONSTRAINT "maint_quote_amount_check" CHECK ("maint_quote"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "maint_warranty" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"work_id" uuid,
	"title" text NOT NULL,
	"starts_on" date,
	"ends_on" date NOT NULL,
	"supplier_party_id" uuid,
	"document_id" uuid,
	"note" text,
	"deadline_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maint_warranty_dates_check" CHECK ("maint_warranty"."starts_on" is null or "maint_warranty"."ends_on" >= "maint_warranty"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "maint_work" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"supplier_party_id" uuid,
	"scheduled_on" date,
	"started_on" date,
	"completed_on" date,
	"budget_cents" bigint,
	"note" text,
	"deadline_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maint_work_status_check" CHECK ("maint_work"."status" in ('planned','quoted','approved','in_progress','completed','cancelled')),
	CONSTRAINT "maint_work_budget_check" CHECK ("maint_work"."budget_cents" is null or "maint_work"."budget_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ins_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"asset_id" uuid,
	"title" text NOT NULL,
	"claim_number" text,
	"occurred_on" date NOT NULL,
	"reported_on" date,
	"status" text DEFAULT 'open' NOT NULL,
	"claimed_cents" bigint,
	"received_cents" bigint,
	"adjuster_party_id" uuid,
	"matter_id" uuid,
	"description" text,
	"closed_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ins_claim_status_check" CHECK ("ins_claim"."status" in ('open','reported','in_review','settled','closed')),
	CONSTRAINT "ins_claim_amounts_check" CHECK (("ins_claim"."claimed_cents" is null or "ins_claim"."claimed_cents" >= 0) and ("ins_claim"."received_cents" is null or "ins_claim"."received_cents" >= 0))
);
--> statement-breakpoint
CREATE TABLE "ins_claim_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"entry_on" date NOT NULL,
	"direction" text DEFAULT 'note' NOT NULL,
	"summary" text NOT NULL,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ins_claim_entry_direction_check" CHECK ("ins_claim_entry"."direction" in ('sent','received','note'))
);
--> statement-breakpoint
CREATE TABLE "ins_coverage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"title" text NOT NULL,
	"sum_insured_cents" bigint,
	"deductible_cents" bigint,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ins_coverage_amounts_check" CHECK (("ins_coverage"."sum_insured_cents" is null or "ins_coverage"."sum_insured_cents" >= 0) and ("ins_coverage"."deductible_cents" is null or "ins_coverage"."deductible_cents" >= 0))
);
--> statement-breakpoint
CREATE TABLE "ins_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"insurer_party_id" uuid,
	"agent_party_id" uuid,
	"policy_number" text,
	"starts_on" date,
	"ends_on" date,
	"premium_cents" bigint,
	"note" text,
	"document_id" uuid,
	"deadline_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ins_policy_dates_check" CHECK ("ins_policy"."starts_on" is null or "ins_policy"."ends_on" is null or "ins_policy"."ends_on" >= "ins_policy"."starts_on"),
	CONSTRAINT "ins_policy_premium_check" CHECK ("ins_policy"."premium_cents" is null or "ins_policy"."premium_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ins_policy_asset" (
	"policy_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "ins_policy_asset_policy_id_asset_id_pk" PRIMARY KEY("policy_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "ins_premium" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"paid_on" date,
	"document_id" uuid,
	"deadline_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ins_premium_amount_check" CHECK ("ins_premium"."amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "maint_inspection_plan" ADD CONSTRAINT "maint_inspection_plan_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_inspection_plan" ADD CONSTRAINT "maint_inspection_plan_supplier_party_id_party_id_fk" FOREIGN KEY ("supplier_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_inspection_plan" ADD CONSTRAINT "maint_inspection_plan_deadline_id_deadline_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadline"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_invoice" ADD CONSTRAINT "maint_invoice_work_id_maint_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."maint_work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_invoice" ADD CONSTRAINT "maint_invoice_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_progress" ADD CONSTRAINT "maint_progress_work_id_maint_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."maint_work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_quote" ADD CONSTRAINT "maint_quote_work_id_maint_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."maint_work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_quote" ADD CONSTRAINT "maint_quote_supplier_party_id_party_id_fk" FOREIGN KEY ("supplier_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_quote" ADD CONSTRAINT "maint_quote_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_warranty" ADD CONSTRAINT "maint_warranty_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_warranty" ADD CONSTRAINT "maint_warranty_work_id_maint_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."maint_work"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_warranty" ADD CONSTRAINT "maint_warranty_supplier_party_id_party_id_fk" FOREIGN KEY ("supplier_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_warranty" ADD CONSTRAINT "maint_warranty_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_warranty" ADD CONSTRAINT "maint_warranty_deadline_id_deadline_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadline"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_work" ADD CONSTRAINT "maint_work_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_work" ADD CONSTRAINT "maint_work_supplier_party_id_party_id_fk" FOREIGN KEY ("supplier_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_work" ADD CONSTRAINT "maint_work_deadline_id_deadline_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadline"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ins_claim" ADD CONSTRAINT "ins_claim_policy_id_ins_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."ins_policy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ins_claim" ADD CONSTRAINT "ins_claim_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ins_claim" ADD CONSTRAINT "ins_claim_adjuster_party_id_party_id_fk" FOREIGN KEY ("adjuster_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ins_claim" ADD CONSTRAINT "ins_claim_matter_id_matter_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matter"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ins_claim_entry" ADD CONSTRAINT "ins_claim_entry_claim_id_ins_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."ins_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ins_claim_entry" ADD CONSTRAINT "ins_claim_entry_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ins_coverage" ADD CONSTRAINT "ins_coverage_policy_id_ins_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."ins_policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ins_policy" ADD CONSTRAINT "ins_policy_insurer_party_id_party_id_fk" FOREIGN KEY ("insurer_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ins_policy" ADD CONSTRAINT "ins_policy_agent_party_id_party_id_fk" FOREIGN KEY ("agent_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ins_policy" ADD CONSTRAINT "ins_policy_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ins_policy" ADD CONSTRAINT "ins_policy_deadline_id_deadline_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadline"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ins_policy_asset" ADD CONSTRAINT "ins_policy_asset_policy_id_ins_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."ins_policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ins_policy_asset" ADD CONSTRAINT "ins_policy_asset_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ins_premium" ADD CONSTRAINT "ins_premium_policy_id_ins_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."ins_policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ins_premium" ADD CONSTRAINT "ins_premium_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ins_premium" ADD CONSTRAINT "ins_premium_deadline_id_deadline_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadline"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maint_inspection_asset_idx" ON "maint_inspection_plan" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "maint_invoice_work_idx" ON "maint_invoice" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "maint_progress_work_idx" ON "maint_progress" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "maint_quote_work_idx" ON "maint_quote" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "maint_warranty_asset_idx" ON "maint_warranty" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "maint_work_asset_idx" ON "maint_work" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "maint_work_status_idx" ON "maint_work" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ins_claim_policy_idx" ON "ins_claim" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "ins_claim_entry_claim_idx" ON "ins_claim_entry" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "ins_coverage_policy_idx" ON "ins_coverage" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "ins_policy_ends_idx" ON "ins_policy" USING btree ("ends_on");--> statement-breakpoint
CREATE INDEX "ins_premium_policy_idx" ON "ins_premium" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "ins_premium_due_idx" ON "ins_premium" USING btree ("due_on");