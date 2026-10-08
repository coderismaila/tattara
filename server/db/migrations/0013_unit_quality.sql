CREATE TABLE "unit_quality" (
	"unit_code" text PRIMARY KEY NOT NULL,
	"score" integer,
	"verified_rate" real NOT NULL,
	"flag_rate" real NOT NULL,
	"opt_out_rate" real NOT NULL,
	"pass_rate" real,
	"supporters" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_quality_score_range" CHECK ("unit_quality"."score" is null or "unit_quality"."score" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "unit_quality" ADD CONSTRAINT "unit_quality_unit_code_units_code_fk" FOREIGN KEY ("unit_code") REFERENCES "public"."units"("code") ON DELETE cascade ON UPDATE no action;