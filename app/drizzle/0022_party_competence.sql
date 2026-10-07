CREATE TABLE "party_competence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"party_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"reference" text,
	"issuer" text,
	"valid_from" date,
	"valid_until" date,
	"document_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_competence_kind_check" CHECK ("party_competence"."kind" in ('registration','qualification','insurance','authorization','other')),
	CONSTRAINT "party_competence_dates_check" CHECK ("party_competence"."valid_from" is null or "party_competence"."valid_until" is null or "party_competence"."valid_until" >= "party_competence"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "party_competence" ADD CONSTRAINT "party_competence_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_competence" ADD CONSTRAINT "party_competence_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "party_competence_party_idx" ON "party_competence" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "party_competence_document_idx" ON "party_competence" USING btree ("document_id");