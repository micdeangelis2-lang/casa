CREATE TABLE "management_mandate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid,
	"manager_party_id" uuid,
	"starts_on" date,
	"ends_on" date,
	"compensation" text,
	"document_id" uuid,
	"note" text,
	"deadline_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_mandate_dates_check" CHECK ("management_mandate"."starts_on" is null or "management_mandate"."ends_on" is null or "management_mandate"."ends_on" >= "management_mandate"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "listing_engagement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"agent_party_id" uuid,
	"starts_on" date,
	"ends_on" date,
	"exclusive" boolean DEFAULT false NOT NULL,
	"asking_cents" bigint,
	"commission" text,
	"document_id" uuid,
	"note" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_engagement_kind_check" CHECK ("listing_engagement"."kind" in ('sale','rent')),
	CONSTRAINT "listing_engagement_status_check" CHECK ("listing_engagement"."status" in ('active','ended')),
	CONSTRAINT "listing_engagement_asking_check" CHECK ("listing_engagement"."asking_cents" is null or "listing_engagement"."asking_cents" >= 0),
	CONSTRAINT "listing_engagement_dates_check" CHECK ("listing_engagement"."starts_on" is null or "listing_engagement"."ends_on" is null or "listing_engagement"."ends_on" >= "listing_engagement"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "listing_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"occurred_on" date NOT NULL,
	"amount_cents" bigint,
	"outcome" text,
	"contact_party_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_event_kind_check" CHECK ("listing_event"."kind" in ('visit','proposal','counterproposal','note')),
	CONSTRAINT "listing_event_outcome_check" CHECK ("listing_event"."outcome" is null or "listing_event"."outcome" in ('open','accepted','rejected','withdrawn')),
	CONSTRAINT "listing_event_amount_check" CHECK ("listing_event"."amount_cents" is null or "listing_event"."amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "share_package" DROP CONSTRAINT "share_package_recipient_check";--> statement-breakpoint
ALTER TABLE "management_mandate" ADD CONSTRAINT "management_mandate_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_mandate" ADD CONSTRAINT "management_mandate_manager_party_id_party_id_fk" FOREIGN KEY ("manager_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_mandate" ADD CONSTRAINT "management_mandate_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_mandate" ADD CONSTRAINT "management_mandate_deadline_id_deadline_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadline"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_engagement" ADD CONSTRAINT "listing_engagement_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_engagement" ADD CONSTRAINT "listing_engagement_agent_party_id_party_id_fk" FOREIGN KEY ("agent_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_engagement" ADD CONSTRAINT "listing_engagement_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_event" ADD CONSTRAINT "listing_event_engagement_id_listing_engagement_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."listing_engagement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_event" ADD CONSTRAINT "listing_event_contact_party_id_party_id_fk" FOREIGN KEY ("contact_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "management_mandate_asset_idx" ON "management_mandate" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "management_mandate_manager_party_idx" ON "management_mandate" USING btree ("manager_party_id");--> statement-breakpoint
CREATE INDEX "management_mandate_document_idx" ON "management_mandate" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "management_mandate_deadline_idx" ON "management_mandate" USING btree ("deadline_id");--> statement-breakpoint
CREATE INDEX "listing_engagement_asset_idx" ON "listing_engagement" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "listing_engagement_agent_party_idx" ON "listing_engagement" USING btree ("agent_party_id");--> statement-breakpoint
CREATE INDEX "listing_engagement_document_idx" ON "listing_engagement" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "listing_event_engagement_idx" ON "listing_event" USING btree ("engagement_id","occurred_on");--> statement-breakpoint
CREATE INDEX "listing_event_contact_party_idx" ON "listing_event" USING btree ("contact_party_id");--> statement-breakpoint
ALTER TABLE "share_package" ADD CONSTRAINT "share_package_recipient_check" CHECK ("share_package"."recipient_type" in ('administrator','technician','lawyer','notary','accountant','insurer','tenant','manager','agent','other'));
--> statement-breakpoint
-- Dati esistenti: i mandati registrati finora come scadenze («Mandato di gestione...») diventano mandati veri, collegati alla stessa scadenza (la scadenza non si tocca).
INSERT INTO "management_mandate" ("asset_id", "manager_party_id", "ends_on", "compensation", "note", "deadline_id")
SELECT d."asset_id", d."professional_party_id",
  COALESCE((SELECT min(o."due_on") FROM "deadline_occurrence" o WHERE o."deadline_id" = d."id" AND o."status" = 'open'), (SELECT max(o."due_on") FROM "deadline_occurrence" o WHERE o."deadline_id" = d."id")),
  CASE WHEN d."description" LIKE 'Compenso dichiarato: %' THEN NULLIF(btrim(substr(split_part(d."description", chr(10), 1), 22)), '') END,
  CASE WHEN d."description" LIKE 'Compenso dichiarato: %' THEN NULLIF(btrim(substr(d."description", length(split_part(d."description", chr(10), 1)) + 2)), '') ELSE NULLIF(btrim(d."description"), '') END,
  d."id"
FROM "deadline" d
WHERE d."title" LIKE 'Mandato di gestione%' AND d."archived_at" IS NULL;