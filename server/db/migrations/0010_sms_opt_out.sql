ALTER TYPE "public"."sms_purpose" ADD VALUE 'opt_out_confirm';--> statement-breakpoint
CREATE TABLE "sms_opt_outs" (
	"phone_hash" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_opt_outs_phone_hash_hex" CHECK ("sms_opt_outs"."phone_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "sms_queue" ADD COLUMN "supporter_id" uuid;--> statement-breakpoint
ALTER TABLE "supporters" ADD COLUMN "opted_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sms_queue" ADD CONSTRAINT "sms_queue_supporter_id_supporters_id_fk" FOREIGN KEY ("supporter_id") REFERENCES "public"."supporters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sms_queue_provider_ref_idx" ON "sms_queue" USING btree ("provider_ref");--> statement-breakpoint
CREATE INDEX "sms_queue_supporter_idx" ON "sms_queue" USING btree ("supporter_id");