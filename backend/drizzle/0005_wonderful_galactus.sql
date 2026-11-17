-- Phase 6: lineup review lifecycle and current standings snapshot tracking.
-- Existing data is preserved. The preflight aborts rather than silently
-- discarding or reinterpreting historical lineup/standings records.
DO $$
DECLARE
	v_issues text := '';
	v_samples text;
BEGIN
	SELECT string_agg(id::text || ' (' || status || ')', ', ') INTO v_samples
	FROM lineups
	WHERE status NOT IN ('draft','submitted','published','confirmed');
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Lineups with an unrecognised status: ' || v_samples;
	END IF;

	SELECT string_agg(season_id::text || '/' || coalesce(group_id::text, 'season'), ', ') INTO v_samples
	FROM (
		SELECT season_id, group_id
		FROM standings_snapshots
		GROUP BY season_id, group_id
		HAVING count(*) > 0
			AND count(DISTINCT version) <> count(*)
	) duplicates;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Standings snapshot version collisions: ' || v_samples;
	END IF;

	IF v_issues <> '' THEN
		RAISE EXCEPTION E'Phase 6 data preflight failed. Resolve the following records manually before applying migration 0005:%', v_issues;
	END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "lineups" DROP CONSTRAINT "lineup_status_check";--> statement-breakpoint
ALTER TABLE "lineups" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lineups" ADD COLUMN "confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "lineups" ADD COLUMN "returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lineups" ADD COLUMN "returned_by" uuid;--> statement-breakpoint
ALTER TABLE "lineups" ADD COLUMN "return_reason" text;--> statement-breakpoint
ALTER TABLE "lineups" ADD CONSTRAINT "lineups_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineups" ADD CONSTRAINT "lineups_returned_by_users_id_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lineup_match_status_idx" ON "lineups" USING btree ("match_id","status");--> statement-breakpoint
ALTER TABLE "lineups" ADD CONSTRAINT "lineup_status_check" CHECK ("lineups"."status" in ('draft','submitted','published','confirmed','returned'));--> statement-breakpoint
ALTER TABLE "standings_snapshots" ADD COLUMN "is_current" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "standings_snapshots" ADD COLUMN "meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- The newest pre-existing version per season/group becomes the current one.
-- Snapshots without a current marker remain historical and are never rewritten.
UPDATE "standings_snapshots" AS s
SET "is_current" = true
FROM (
	SELECT DISTINCT ON ("season_id", "group_id") "id"
	FROM "standings_snapshots"
	ORDER BY "season_id", "group_id", "version" DESC, "calculated_at" DESC, "id" DESC
) AS latest
WHERE s."id" = latest."id";--> statement-breakpoint
CREATE UNIQUE INDEX "standings_snapshot_current_uq" ON "standings_snapshots" USING btree ("season_id",coalesce("group_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "standings_snapshots"."is_current";
