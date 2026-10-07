CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"territory_id" uuid NOT NULL,
	"locality" text,
	"address" text,
	"postal_code" text,
	"use_type" text,
	"in_condominium" boolean DEFAULT false NOT NULL,
	"notes" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ancillary_asset_id" uuid NOT NULL,
	"main_asset_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"declared_basis" text,
	"validation_status" text DEFAULT 'declared' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_link_distinct_check" CHECK ("asset_link"."ancillary_asset_id" <> "asset_link"."main_asset_id"),
	CONSTRAINT "asset_link_validation_check" CHECK ("asset_link"."validation_status" in ('declared','documented','validated_by_professional'))
);
--> statement-breakpoint
CREATE TABLE "cadastral_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"sheet" text,
	"parcel" text,
	"subunit" text,
	"cadastral_category" text,
	"cadastral_class" text,
	"consistency" text,
	"income_cents" bigint,
	"valid_from" date,
	"valid_to" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ownership_right" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"holder_party_id" uuid NOT NULL,
	"right_type" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"quota_numerator" integer DEFAULT 1 NOT NULL,
	"quota_denominator" integer DEFAULT 1 NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ownership_right_type_check" CHECK ("ownership_right"."right_type" in ('full','co_ownership','usufruct','bare_ownership')),
	CONSTRAINT "ownership_quota_check" CHECK ("ownership_right"."quota_numerator" >= 1 and "ownership_right"."quota_denominator" >= 1 and "ownership_right"."quota_numerator" <= "ownership_right"."quota_denominator")
);
--> statement-breakpoint
CREATE TABLE "party" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"tax_code" text,
	"email" text,
	"pec" text,
	"phone" text,
	"address" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "territory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"code" text,
	"cadastral_code" text,
	"province_sigla" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"verification_status" text DEFAULT 'to_verify' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "territory_kind_check" CHECK ("territory"."kind" in ('country','region','province','municipality','locality')),
	CONSTRAINT "territory_verification_check" CHECK ("territory"."verification_status" in ('draft','to_verify','verified_by_owner','validated_by_professional'))
);
--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_territory_id_territory_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territory"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_link" ADD CONSTRAINT "asset_link_ancillary_asset_id_asset_id_fk" FOREIGN KEY ("ancillary_asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_link" ADD CONSTRAINT "asset_link_main_asset_id_asset_id_fk" FOREIGN KEY ("main_asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadastral_record" ADD CONSTRAINT "cadastral_record_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_right" ADD CONSTRAINT "ownership_right_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_right" ADD CONSTRAINT "ownership_right_holder_party_id_party_id_fk" FOREIGN KEY ("holder_party_id") REFERENCES "public"."party"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory" ADD CONSTRAINT "territory_parent_id_territory_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."territory"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_territory_idx" ON "asset" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "asset_name_idx" ON "asset" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_link_pair_uq" ON "asset_link" USING btree ("ancillary_asset_id","main_asset_id");--> statement-breakpoint
CREATE INDEX "asset_link_main_idx" ON "asset_link" USING btree ("main_asset_id");--> statement-breakpoint
CREATE INDEX "cadastral_record_asset_idx" ON "cadastral_record" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "ownership_right_asset_idx" ON "ownership_right" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "ownership_right_holder_idx" ON "ownership_right" USING btree ("holder_party_id");--> statement-breakpoint
CREATE INDEX "party_name_idx" ON "party" USING btree ("display_name");--> statement-breakpoint
CREATE UNIQUE INDEX "territory_kind_code_uq" ON "territory" USING btree ("kind","code") WHERE "territory"."code" is not null;--> statement-breakpoint
CREATE INDEX "territory_parent_idx" ON "territory" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "territory_kind_name_idx" ON "territory" USING btree ("kind","name");