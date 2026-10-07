CREATE TABLE "ins_claim_document" (
	"claim_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"role" text DEFAULT 'other' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ins_claim_document_claim_id_document_id_pk" PRIMARY KEY("claim_id","document_id"),
	CONSTRAINT "ins_claim_document_role_check" CHECK ("ins_claim_document"."role" in ('photo','appraisal','invoice','other'))
);
--> statement-breakpoint
ALTER TABLE "ins_claim_document" ADD CONSTRAINT "ins_claim_document_claim_id_ins_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."ins_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ins_claim_document" ADD CONSTRAINT "ins_claim_document_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ins_claim_document_document_idx" ON "ins_claim_document" USING btree ("document_id");