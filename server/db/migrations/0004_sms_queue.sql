CREATE TYPE "public"."sms_purpose" AS ENUM('thank_you', 'otp', 'invite', 'broadcast');--> statement-breakpoint
CREATE TYPE "public"."sms_status" AS ENUM('queued', 'sent', 'failed', 'delivered');--> statement-breakpoint
CREATE TABLE "sms_queue" (
	"id" uuid PRIMARY KEY NOT NULL,
	"to_phone" text NOT NULL,
	"body" text NOT NULL,
	"template_key" text,
	"purpose" "sms_purpose" NOT NULL,
	"scope_code" text,
	"status" "sms_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now(),
	"last_error" text,
	"provider_ref" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "sms_queue_to_phone_e164_ng_mobile" CHECK ("sms_queue"."to_phone" ~ '^\+234[789][01][0-9]{8}$'),
	CONSTRAINT "sms_queue_body_not_blank" CHECK (length(trim("sms_queue"."body")) > 0),
	CONSTRAINT "sms_queue_attempts_non_negative" CHECK ("sms_queue"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sms_queue" ADD CONSTRAINT "sms_queue_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sms_queue_due_idx" ON "sms_queue" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "sms_queue_to_phone_idx" ON "sms_queue" USING btree ("to_phone","created_at");