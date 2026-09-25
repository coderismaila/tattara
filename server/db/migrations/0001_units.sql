CREATE TYPE "public"."unit_level" AS ENUM('state', 'lga', 'ward', 'pu');--> statement-breakpoint
CREATE TABLE "unit_targets" (
	"unit_code" text PRIMARY KEY NOT NULL,
	"target" integer NOT NULL,
	"set_by" uuid,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_targets_target_non_negative" CHECK ("unit_targets"."target" >= 0)
);
--> statement-breakpoint
CREATE TABLE "units" (
	"code" text PRIMARY KEY NOT NULL,
	"level" "unit_level" NOT NULL,
	"parent_code" text,
	"name" text NOT NULL,
	"name_normalised" text NOT NULL,
	"registered_voters" integer,
	"location" geography(Point, 4326),
	"location_estimated" boolean DEFAULT false NOT NULL,
	"boundary_ref" text,
	"active" boolean DEFAULT true NOT NULL,
	"source_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_code_matches_level" CHECK (coalesce(case "units"."level"
    when 'state' then "units"."code" ~ '^[0-9]{2}$' and "units"."parent_code" is null
    when 'lga' then "units"."code" ~ '^[0-9]{2}/[0-9]{2}$' and "units"."parent_code" is not distinct from left("units"."code", 2)
    when 'ward' then "units"."code" ~ '^[0-9]{2}/[0-9]{2}/[0-9]{2}$' and "units"."parent_code" is not distinct from left("units"."code", 5)
    when 'pu' then "units"."code" ~ '^[0-9]{2}/[0-9]{2}/[0-9]{2}/[0-9]{3}$' and "units"."parent_code" is not distinct from left("units"."code", 8)
  end, false)),
	CONSTRAINT "units_name_not_blank" CHECK (length(trim("units"."name")) > 0),
	CONSTRAINT "units_registered_voters_non_negative" CHECK ("units"."registered_voters" is null or "units"."registered_voters" >= 0)
);
--> statement-breakpoint
ALTER TABLE "unit_targets" ADD CONSTRAINT "unit_targets_unit_code_units_code_fk" FOREIGN KEY ("unit_code") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_parent_code_units_code_fk" FOREIGN KEY ("parent_code") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "units_parent_code_idx" ON "units" USING btree ("parent_code");--> statement-breakpoint
CREATE INDEX "units_level_idx" ON "units" USING btree ("level");--> statement-breakpoint
CREATE INDEX "units_code_prefix_idx" ON "units" USING btree ("code" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "units_location_gist_idx" ON "units" USING gist ("location");