ALTER TABLE "units" ADD COLUMN "registered_voters_reported_by" uuid;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "registered_voters_reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_registered_voters_reported_by_users_id_fk" FOREIGN KEY ("registered_voters_reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_registered_voters_reported" CHECK (("units"."registered_voters_reported_by" is null) = ("units"."registered_voters_reported_at" is null)
    and ("units"."registered_voters_reported_at" is null or "units"."registered_voters" is not null));