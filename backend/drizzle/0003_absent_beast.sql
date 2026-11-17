-- Phase 4: competition management metadata. Existing rows are never rewritten.
-- The preflight aborts the migration with a report if existing data would make
-- the new uniqueness or lifecycle constraints unsafe.
DO $$
DECLARE
	v_issues text := '';
	v_samples text;
BEGIN
	SELECT string_agg(id::text || ' (' || status || ')', ', ') INTO v_samples
	FROM seasons
	WHERE status NOT IN ('planned','active','completed','archived');
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Seasons with an unsupported status: ' || v_samples;
	END IF;

	SELECT string_agg(lower_name || ' (' || total || ')', ', ') INTO v_samples
	FROM (
		SELECT lower(name) AS lower_name, count(*) AS total
		FROM teams
		WHERE archived_at IS NULL
		GROUP BY lower(name)
		HAVING count(*) > 1
	) duplicates;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Active teams whose names differ only by case: ' || v_samples;
	END IF;

	IF v_issues <> '' THEN
		RAISE EXCEPTION E'Phase 4 data preflight failed. Resolve the following records manually before applying migration 0003:%', v_issues;
	END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "competition_groups" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "player_registrations" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "team_registrations" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "team_name_lower_uq" ON "teams" USING btree (lower("name")) WHERE "teams"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "season_status_check" CHECK ("seasons"."status" in ('planned','active','completed','archived'));
