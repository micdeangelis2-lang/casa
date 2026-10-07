CREATE TABLE "matter_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matter_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"occurred_on" date NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"party_id" uuid,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matter_event_kind_check" CHECK ("matter_event"."kind" in ('note','hearing','term','communication','meeting'))
);
--> statement-breakpoint
ALTER TABLE "deadline" ADD COLUMN "matter_id" uuid;--> statement-breakpoint
ALTER TABLE "matter" ADD COLUMN "office_party_id" uuid;--> statement-breakpoint
ALTER TABLE "matter" ADD COLUMN "protocol_number" text;--> statement-breakpoint
ALTER TABLE "matter" ADD COLUMN "submitted_on" date;--> statement-breakpoint
ALTER TABLE "matter" ADD COLUMN "response_due_on" date;--> statement-breakpoint
ALTER TABLE "matter_event" ADD CONSTRAINT "matter_event_matter_id_matter_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_event" ADD CONSTRAINT "matter_event_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_event" ADD CONSTRAINT "matter_event_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matter_event_matter_idx" ON "matter_event" USING btree ("matter_id","occurred_on");--> statement-breakpoint
CREATE INDEX "matter_event_party_idx" ON "matter_event" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "matter_event_document_idx" ON "matter_event" USING btree ("document_id");--> statement-breakpoint
ALTER TABLE "deadline" ADD CONSTRAINT "deadline_matter_id_matter_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matter"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter" ADD CONSTRAINT "matter_office_party_id_party_id_fk" FOREIGN KEY ("office_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deadline_matter_idx" ON "deadline" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX "matter_office_party_idx" ON "matter" USING btree ("office_party_id");