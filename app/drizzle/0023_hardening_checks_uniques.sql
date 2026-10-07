-- Indurimento (E78). Sicura sui dati esistenti: i vincoli CHECK nascono NOT VALID (valgono per le righe nuove) e vengono validati-- solo se nessuna riga esistente li viola; gli indici univoci si creano solo se non ci sono duplicati (altrimenti la migrazione-- non fallisce: lascia un NOTICE e il vincolo resta in vigore solo come controllo dei casi d'uso). La tabella audit_log non si-- aggiorna mai: ADD CONSTRAINT ... NOT VALID e VALIDATE non scrivono righe e non fanno scattare il trigger append-only.
ALTER TABLE "dossier_item_document" DROP CONSTRAINT "dossier_item_document_document_id_document_id_fk";
--> statement-breakpoint
ALTER TABLE "deadline_proof" DROP CONSTRAINT "deadline_proof_document_id_document_id_fk";
--> statement-breakpoint
ALTER TABLE "matter_document" DROP CONSTRAINT "matter_document_document_id_document_id_fk";
--> statement-breakpoint
ALTER TABLE "condo_agenda_document" DROP CONSTRAINT "condo_agenda_document_document_id_document_id_fk";
--> statement-breakpoint
ALTER TABLE "condo_document" DROP CONSTRAINT "condo_document_document_id_document_id_fk";
--> statement-breakpoint
ALTER TABLE "plant_document" DROP CONSTRAINT "plant_document_document_id_document_id_fk";
--> statement-breakpoint
ALTER TABLE "dossier_item_document" ADD CONSTRAINT "dossier_item_document_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_proof" ADD CONSTRAINT "deadline_proof_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_document" ADD CONSTRAINT "matter_document_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_agenda_document" ADD CONSTRAINT "condo_agenda_document_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condo_document" ADD CONSTRAINT "condo_document_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_document" ADD CONSTRAINT "plant_document_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_type_check" CHECK ("actor_type" in ('owner','system')) NOT VALID;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "audit_log" WHERE NOT ("actor_type" in ('owner','system'))) THEN
    ALTER TABLE "audit_log" VALIDATE CONSTRAINT "audit_log_actor_type_check";
  ELSE
    RAISE NOTICE 'audit_log_actor_type_check: righe esistenti che non lo rispettano, vincolo lasciato NOT VALID';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_kind_check" CHECK ("kind" in ('dwelling','detached_house','garage','box','parking','cellar','commercial','land','other')) NOT VALID;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "asset" WHERE NOT ("kind" in ('dwelling','detached_house','garage','box','parking','cellar','commercial','land','other'))) THEN
    ALTER TABLE "asset" VALIDATE CONSTRAINT "asset_kind_check";
  ELSE
    RAISE NOTICE 'asset_kind_check: righe esistenti che non lo rispettano, vincolo lasciato NOT VALID';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "territory" ADD CONSTRAINT "territory_source_check" CHECK ("source" in ('manual','istat')) NOT VALID;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "territory" WHERE NOT ("source" in ('manual','istat'))) THEN
    ALTER TABLE "territory" VALIDATE CONSTRAINT "territory_source_check";
  ELSE
    RAISE NOTICE 'territory_source_check: righe esistenti che non lo rispettano, vincolo lasciato NOT VALID';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "deadline" ADD CONSTRAINT "deadline_category_check" CHECK ("category" in ('fiscal','insurance','technical','condominium','contractual','letting','hospitality','administrative','other')) NOT VALID;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "deadline" WHERE NOT ("category" in ('fiscal','insurance','technical','condominium','contractual','letting','hospitality','administrative','other'))) THEN
    ALTER TABLE "deadline" VALIDATE CONSTRAINT "deadline_category_check";
  ELSE
    RAISE NOTICE 'deadline_category_check: righe esistenti che non lo rispettano, vincolo lasciato NOT VALID';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "share_package_item" ADD CONSTRAINT "share_package_item_confidentiality_check" CHECK ("confidentiality" in ('ordinary','reserved','highly_reserved')) NOT VALID;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "share_package_item" WHERE NOT ("confidentiality" in ('ordinary','reserved','highly_reserved'))) THEN
    ALTER TABLE "share_package_item" VALIDATE CONSTRAINT "share_package_item_confidentiality_check";
  ELSE
    RAISE NOTICE 'share_package_item_confidentiality_check: righe esistenti che non lo rispettano, vincolo lasciato NOT VALID';
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "tax_obligation" GROUP BY "asset_id", "tax_type_id", "year", coalesce("label", '') HAVING count(*) > 1) THEN
    RAISE NOTICE 'tax_obligation_uq: duplicati esistenti, indice univoco non creato';
  ELSE
    CREATE UNIQUE INDEX "tax_obligation_uq" ON "tax_obligation" USING btree ("asset_id", "tax_type_id", "year", coalesce("label", ''));
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "ins_premium" GROUP BY "policy_id", "due_on" HAVING count(*) > 1) THEN
    RAISE NOTICE 'ins_premium_policy_due_uq: duplicati esistenti, indice univoco non creato';
  ELSE
    CREATE UNIQUE INDEX "ins_premium_policy_due_uq" ON "ins_premium" USING btree ("policy_id", "due_on");
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "letting_code" GROUP BY "letting_id", "label", "value" HAVING count(*) > 1) THEN
    RAISE NOTICE 'letting_code_uq: duplicati esistenti, indice univoco non creato';
  ELSE
    CREATE UNIQUE INDEX "letting_code_uq" ON "letting_code" USING btree ("letting_id", "label", "value");
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "letting_rent" GROUP BY "letting_id", "due_on" HAVING count(*) > 1) THEN
    RAISE NOTICE 'letting_rent_letting_due_uq: duplicati esistenti, indice univoco non creato';
  ELSE
    CREATE UNIQUE INDEX "letting_rent_letting_due_uq" ON "letting_rent" USING btree ("letting_id", "due_on");
  END IF;
END $$;
