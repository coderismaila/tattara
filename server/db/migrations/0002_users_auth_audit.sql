-- Hand-edited: the units(code, level) unique constraint must exist before users_unit_fk references it.
ALTER TABLE "units" ADD CONSTRAINT "units_code_level_key" UNIQUE("code","level");--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('device', 'reset');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'DG', 'STATE_LEAD', 'LGA_LEAD', 'WARD_LEAD', 'PU_LEAD');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'locked', 'deactivated');--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_codes_attempts_range" CHECK ("otp_codes"."attempts" between 0 and 5)
);
--> statement-breakpoint
CREATE TABLE "user_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"label" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"role" "user_role" NOT NULL,
	"unit_code" text,
	"unit_level" "unit_level",
	"pin_hash" text,
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"session_version" integer DEFAULT 0 NOT NULL,
	"failed_pin_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_role_matches_unit" CHECK (coalesce(case "users"."role"
    when 'ADMIN' then "users"."unit_code" is null and "users"."unit_level" is null
    when 'DG' then "users"."unit_code" is null and "users"."unit_level" is null
    when 'STATE_LEAD' then "users"."unit_code" is not null and "users"."unit_level" = 'state'
    when 'LGA_LEAD' then "users"."unit_code" is not null and "users"."unit_level" = 'lga'
    when 'WARD_LEAD' then "users"."unit_code" is not null and "users"."unit_level" = 'ward'
    when 'PU_LEAD' then "users"."unit_code" is not null and "users"."unit_level" = 'pu'
  end, false)),
	CONSTRAINT "users_phone_e164_ng_mobile" CHECK ("users"."phone" ~ '^\+234[789][01][0-9]{8}$'),
	CONSTRAINT "users_active_has_pin" CHECK ("users"."status" <> 'active' or "users"."pin_hash" is not null),
	CONSTRAINT "users_full_name_not_blank" CHECK (length(trim("users"."full_name")) > 0),
	CONSTRAINT "users_failed_pin_attempts_non_negative" CHECK ("users"."failed_pin_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_role" "user_role",
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"scope_code" text,
	"ip" "inet",
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_unit_fk" FOREIGN KEY ("unit_code","unit_level") REFERENCES "public"."units"("code","level") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invites_user_id_idx" ON "invites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "otp_codes_phone_purpose_created_idx" ON "otp_codes" USING btree ("phone","purpose","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_devices_user_device_idx" ON "user_devices" USING btree ("user_id","device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_one_active_per_unit_idx" ON "users" USING btree ("role","unit_code") WHERE "users"."status" = 'active';--> statement-breakpoint
CREATE INDEX "users_unit_code_prefix_idx" ON "users" USING btree ("unit_code" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "users_invited_by_idx" ON "users" USING btree ("invited_by");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_at_idx" ON "audit_log" USING btree ("actor_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_scope_code_prefix_idx" ON "audit_log" USING btree ("scope_code" text_pattern_ops);--> statement-breakpoint
ALTER TABLE "unit_targets" ADD CONSTRAINT "unit_targets_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;