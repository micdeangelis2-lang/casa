CREATE TABLE "asset_encumbrance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"registered_on" date,
	"ended_on" date,
	"beneficiary_party_id" uuid,
	"amount_cents" bigint,
	"reference" text,
	"document_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_encumbrance_kind_check" CHECK ("asset_encumbrance"."kind" in ('mortgage','easement','restriction','seizure','usage_right','other')),
	CONSTRAINT "asset_encumbrance_amount_check" CHECK ("asset_encumbrance"."amount_cents" is null or "asset_encumbrance"."amount_cents" >= 0),
	CONSTRAINT "asset_encumbrance_dates_check" CHECK ("asset_encumbrance"."registered_on" is null or "asset_encumbrance"."ended_on" is null or "asset_encumbrance"."ended_on" >= "asset_encumbrance"."registered_on")
);
--> statement-breakpoint
CREATE TABLE "asset_provenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"occurred_on" date,
	"from_party_id" uuid,
	"notary_party_id" uuid,
	"deed_reference" text,
	"document_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_provenance_kind_check" CHECK ("asset_provenance"."kind" in ('purchase','inheritance','donation','division','exchange','other'))
);
--> statement-breakpoint
ALTER TABLE "asset_encumbrance" ADD CONSTRAINT "asset_encumbrance_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_encumbrance" ADD CONSTRAINT "asset_encumbrance_beneficiary_party_id_party_id_fk" FOREIGN KEY ("beneficiary_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_encumbrance" ADD CONSTRAINT "asset_encumbrance_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_provenance" ADD CONSTRAINT "asset_provenance_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_provenance" ADD CONSTRAINT "asset_provenance_from_party_id_party_id_fk" FOREIGN KEY ("from_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_provenance" ADD CONSTRAINT "asset_provenance_notary_party_id_party_id_fk" FOREIGN KEY ("notary_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_provenance" ADD CONSTRAINT "asset_provenance_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_encumbrance_asset_idx" ON "asset_encumbrance" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_encumbrance_beneficiary_party_idx" ON "asset_encumbrance" USING btree ("beneficiary_party_id");--> statement-breakpoint
CREATE INDEX "asset_encumbrance_document_idx" ON "asset_encumbrance" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "asset_provenance_asset_idx" ON "asset_provenance" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_provenance_from_party_idx" ON "asset_provenance" USING btree ("from_party_id");--> statement-breakpoint
CREATE INDEX "asset_provenance_notary_party_idx" ON "asset_provenance" USING btree ("notary_party_id");--> statement-breakpoint
CREATE INDEX "asset_provenance_document_idx" ON "asset_provenance" USING btree ("document_id");