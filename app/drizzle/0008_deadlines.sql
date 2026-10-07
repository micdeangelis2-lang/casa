CREATE TABLE "app_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deadline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"level" text NOT NULL,
	"legal_basis" text,
	"asset_id" uuid,
	"responsible_party_id" uuid,
	"professional_party_id" uuid,
	"calc" jsonb NOT NULL,
	"shift_to_business_day" boolean DEFAULT false NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"consequences" text,
	"required_documents" text,
	"lead_days" integer[] DEFAULT '{30,7,1,0}'::integer[] NOT NULL,
	"proof_required" boolean DEFAULT false NOT NULL,
	"origin" text DEFAULT 'manual' NOT NULL,
	"rule_key" text,
	"outcome_key" text,
	"rule_version_id" uuid,
	"explanation" jsonb,
	"stale" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deadline_priority_check" CHECK ("deadline"."priority" in ('low','normal','high','urgent')),
	CONSTRAINT "deadline_origin_check" CHECK ("deadline"."origin" in ('manual','rule')),
	CONSTRAINT "deadline_level_check" CHECK ("deadline"."level" in ('national','regional','municipal','condominium','contract')),
	CONSTRAINT "deadline_rule_check" CHECK (("deadline"."origin" = 'rule') = ("deadline"."rule_key" is not null and "deadline"."outcome_key" is not null))
);
--> statement-breakpoint
CREATE TABLE "deadline_occurrence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deadline_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"completed_on" date,
	"completion_kind" text,
	"snoozed_until" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deadline_occurrence_status_check" CHECK ("deadline_occurrence"."status" in ('open','done','cancelled')),
	CONSTRAINT "deadline_occurrence_completion_check" CHECK ("deadline_occurrence"."completion_kind" is null or "deadline_occurrence"."completion_kind" in ('owner','auto_verified','professional_validated'))
);
--> statement-breakpoint
CREATE TABLE "deadline_proof" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"document_id" uuid,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deadline_proof_shape_check" CHECK ("deadline_proof"."document_id" is not null or "deadline_proof"."reference" is not null)
);
--> statement-breakpoint
CREATE TABLE "holiday_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"month" integer,
	"day" integer,
	"offset_days" integer,
	"territory_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holiday_rule_kind_check" CHECK ("holiday_rule"."kind" in ('fixed','easter_offset')),
	CONSTRAINT "holiday_rule_shape_check" CHECK (("holiday_rule"."kind" = 'fixed' and "holiday_rule"."month" between 1 and 12 and "holiday_rule"."day" between 1 and 31) or ("holiday_rule"."kind" = 'easter_offset' and "holiday_rule"."offset_days" is not null))
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"lead_days" integer NOT NULL,
	"due_on" date NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"email_sent_at" timestamp with time zone,
	"email_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deadline" ADD CONSTRAINT "deadline_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline" ADD CONSTRAINT "deadline_responsible_party_id_party_id_fk" FOREIGN KEY ("responsible_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline" ADD CONSTRAINT "deadline_professional_party_id_party_id_fk" FOREIGN KEY ("professional_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline" ADD CONSTRAINT "deadline_rule_version_id_rule_version_id_fk" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_occurrence" ADD CONSTRAINT "deadline_occurrence_deadline_id_deadline_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_proof" ADD CONSTRAINT "deadline_proof_occurrence_id_deadline_occurrence_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."deadline_occurrence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_proof" ADD CONSTRAINT "deadline_proof_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_rule" ADD CONSTRAINT "holiday_rule_territory_id_territory_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_occurrence_id_deadline_occurrence_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."deadline_occurrence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deadline_rule_uq" ON "deadline" USING btree ("asset_id","rule_key","outcome_key") WHERE "deadline"."origin" = 'rule';--> statement-breakpoint
CREATE INDEX "deadline_asset_idx" ON "deadline" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deadline_occurrence_uq" ON "deadline_occurrence" USING btree ("deadline_id","due_on");--> statement-breakpoint
CREATE INDEX "deadline_occurrence_due_idx" ON "deadline_occurrence" USING btree ("status","due_on");--> statement-breakpoint
CREATE INDEX "deadline_proof_occurrence_idx" ON "deadline_proof" USING btree ("occurrence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_key_uq" ON "notification" USING btree ("occurrence_id","lead_days","due_on");--> statement-breakpoint
CREATE INDEX "notification_unread_idx" ON "notification" USING btree ("read_at","dismissed_at");
--> statement-breakpoint
-- Festivi nazionali (dati di partenza, modificabili; si possono aggiungere festivi comunali). La Pasqua si calcola, il
-- lunedi' dopo Pasqua e' una regola «easter_offset +1».
INSERT INTO "holiday_rule" ("name", "kind", "month", "day", "offset_days") VALUES
	('Capodanno', 'fixed', 1, 1, NULL),
	('Epifania', 'fixed', 1, 6, NULL),
	('Lunedì dell''Angelo', 'easter_offset', NULL, NULL, 1),
	('Festa della Liberazione', 'fixed', 4, 25, NULL),
	('Festa del Lavoro', 'fixed', 5, 1, NULL),
	('Festa della Repubblica', 'fixed', 6, 2, NULL),
	('Assunzione', 'fixed', 8, 15, NULL),
	('Ognissanti', 'fixed', 11, 1, NULL),
	('Immacolata Concezione', 'fixed', 12, 8, NULL),
	('Natale', 'fixed', 12, 25, NULL),
	('Santo Stefano', 'fixed', 12, 26, NULL);
