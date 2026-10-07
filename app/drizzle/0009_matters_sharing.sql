CREATE TABLE "matter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"asset_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_on" date NOT NULL,
	"closed_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matter_status_check" CHECK ("matter"."status" in ('open','in_progress','waiting','closed'))
);
--> statement-breakpoint
CREATE TABLE "matter_assignment" (
	"matter_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matter_assignment_matter_id_party_id_pk" PRIMARY KEY("matter_id","party_id")
);
--> statement-breakpoint
CREATE TABLE "matter_document" (
	"matter_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	CONSTRAINT "matter_document_matter_id_document_id_pk" PRIMARY KEY("matter_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "matter_document_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matter_id" uuid NOT NULL,
	"title" text NOT NULL,
	"requested_from_party_id" uuid,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_on" date NOT NULL,
	"due_on" date,
	"document_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matter_request_status_check" CHECK ("matter_document_request"."status" in ('requested','received','not_available'))
);
--> statement-breakpoint
CREATE TABLE "professional_opinion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matter_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"nature" text NOT NULL,
	"summary" text NOT NULL,
	"issued_on" date,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "professional_opinion_nature_check" CHECK ("professional_opinion"."nature" in ('informational','formally_validated'))
);
--> statement-breakpoint
CREATE TABLE "share_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"event" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_log_event_check" CHECK ("share_log"."event" in ('created','downloaded','revoked'))
);
--> statement-breakpoint
CREATE TABLE "share_package" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_type" text NOT NULL,
	"recipient_name" text NOT NULL,
	"confidentiality_cap" text NOT NULL,
	"note" text,
	"file_count" integer DEFAULT 0 NOT NULL,
	"total_bytes" bigint DEFAULT 0 NOT NULL,
	"snapshot" jsonb NOT NULL,
	"manifest_sha256" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_package_recipient_check" CHECK ("share_package"."recipient_type" in ('administrator','technician','lawyer','notary','accountant','insurer','tenant','manager','other')),
	CONSTRAINT "share_package_cap_check" CHECK ("share_package"."confidentiality_cap" in ('ordinary','reserved','highly_reserved'))
);
--> statement-breakpoint
CREATE TABLE "share_package_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"path" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"confidentiality" text NOT NULL,
	"override_above_cap" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matter" ADD CONSTRAINT "matter_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_assignment" ADD CONSTRAINT "matter_assignment_matter_id_matter_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_assignment" ADD CONSTRAINT "matter_assignment_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_document" ADD CONSTRAINT "matter_document_matter_id_matter_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_document" ADD CONSTRAINT "matter_document_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_document_request" ADD CONSTRAINT "matter_document_request_matter_id_matter_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_document_request" ADD CONSTRAINT "matter_document_request_requested_from_party_id_party_id_fk" FOREIGN KEY ("requested_from_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_document_request" ADD CONSTRAINT "matter_document_request_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_opinion" ADD CONSTRAINT "professional_opinion_matter_id_matter_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_opinion" ADD CONSTRAINT "professional_opinion_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_opinion" ADD CONSTRAINT "professional_opinion_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_log" ADD CONSTRAINT "share_log_package_id_share_package_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."share_package"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_package_item" ADD CONSTRAINT "share_package_item_package_id_share_package_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."share_package"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_package_item" ADD CONSTRAINT "share_package_item_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_package_item" ADD CONSTRAINT "share_package_item_version_id_document_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matter_asset_idx" ON "matter" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "matter_request_matter_idx" ON "matter_document_request" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX "professional_opinion_matter_idx" ON "professional_opinion" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX "share_log_package_idx" ON "share_log" USING btree ("package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "share_package_item_uq" ON "share_package_item" USING btree ("package_id","version_id");--> statement-breakpoint
CREATE INDEX "share_package_item_document_idx" ON "share_package_item" USING btree ("document_id");