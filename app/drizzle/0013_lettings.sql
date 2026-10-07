CREATE TABLE "letting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"manager_party_id" uuid,
	"monthly_rent_cents" bigint,
	"deposit_cents" bigint,
	"deposit_received_on" date,
	"deposit_returned_on" date,
	"deposit_returned_cents" bigint,
	"registered_on" date,
	"registration_number" text,
	"registration_office" text,
	"contract_document_id" uuid,
	"note" text,
	"deadline_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "letting_type_check" CHECK ("letting"."type" in ('residential','transitional','student','short_term','accommodation')),
	CONSTRAINT "letting_status_check" CHECK ("letting"."status" in ('planned','active','ended')),
	CONSTRAINT "letting_dates_check" CHECK ("letting"."starts_on" is null or "letting"."ends_on" is null or "letting"."ends_on" >= "letting"."starts_on"),
	CONSTRAINT "letting_amounts_check" CHECK (("letting"."monthly_rent_cents" is null or "letting"."monthly_rent_cents" >= 0) and ("letting"."deposit_cents" is null or "letting"."deposit_cents" >= 0) and ("letting"."deposit_returned_cents" is null or "letting"."deposit_returned_cents" >= 0))
);
--> statement-breakpoint
CREATE TABLE "letting_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"letting_id" uuid NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"issuer" text,
	"issued_on" date,
	"valid_until" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "letting_party" (
	"letting_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"role" text DEFAULT 'tenant' NOT NULL,
	CONSTRAINT "letting_party_letting_id_party_id_pk" PRIMARY KEY("letting_id","party_id"),
	CONSTRAINT "letting_party_role_check" CHECK ("letting_party"."role" in ('tenant','occupant','guarantor'))
);
--> statement-breakpoint
CREATE TABLE "letting_rent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"letting_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"paid_on" date,
	"paid_cents" bigint DEFAULT 0 NOT NULL,
	"document_id" uuid,
	"deadline_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "letting_rent_amount_check" CHECK ("letting_rent"."amount_cents" >= 0 and "letting_rent"."paid_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "letting_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"letting_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"period" text,
	"due_on" date,
	"amount_cents" bigint,
	"done_on" date,
	"document_id" uuid,
	"note" text,
	"deadline_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "letting_report_kind_check" CHECK ("letting_report"."kind" in ('communication','tourist_tax','statistics','other')),
	CONSTRAINT "letting_report_amount_check" CHECK ("letting_report"."amount_cents" is null or "letting_report"."amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "letting" ADD CONSTRAINT "letting_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letting" ADD CONSTRAINT "letting_manager_party_id_party_id_fk" FOREIGN KEY ("manager_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letting" ADD CONSTRAINT "letting_contract_document_id_document_id_fk" FOREIGN KEY ("contract_document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letting" ADD CONSTRAINT "letting_deadline_id_deadline_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadline"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letting_code" ADD CONSTRAINT "letting_code_letting_id_letting_id_fk" FOREIGN KEY ("letting_id") REFERENCES "public"."letting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letting_party" ADD CONSTRAINT "letting_party_letting_id_letting_id_fk" FOREIGN KEY ("letting_id") REFERENCES "public"."letting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letting_party" ADD CONSTRAINT "letting_party_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letting_rent" ADD CONSTRAINT "letting_rent_letting_id_letting_id_fk" FOREIGN KEY ("letting_id") REFERENCES "public"."letting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letting_rent" ADD CONSTRAINT "letting_rent_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letting_rent" ADD CONSTRAINT "letting_rent_deadline_id_deadline_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadline"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letting_report" ADD CONSTRAINT "letting_report_letting_id_letting_id_fk" FOREIGN KEY ("letting_id") REFERENCES "public"."letting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letting_report" ADD CONSTRAINT "letting_report_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letting_report" ADD CONSTRAINT "letting_report_deadline_id_deadline_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadline"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "letting_asset_idx" ON "letting" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "letting_status_idx" ON "letting" USING btree ("status");--> statement-breakpoint
CREATE INDEX "letting_code_letting_idx" ON "letting_code" USING btree ("letting_id");--> statement-breakpoint
CREATE INDEX "letting_rent_letting_idx" ON "letting_rent" USING btree ("letting_id","due_on");--> statement-breakpoint
CREATE INDEX "letting_report_letting_idx" ON "letting_report" USING btree ("letting_id");