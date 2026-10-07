CREATE TABLE "office_form_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"office_party_id" uuid NOT NULL,
	"name" text NOT NULL,
	"checklist" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" text,
	"verified_on" date,
	"verification_status" text DEFAULT 'to_verify' NOT NULL,
	"note" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_form_template_verification_check" CHECK ("office_form_template"."verification_status" in ('draft','to_verify','verified_by_owner','validated_by_professional'))
);
--> statement-breakpoint
ALTER TABLE "office_form_template" ADD CONSTRAINT "office_form_template_office_party_id_party_id_fk" FOREIGN KEY ("office_party_id") REFERENCES "public"."party"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "office_form_template_office_idx" ON "office_form_template" USING btree ("office_party_id");