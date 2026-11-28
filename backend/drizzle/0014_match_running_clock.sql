ALTER TABLE "matches" ADD COLUMN "clock_running_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "clock_accumulated_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Existing matches keep their recorded minute; none start automatically running.
UPDATE "matches" SET "clock_accumulated_seconds" = COALESCE("current_minute", 0) * 60;
