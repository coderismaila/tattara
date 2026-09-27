-- pg_trgm: trigram indexes for supporter search by name and by phone ending (task 3.4).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "supporters_full_name_trgm_idx" ON "supporters" USING gin (lower("full_name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "supporters_phone_trgm_idx" ON "supporters" USING gin ("phone" gin_trgm_ops);