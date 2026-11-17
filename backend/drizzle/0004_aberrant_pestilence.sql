-- Phase 5: fixture lifecycle state, match clock metadata and auditable event
-- corrections. Existing rows are preserved; the preflight aborts if historical
-- data is incompatible with the new result-confirmation invariant.
DO $$
DECLARE
	v_issues text := '';
	v_samples text;
BEGIN
	SELECT string_agg(id::text || ' (' || status || ')', ', ') INTO v_samples
	FROM matches
	WHERE result_confirmed_at IS NOT NULL
		AND status <> 'full_time';
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Matches with a confirmed result outside full_time: ' || v_samples;
	END IF;

	IF v_issues <> '' THEN
		RAISE EXCEPTION E'Phase 5 data preflight failed. Resolve the following records manually before applying migration 0004:%', v_issues;
	END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "fixtures" ADD COLUMN "status" varchar(20) DEFAULT 'scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_events" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "match_events" ADD COLUMN "voided_by" uuid;--> statement-breakpoint
ALTER TABLE "match_events" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "match_events" ADD COLUMN "corrected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "match_events" ADD COLUMN "corrected_by" uuid;--> statement-breakpoint
ALTER TABLE "match_events" ADD COLUMN "correction_reason" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "current_minute" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "added_minutes" integer;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_corrected_by_users_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fixture_season_status_idx" ON "fixtures" USING btree ("season_id","status");--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixture_status_check" CHECK ("fixtures"."status" in ('draft','scheduled','postponed','cancelled','completed','abandoned'));--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "match_current_minute_check" CHECK ("matches"."current_minute" is null or "matches"."current_minute" between 0 and 150);--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "match_added_minutes_check" CHECK ("matches"."added_minutes" is null or "matches"."added_minutes" between 0 and 30);--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "match_result_status_check" CHECK ("matches"."result_confirmed_at" is null or "matches"."status" = 'full_time');
