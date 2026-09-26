CREATE TYPE "public"."age_band" AS ENUM('18_24', '25_34', '35_44', '45_54', '55_64', '65_plus');--> statement-breakpoint
CREATE TYPE "public"."consent_language" AS ENUM('ha', 'en');--> statement-breakpoint
CREATE TYPE "public"."flag_status" AS ENUM('open', 'dismissed', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."flag_type" AS ENUM('gps_far', 'duplicate_phone', 'pu_over_capacity', 'rate_anomaly', 'gps_cluster', 'callback_failed', 'opt_out_spike');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TYPE "public"."has_pvc" AS ENUM('yes', 'no', 'unsure');--> statement-breakpoint
CREATE TYPE "public"."support_level" AS ENUM('strong', 'leaning', 'undecided');--> statement-breakpoint
CREATE TYPE "public"."supporter_status" AS ENUM('active', 'removal_requested', 'anonymised');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('unverified', 'sms_delivered', 'callback_verified', 'callback_failed', 'opted_out');--> statement-breakpoint
CREATE TABLE "flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"supporter_id" uuid,
	"user_id" uuid,
	"pu_code" text NOT NULL,
	"type" "flag_type" NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "flag_status" DEFAULT 'open' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flags_review" CHECK (("flags"."status" = 'open') = ("flags"."reviewed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "pu_stats" (
	"pu_code" text PRIMARY KEY NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"verified" integer DEFAULT 0 NOT NULL,
	"flagged_open" integer DEFAULT 0 NOT NULL,
	"male" integer DEFAULT 0 NOT NULL,
	"female" integer DEFAULT 0 NOT NULL,
	"age_18_24" integer DEFAULT 0 NOT NULL,
	"age_25_34" integer DEFAULT 0 NOT NULL,
	"age_35_44" integer DEFAULT 0 NOT NULL,
	"age_45_54" integer DEFAULT 0 NOT NULL,
	"age_55_64" integer DEFAULT 0 NOT NULL,
	"age_65_plus" integer DEFAULT 0 NOT NULL,
	"strong" integer DEFAULT 0 NOT NULL,
	"leaning" integer DEFAULT 0 NOT NULL,
	"undecided" integer DEFAULT 0 NOT NULL,
	"has_pvc_yes" integer DEFAULT 0 NOT NULL,
	"volunteers" integer DEFAULT 0 NOT NULL,
	"opted_out" integer DEFAULT 0 NOT NULL,
	"last_capture_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pu_stats_non_negative" CHECK (least("pu_stats"."total", "pu_stats"."verified", "pu_stats"."flagged_open", "pu_stats"."male", "pu_stats"."female",
    "pu_stats"."age_18_24", "pu_stats"."age_25_34", "pu_stats"."age_35_44", "pu_stats"."age_45_54", "pu_stats"."age_55_64", "pu_stats"."age_65_plus",
    "pu_stats"."strong", "pu_stats"."leaning", "pu_stats"."undecided", "pu_stats"."has_pvc_yes", "pu_stats"."volunteers", "pu_stats"."opted_out") >= 0)
);
--> statement-breakpoint
CREATE TABLE "supporters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pu_code" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"shared_phone" boolean DEFAULT false NOT NULL,
	"address" text,
	"gender" "gender",
	"age_band" "age_band",
	"support_level" "support_level" NOT NULL,
	"has_pvc" "has_pvc" NOT NULL,
	"volunteer" boolean DEFAULT false NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"consent_version" text NOT NULL,
	"consent_language" "consent_language" NOT NULL,
	"gps" geography(Point, 4326),
	"gps_accuracy_m" integer,
	"captured_at" timestamp with time zone NOT NULL,
	"captured_by" uuid NOT NULL,
	"device_id" text NOT NULL,
	"verification" "verification_status" DEFAULT 'unverified' NOT NULL,
	"status" "supporter_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "supporters_id_uuid_v7" CHECK (substr("supporters"."id"::text, 15, 1) = '7'),
	CONSTRAINT "supporters_pu_code_is_pu" CHECK ("supporters"."pu_code" ~ '^[0-9]{2}/[0-9]{2}/[0-9]{2}/[0-9]{3}$'),
	CONSTRAINT "supporters_phone" CHECK (case when "supporters"."status" = 'anonymised'
    then "supporters"."phone" is null and "supporters"."address" is null and "supporters"."gps" is null
    else "supporters"."phone" is not null and "supporters"."phone" ~ '^\+234[789][01][0-9]{8}$' end),
	CONSTRAINT "supporters_full_name_length" CHECK (length(trim("supporters"."full_name")) between 1 and 120),
	CONSTRAINT "supporters_address_length" CHECK ("supporters"."address" is null or length("supporters"."address") <= 200),
	CONSTRAINT "supporters_consent_version" CHECK (length(trim("supporters"."consent_version")) between 1 and 20),
	CONSTRAINT "supporters_gps_accuracy" CHECK ("supporters"."gps_accuracy_m" is null or "supporters"."gps_accuracy_m" >= 0),
	CONSTRAINT "supporters_device_id_length" CHECK (length("supporters"."device_id") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_supporter_id_supporters_id_fk" FOREIGN KEY ("supporter_id") REFERENCES "public"."supporters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_pu_code_units_code_fk" FOREIGN KEY ("pu_code") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pu_stats" ADD CONSTRAINT "pu_stats_pu_code_units_code_fk" FOREIGN KEY ("pu_code") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporters" ADD CONSTRAINT "supporters_pu_code_units_code_fk" FOREIGN KEY ("pu_code") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporters" ADD CONSTRAINT "supporters_captured_by_users_id_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporters" ADD CONSTRAINT "supporters_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flags_pu_code_prefix_idx" ON "flags" USING btree ("pu_code" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "flags_status_created_idx" ON "flags" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "flags_supporter_idx" ON "flags" USING btree ("supporter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flags_one_open_per_supporter_type_idx" ON "flags" USING btree ("supporter_id","type") WHERE "flags"."status" = 'open' and "flags"."supporter_id" is not null;--> statement-breakpoint
CREATE INDEX "pu_stats_pu_code_prefix_idx" ON "pu_stats" USING btree ("pu_code" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "supporters_pu_code_prefix_idx" ON "supporters" USING btree ("pu_code" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "supporters_phone_idx" ON "supporters" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "supporters_captured_by_at_idx" ON "supporters" USING btree ("captured_by","captured_at");--> statement-breakpoint
CREATE INDEX "supporters_pu_code_created_idx" ON "supporters" USING btree ("pu_code","created_at");--> statement-breakpoint
CREATE INDEX "supporters_gps_gist_idx" ON "supporters" USING gist ("gps");