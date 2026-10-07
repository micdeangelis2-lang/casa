CREATE TABLE "dossier_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dossier_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'missing' NOT NULL,
	"origin" text NOT NULL,
	"rule_key" text,
	"outcome_key" text,
	"rule_version_id" uuid,
	"expected_document_category" text,
	"rule_note" text,
	"explanation" jsonb,
	"stale" boolean DEFAULT false NOT NULL,
	"owner_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dossier_item_status_check" CHECK ("dossier_item"."status" in ('present','missing','requested','to_verify','expired','superseded','not_applicable','validated_by_professional')),
	CONSTRAINT "dossier_item_origin_check" CHECK ("dossier_item"."origin" in ('manual','rule')),
	CONSTRAINT "dossier_item_rule_check" CHECK (("dossier_item"."origin" = 'rule') = ("dossier_item"."rule_key" is not null and "dossier_item"."outcome_key" is not null))
);
--> statement-breakpoint
CREATE TABLE "dossier_item_document" (
	"item_id" uuid NOT NULL,
	"document_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"level" text NOT NULL,
	"territory_id" uuid,
	"valid_from" date,
	"valid_to" date,
	"applies_when" jsonb,
	"outcomes" jsonb NOT NULL,
	"source_text" text NOT NULL,
	"source_url" text,
	"verification_status" text DEFAULT 'to_verify' NOT NULL,
	"change_note" text,
	"supersedes_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_version_level_check" CHECK ("rule_version"."level" in ('national','regional','municipal','condominium','contract')),
	CONSTRAINT "rule_version_verification_check" CHECK ("rule_version"."verification_status" in ('draft','to_verify','verified_by_owner','validated_by_professional'))
);
--> statement-breakpoint
ALTER TABLE "dossier_item" ADD CONSTRAINT "dossier_item_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_item" ADD CONSTRAINT "dossier_item_category_id_dossier_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."dossier_category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_item" ADD CONSTRAINT "dossier_item_rule_version_id_rule_version_id_fk" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_item_document" ADD CONSTRAINT "dossier_item_document_item_id_dossier_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."dossier_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_item_document" ADD CONSTRAINT "dossier_item_document_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_version" ADD CONSTRAINT "rule_version_rule_id_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rule"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_version" ADD CONSTRAINT "rule_version_territory_id_territory_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territory"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_version" ADD CONSTRAINT "rule_version_supersedes_version_id_rule_version_id_fk" FOREIGN KEY ("supersedes_version_id") REFERENCES "public"."rule_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dossier_category_code_uq" ON "dossier_category" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "dossier_item_rule_uq" ON "dossier_item" USING btree ("asset_id","rule_key","outcome_key") WHERE "dossier_item"."origin" = 'rule';--> statement-breakpoint
CREATE INDEX "dossier_item_asset_idx" ON "dossier_item" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dossier_item_document_uq" ON "dossier_item_document" USING btree ("item_id","document_id");--> statement-breakpoint
CREATE INDEX "dossier_item_document_doc_idx" ON "dossier_item_document" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_key_uq" ON "rule" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_version_no_uq" ON "rule_version" USING btree ("rule_id","version_no");--> statement-breakpoint
CREATE INDEX "rule_version_territory_idx" ON "rule_version" USING btree ("territory_id");
--> statement-breakpoint
-- Una versione di regola e' immutabile: cambiare una regola significa creare una nuova versione.
-- Fa eccezione solo lo stato di verifica (e' una revisione, non un cambio di contenuto). Nessuna versione si cancella.
CREATE FUNCTION rule_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'rule_version non si cancella (usa una nuova versione o disattiva la regola)'
			USING ERRCODE = 'integrity_constraint_violation';
	END IF;
	IF (to_jsonb(NEW) - 'verification_status') IS DISTINCT FROM (to_jsonb(OLD) - 'verification_status') THEN
		RAISE EXCEPTION 'rule_version e'' immutabile: solo verification_status puo'' cambiare'
			USING ERRCODE = 'integrity_constraint_violation';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER rule_version_guard BEFORE UPDATE OR DELETE ON rule_version
	FOR EACH ROW EXECUTE FUNCTION rule_version_guard();
--> statement-breakpoint
-- Categorie del dossier (dati di partenza, modificabili).
INSERT INTO "dossier_category" ("code", "name", "position") VALUES
	('title', 'Titolo, provenienza e diritti reali', 10),
	('cadastre', 'Catasto', 20),
	('building', 'Urbanistica ed edilizia', 30),
	('habitability', 'Agibilità e destinazione d''uso', 40),
	('condominium', 'Condominio', 50),
	('systems', 'Impianti, energia e sicurezza', 60),
	('taxes', 'Tributi e dichiarazioni', 70),
	('utilities', 'Utenze e contratti', 80),
	('insurance', 'Assicurazioni', 90),
	('works', 'Manutenzioni, lavori e garanzie', 100),
	('lettings', 'Locazioni e occupanti', 110),
	('hospitality', 'Adempimenti ricettivi (se applicabili)', 120),
	('disputes', 'Controversie, sinistri e comunicazioni formali', 130);
