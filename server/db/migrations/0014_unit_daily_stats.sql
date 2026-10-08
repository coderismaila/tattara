CREATE TABLE "unit_daily_stats" (
	"unit_code" text NOT NULL,
	"day" date NOT NULL,
	"total" integer NOT NULL,
	"verified" integer NOT NULL,
	CONSTRAINT "unit_daily_stats_unit_code_day_pk" PRIMARY KEY("unit_code","day"),
	CONSTRAINT "unit_daily_stats_non_negative" CHECK ("unit_daily_stats"."total" >= 0 and "unit_daily_stats"."verified" >= 0)
);
