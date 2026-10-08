CREATE TYPE "public"."callback_outcome" AS ENUM('verified', 'wrong_number', 'denies', 'unreachable');--> statement-breakpoint
CREATE TABLE "callbacks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"supporter_id" uuid NOT NULL,
	"ward_code" text NOT NULL,
	"assigned_to" uuid,
	"due_date" date NOT NULL,
	"outcome" "callback_outcome",
	"notes" text,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "callbacks_ward_code_is_ward" CHECK ("callbacks"."ward_code" ~ '^[0-9]{2}/[0-9]{2}/[0-9]{2}$'),
	CONSTRAINT "callbacks_completed" CHECK (("callbacks"."outcome" is null) = ("callbacks"."completed_at" is null) and ("callbacks"."completed_at" is null) = ("callbacks"."completed_by" is null)),
	CONSTRAINT "callbacks_notes_length" CHECK ("callbacks"."notes" is null or length("callbacks"."notes") <= 200)
);
--> statement-breakpoint
ALTER TABLE "callbacks" ADD CONSTRAINT "callbacks_supporter_id_supporters_id_fk" FOREIGN KEY ("supporter_id") REFERENCES "public"."supporters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callbacks" ADD CONSTRAINT "callbacks_ward_code_units_code_fk" FOREIGN KEY ("ward_code") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callbacks" ADD CONSTRAINT "callbacks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callbacks" ADD CONSTRAINT "callbacks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "callbacks_supporter_idx" ON "callbacks" USING btree ("supporter_id");--> statement-breakpoint
CREATE INDEX "callbacks_ward_due_idx" ON "callbacks" USING btree ("ward_code","due_date");