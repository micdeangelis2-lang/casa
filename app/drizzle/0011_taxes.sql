CREATE TABLE "tax_obligation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"tax_type_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"label" text,
	"due_on" date,
	"expected_cents" bigint,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_on" date,
	"closed_note" text,
	"ask_adviser" boolean DEFAULT false NOT NULL,
	"note" text,
	"deadline_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_obligation_status_check" CHECK ("tax_obligation"."status" in ('open','closed')),
	CONSTRAINT "tax_obligation_year_check" CHECK ("tax_obligation"."year" between 1900 and 2200),
	CONSTRAINT "tax_obligation_expected_check" CHECK ("tax_obligation"."expected_cents" is null or "tax_obligation"."expected_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tax_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"obligation_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"method" text DEFAULT 'other' NOT NULL,
	"reference" text,
	"document_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_payment_amount_check" CHECK ("tax_payment"."amount_cents" > 0),
	CONSTRAINT "tax_payment_method_check" CHECK ("tax_payment"."method" in ('bank_transfer','direct_debit','card','cash','payment_slip','other'))
);
--> statement-breakpoint
CREATE TABLE "tax_return" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"tax_type_id" uuid,
	"asset_id" uuid,
	"year" integer NOT NULL,
	"due_on" date,
	"filed_on" date,
	"protocol" text,
	"document_id" uuid,
	"ask_adviser" boolean DEFAULT false NOT NULL,
	"note" text,
	"deadline_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_return_year_check" CHECK ("tax_return"."year" between 1900 and 2200)
);
--> statement-breakpoint
CREATE TABLE "tax_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'tax' NOT NULL,
	"territory_id" uuid,
	"source" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_type_kind_check" CHECK ("tax_type"."kind" in ('tax','levy','due','other'))
);
--> statement-breakpoint
ALTER TABLE "tax_obligation" ADD CONSTRAINT "tax_obligation_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_obligation" ADD CONSTRAINT "tax_obligation_tax_type_id_tax_type_id_fk" FOREIGN KEY ("tax_type_id") REFERENCES "public"."tax_type"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_obligation" ADD CONSTRAINT "tax_obligation_deadline_id_deadline_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadline"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_payment" ADD CONSTRAINT "tax_payment_obligation_id_tax_obligation_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."tax_obligation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_payment" ADD CONSTRAINT "tax_payment_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_return" ADD CONSTRAINT "tax_return_tax_type_id_tax_type_id_fk" FOREIGN KEY ("tax_type_id") REFERENCES "public"."tax_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_return" ADD CONSTRAINT "tax_return_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_return" ADD CONSTRAINT "tax_return_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_return" ADD CONSTRAINT "tax_return_deadline_id_deadline_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadline"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_type" ADD CONSTRAINT "tax_type_territory_id_territory_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territory"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tax_obligation_asset_year_idx" ON "tax_obligation" USING btree ("asset_id","year");--> statement-breakpoint
CREATE INDEX "tax_obligation_year_idx" ON "tax_obligation" USING btree ("year");--> statement-breakpoint
CREATE INDEX "tax_payment_obligation_idx" ON "tax_payment" USING btree ("obligation_id");--> statement-breakpoint
CREATE INDEX "tax_return_year_idx" ON "tax_return" USING btree ("year");--> statement-breakpoint
CREATE INDEX "tax_type_name_idx" ON "tax_type" USING btree ("name");