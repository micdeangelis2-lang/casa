CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"category_id" uuid NOT NULL,
	"confidentiality" text DEFAULT 'ordinary' NOT NULL,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_confidentiality_check" CHECK ("document"."confidentiality" in ('ordinary','reserved','highly_reserved'))
);
--> statement-breakpoint
CREATE TABLE "document_asset" (
	"document_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "document_asset_document_id_asset_id_pk" PRIMARY KEY("document_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "document_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"file_object_id" uuid NOT NULL,
	"original_filename" text NOT NULL,
	"issued_on" date,
	"valid_from" date,
	"valid_to" date,
	"issuer_party_id" uuid,
	"verification_status" text DEFAULT 'to_verify' NOT NULL,
	"note" text,
	"extracted_text" text,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('italian', coalesce(extracted_text, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_version_verification_check" CHECK ("document_version"."verification_status" in ('draft','to_verify','verified_by_owner','validated_by_professional'))
);
--> statement-breakpoint
CREATE TABLE "file_object" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"mime_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_category_id_document_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."document_category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_asset" ADD CONSTRAINT "document_asset_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_asset" ADD CONSTRAINT "document_asset_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_category" ADD CONSTRAINT "document_category_parent_id_document_category_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."document_category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_file_object_id_file_object_id_fk" FOREIGN KEY ("file_object_id") REFERENCES "public"."file_object"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_issuer_party_id_party_id_fk" FOREIGN KEY ("issuer_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_title_idx" ON "document" USING btree ("title");--> statement-breakpoint
CREATE INDEX "document_category_idx" ON "document" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "document_asset_asset_idx" ON "document_asset" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_category_code_uq" ON "document_category" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "document_version_no_uq" ON "document_version" USING btree ("document_id","version_no");--> statement-breakpoint
CREATE INDEX "document_version_search_idx" ON "document_version" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "document_version_issuer_idx" ON "document_version" USING btree ("issuer_party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_object_key_uq" ON "file_object" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "file_object_sha_idx" ON "file_object" USING btree ("sha256");--> statement-breakpoint
-- Categorie di partenza (dati, modificabili): generiche, senza valore normativo.
INSERT INTO "document_category" ("code", "name", "position") VALUES
	('title_deed', 'Titolo di proprietà (atti, successioni, donazioni)', 10),
	('cadastral', 'Catasto (visure, planimetrie, elaborati)', 20),
	('building', 'Urbanistica e edilizia (titoli edilizi, agibilità, conformità)', 30),
	('systems', 'Impianti e certificazioni', 40),
	('energy', 'Prestazione energetica', 50),
	('condominium', 'Condominio (verbali, regolamento, tabelle millesimali)', 60),
	('taxes', 'Tributi e imposte', 70),
	('insurance', 'Assicurazioni', 80),
	('leases', 'Contratti di locazione e utenze', 90),
	('works', 'Lavori, manutenzioni e fatture', 100),
	('correspondence', 'Corrispondenza e pratiche', 110),
	('other', 'Altro', 999);
