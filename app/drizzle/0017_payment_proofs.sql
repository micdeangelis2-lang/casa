CREATE TABLE "letting_rent_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rent_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"method" text,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "letting_rent_payment_amount_check" CHECK ("letting_rent_payment"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "condo_installment" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "tax_payment" ADD COLUMN "kind" text DEFAULT 'ordinary' NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_payment" ADD COLUMN "penalty_cents" bigint;--> statement-breakpoint
ALTER TABLE "tax_payment" ADD COLUMN "interest_cents" bigint;--> statement-breakpoint
ALTER TABLE "letting_rent_payment" ADD CONSTRAINT "letting_rent_payment_rent_id_letting_rent_id_fk" FOREIGN KEY ("rent_id") REFERENCES "public"."letting_rent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letting_rent_payment" ADD CONSTRAINT "letting_rent_payment_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "letting_rent_payment_rent_idx" ON "letting_rent_payment" USING btree ("rent_id","paid_on");--> statement-breakpoint
CREATE INDEX "letting_rent_payment_document_idx" ON "letting_rent_payment" USING btree ("document_id");--> statement-breakpoint
ALTER TABLE "condo_installment" ADD CONSTRAINT "condo_installment_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "condo_installment_document_idx" ON "condo_installment" USING btree ("document_id");--> statement-breakpoint
ALTER TABLE "tax_payment" ADD CONSTRAINT "tax_payment_kind_check" CHECK ("tax_payment"."kind" in ('ordinary','late_payment_correction','other'));--> statement-breakpoint
ALTER TABLE "tax_payment" ADD CONSTRAINT "tax_payment_extras_check" CHECK (("tax_payment"."penalty_cents" is null or "tax_payment"."penalty_cents" >= 0) and ("tax_payment"."interest_cents" is null or "tax_payment"."interest_cents" >= 0));
--> statement-breakpoint
-- Dati esistenti: ogni canone con un importo pagato registrato riceve il suo incasso (nessun dato si perde; paid_on mancante = scadenza del canone).
INSERT INTO "letting_rent_payment" ("rent_id", "paid_on", "amount_cents", "document_id")
SELECT "id", COALESCE("paid_on", "due_on"), "paid_cents", "document_id" FROM "letting_rent" WHERE "paid_cents" > 0;