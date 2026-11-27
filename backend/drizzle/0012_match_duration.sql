ALTER TABLE "matches" ADD COLUMN "duration_minutes" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "match_duration_minutes_check" CHECK ("matches"."duration_minutes" between 10 and 120);
