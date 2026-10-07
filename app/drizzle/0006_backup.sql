CREATE TABLE "backup_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"destination_key" text,
	"size_bytes" bigint,
	"archive_sha256" text,
	"file_count" integer,
	"audit_seq" bigint,
	"audit_hash" text,
	"message" text,
	CONSTRAINT "backup_run_trigger_check" CHECK ("backup_run"."trigger" in ('manual','scheduled')),
	CONSTRAINT "backup_run_status_check" CHECK ("backup_run"."status" in ('running','completed','warning','failed'))
);
--> statement-breakpoint
CREATE INDEX "backup_run_started_idx" ON "backup_run" USING btree ("started_at");