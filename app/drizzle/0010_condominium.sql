CREATE TABLE "condo_agenda_document" (
	"agenda_item_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	CONSTRAINT "condo_agenda_document_agenda_item_id_document_id_pk" PRIMARY KEY("agenda_item_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "condo_agenda_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"questions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "condo_budget" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"total_cents" bigint NOT NULL,
	"millesimal_table_id" uuid,
	"note" text,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "condo_budget_kind_check" CHECK ("condo_budget"."kind" in ('ordinary','extraordinary','final')),
	CONSTRAINT "condo_budget_total_check" CHECK ("condo_budget"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "condo_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"condominium_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_on" date NOT NULL,
	"closed_on" date,
	"matter_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "condo_claim_kind_check" CHECK ("condo_claim"."kind" in ('claim','dispute','report','communication')),
	CONSTRAINT "condo_claim_status_check" CHECK ("condo_claim"."status" in ('open','closed'))
);
--> statement-breakpoint
CREATE TABLE "condo_contract" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"condominium_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"counterparty_party_id" uuid,
	"valid_from" date,
	"valid_to" date,
	"document_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "condo_contract_kind_check" CHECK ("condo_contract"."kind" in ('contract','certification'))
);
--> statement-breakpoint
CREATE TABLE "condo_document" (
	"condominium_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	CONSTRAINT "condo_document_condominium_id_document_id_pk" PRIMARY KEY("condominium_id","document_id"),
	CONSTRAINT "condo_document_kind_check" CHECK ("condo_document"."kind" in ('regulation','millesimal','other'))
);
--> statement-breakpoint
CREATE TABLE "condo_fiscal_year" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"condominium_id" uuid NOT NULL,
	"label" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "condo_fiscal_year_dates_check" CHECK ("condo_fiscal_year"."ends_on" >= "condo_fiscal_year"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "condo_installment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"due_on" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"paid_cents" bigint DEFAULT 0 NOT NULL,
	"paid_on" date,
	"deadline_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "condo_installment_amount_check" CHECK ("condo_installment"."amount_cents" >= 0 and "condo_installment"."paid_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "condo_meeting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"condominium_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'convened' NOT NULL,
	"convened_on" date,
	"meeting_on" date NOT NULL,
	"location" text,
	"convocation_document_id" uuid,
	"minutes_document_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "condo_meeting_kind_check" CHECK ("condo_meeting"."kind" in ('ordinary','extraordinary')),
	CONSTRAINT "condo_meeting_status_check" CHECK ("condo_meeting"."status" in ('convened','held','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "condo_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"condominium_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"unit_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "condo_proxy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"delegate_party_id" uuid NOT NULL,
	"note" text,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "condo_resolution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"agenda_item_id" uuid,
	"title" text NOT NULL,
	"text" text,
	"outcome" text DEFAULT 'not_recorded' NOT NULL,
	"votes_for_milli" numeric(12, 4),
	"votes_against_milli" numeric(12, 4),
	"votes_abstain_milli" numeric(12, 4),
	"threshold_milli" numeric(12, 4),
	"threshold_note" text,
	"deadline_id" uuid,
	"budget_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "condo_resolution_outcome_check" CHECK ("condo_resolution"."outcome" in ('not_recorded','approved','rejected','postponed'))
);
--> statement-breakpoint
CREATE TABLE "condo_work" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"condominium_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"budget_cents" bigint,
	"resolution_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "condo_work_status_check" CHECK ("condo_work"."status" in ('planned','quoted','approved','in_progress','completed'))
);
--> statement-breakpoint
CREATE TABLE "condo_work_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"amount_cents" bigint,
	"entry_on" date,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "condo_work_entry_kind_check" CHECK ("condo_work_entry"."kind" in ('quote','progress','invoice'))
);
--> statement-breakpoint
CREATE TABLE "condominium" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"tax_code" text,
	"administrator_party_id" uuid,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "millesimal_share" (
	"table_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"value" numeric(12, 4) NOT NULL,
	CONSTRAINT "millesimal_share_table_id_asset_id_pk" PRIMARY KEY("table_id","asset_id"),
	CONSTRAINT "millesimal_share_value_check" CHECK ("millesimal_share"."value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "millesimal_table" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"condominium_id" uuid NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "condo_agenda_document" ADD CONSTRAINT "condo_agenda_document_agenda_item_id_condo_agenda_item_id_fk" FOREIGN KEY ("agenda_item_id") REFERENCES "public"."condo_agenda_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_agenda_document" ADD CONSTRAINT "condo_agenda_document_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_agenda_item" ADD CONSTRAINT "condo_agenda_item_meeting_id_condo_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."condo_meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_budget" ADD CONSTRAINT "condo_budget_fiscal_year_id_condo_fiscal_year_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."condo_fiscal_year"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_budget" ADD CONSTRAINT "condo_budget_millesimal_table_id_millesimal_table_id_fk" FOREIGN KEY ("millesimal_table_id") REFERENCES "public"."millesimal_table"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_budget" ADD CONSTRAINT "condo_budget_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_claim" ADD CONSTRAINT "condo_claim_condominium_id_condominium_id_fk" FOREIGN KEY ("condominium_id") REFERENCES "public"."condominium"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_claim" ADD CONSTRAINT "condo_claim_matter_id_matter_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matter"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_contract" ADD CONSTRAINT "condo_contract_condominium_id_condominium_id_fk" FOREIGN KEY ("condominium_id") REFERENCES "public"."condominium"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_contract" ADD CONSTRAINT "condo_contract_counterparty_party_id_party_id_fk" FOREIGN KEY ("counterparty_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_contract" ADD CONSTRAINT "condo_contract_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_document" ADD CONSTRAINT "condo_document_condominium_id_condominium_id_fk" FOREIGN KEY ("condominium_id") REFERENCES "public"."condominium"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_document" ADD CONSTRAINT "condo_document_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_fiscal_year" ADD CONSTRAINT "condo_fiscal_year_condominium_id_condominium_id_fk" FOREIGN KEY ("condominium_id") REFERENCES "public"."condominium"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_installment" ADD CONSTRAINT "condo_installment_budget_id_condo_budget_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."condo_budget"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_installment" ADD CONSTRAINT "condo_installment_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_installment" ADD CONSTRAINT "condo_installment_deadline_id_deadline_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadline"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_meeting" ADD CONSTRAINT "condo_meeting_condominium_id_condominium_id_fk" FOREIGN KEY ("condominium_id") REFERENCES "public"."condominium"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_meeting" ADD CONSTRAINT "condo_meeting_convocation_document_id_document_id_fk" FOREIGN KEY ("convocation_document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_meeting" ADD CONSTRAINT "condo_meeting_minutes_document_id_document_id_fk" FOREIGN KEY ("minutes_document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_membership" ADD CONSTRAINT "condo_membership_condominium_id_condominium_id_fk" FOREIGN KEY ("condominium_id") REFERENCES "public"."condominium"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_membership" ADD CONSTRAINT "condo_membership_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_proxy" ADD CONSTRAINT "condo_proxy_meeting_id_condo_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."condo_meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_proxy" ADD CONSTRAINT "condo_proxy_delegate_party_id_party_id_fk" FOREIGN KEY ("delegate_party_id") REFERENCES "public"."party"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_proxy" ADD CONSTRAINT "condo_proxy_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_resolution" ADD CONSTRAINT "condo_resolution_meeting_id_condo_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."condo_meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_resolution" ADD CONSTRAINT "condo_resolution_agenda_item_id_condo_agenda_item_id_fk" FOREIGN KEY ("agenda_item_id") REFERENCES "public"."condo_agenda_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_resolution" ADD CONSTRAINT "condo_resolution_deadline_id_deadline_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadline"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_resolution" ADD CONSTRAINT "condo_resolution_budget_id_condo_budget_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."condo_budget"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_work" ADD CONSTRAINT "condo_work_condominium_id_condominium_id_fk" FOREIGN KEY ("condominium_id") REFERENCES "public"."condominium"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_work" ADD CONSTRAINT "condo_work_resolution_id_condo_resolution_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "public"."condo_resolution"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_work_entry" ADD CONSTRAINT "condo_work_entry_work_id_condo_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."condo_work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_work_entry" ADD CONSTRAINT "condo_work_entry_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condominium" ADD CONSTRAINT "condominium_administrator_party_id_party_id_fk" FOREIGN KEY ("administrator_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "millesimal_share" ADD CONSTRAINT "millesimal_share_table_id_millesimal_table_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."millesimal_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "millesimal_share" ADD CONSTRAINT "millesimal_share_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "millesimal_table" ADD CONSTRAINT "millesimal_table_condominium_id_condominium_id_fk" FOREIGN KEY ("condominium_id") REFERENCES "public"."condominium"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "condo_agenda_item_uq" ON "condo_agenda_item" USING btree ("meeting_id","position");--> statement-breakpoint
CREATE INDEX "condo_budget_year_idx" ON "condo_budget" USING btree ("fiscal_year_id");--> statement-breakpoint
CREATE INDEX "condo_claim_condo_idx" ON "condo_claim" USING btree ("condominium_id");--> statement-breakpoint
CREATE INDEX "condo_contract_condo_idx" ON "condo_contract" USING btree ("condominium_id");--> statement-breakpoint
CREATE INDEX "condo_fiscal_year_condo_idx" ON "condo_fiscal_year" USING btree ("condominium_id");--> statement-breakpoint
CREATE UNIQUE INDEX "condo_installment_uq" ON "condo_installment" USING btree ("budget_id","asset_id","number");--> statement-breakpoint
CREATE INDEX "condo_installment_due_idx" ON "condo_installment" USING btree ("due_on");--> statement-breakpoint
CREATE INDEX "condo_meeting_condo_idx" ON "condo_meeting" USING btree ("condominium_id");--> statement-breakpoint
CREATE UNIQUE INDEX "condo_membership_asset_uq" ON "condo_membership" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "condo_membership_condo_idx" ON "condo_membership" USING btree ("condominium_id");--> statement-breakpoint
CREATE INDEX "condo_proxy_meeting_idx" ON "condo_proxy" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "condo_resolution_meeting_idx" ON "condo_resolution" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "condo_work_condo_idx" ON "condo_work" USING btree ("condominium_id");--> statement-breakpoint
CREATE INDEX "condo_work_entry_work_idx" ON "condo_work_entry" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "condominium_name_idx" ON "condominium" USING btree ("name");--> statement-breakpoint
CREATE INDEX "millesimal_table_condo_idx" ON "millesimal_table" USING btree ("condominium_id");