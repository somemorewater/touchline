-- Phase 3: data integrity, transaction-sensitive constraints and cross-entity
-- validation. Existing invalid rows are never deleted or reassigned: the
-- preflight below aborts the migration with a report so they can be fixed
-- manually before the constraints are applied.
CREATE OR REPLACE FUNCTION touchline_formation_outfield_count(formation text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
	SELECT COALESCE(sum(part::integer), 0)
	FROM unnest(string_to_array(formation, '-')) AS part
	WHERE part <> ''
$$;
--> statement-breakpoint
DO $$
DECLARE
	v_issues text := '';
	v_samples text;
BEGIN
	SELECT string_agg(email || ' (' || total || ')', ', ') INTO v_samples
	FROM (
		SELECT lower(email) AS email, count(*) AS total
		FROM users GROUP BY lower(email) HAVING count(*) > 1
	) duplicates;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Case-insensitive duplicate user emails: ' || v_samples;
	END IF;

	SELECT string_agg(id::text, ', ') INTO v_samples
	FROM competitions
	WHERE status NOT IN ('draft','published','registration','active','completed','archived')
		OR format NOT IN ('single-league','multiple-leagues','group-stage','knockout','league-then-knockout')
		OR visibility NOT IN ('public','private');
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Competitions with unsupported status/format/visibility: ' || v_samples;
	END IF;

	SELECT string_agg(id::text, ', ') INTO v_samples
	FROM seasons
	WHERE ends_on IS NOT NULL AND starts_on IS NOT NULL AND ends_on < starts_on;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Seasons whose end date precedes their start date: ' || v_samples;
	END IF;

	SELECT string_agg(season_id::text, ', ') INTO v_samples
	FROM competition_rules
	WHERE points_win < 0 OR points_draw < 0 OR points_loss < 0;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Competition rules with negative points: ' || v_samples;
	END IF;

	SELECT string_agg(tr.id::text, ', ') INTO v_samples
	FROM team_registrations tr
	JOIN competition_groups g ON g.id = tr.group_id
	WHERE g.season_id <> tr.season_id;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Team registrations assigned to a group from another season: ' || v_samples;
	END IF;

	SELECT string_agg(player_id::text || '@' || season_id::text, ', ') INTO v_samples
	FROM (
		SELECT pr.player_id, tr.season_id
		FROM player_registrations pr
		JOIN team_registrations tr ON tr.id = pr.team_registration_id
		WHERE pr.status IN ('submitted','under_review','approved')
		GROUP BY pr.player_id, tr.season_id
		HAVING count(*) > 1
	) duplicates;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Players with more than one active registration in a season: ' || v_samples;
	END IF;

	SELECT string_agg(season_id::text || ':' || matriculation_number, ', ') INTO v_samples
	FROM (
		SELECT tr.season_id, pr.matriculation_number
		FROM player_registrations pr
		JOIN team_registrations tr ON tr.id = pr.team_registration_id
		WHERE pr.status IN ('submitted','under_review','approved')
			AND pr.matriculation_number IS NOT NULL
		GROUP BY tr.season_id, pr.matriculation_number
		HAVING count(*) > 1
	) duplicates;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Duplicate active matriculation numbers within a season: ' || v_samples;
	END IF;

	SELECT string_agg(id::text, ', ') INTO v_samples
	FROM players
	WHERE position IS NOT NULL AND position NOT IN ('GK','DF','MF','FW');
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Players with an unsupported position: ' || v_samples;
	END IF;

	SELECT string_agg(id::text, ', ') INTO v_samples
	FROM player_registrations
	WHERE shirt_number IS NOT NULL AND (shirt_number < 1 OR shirt_number > 99);
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Player registrations with shirt numbers outside 1-99: ' || v_samples;
	END IF;

	SELECT string_agg(id::text, ', ') INTO v_samples
	FROM fixtures
	WHERE home_team_registration_id = away_team_registration_id;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Fixtures where a team plays itself: ' || v_samples;
	END IF;

	SELECT string_agg(f.id::text, ', ') INTO v_samples
	FROM fixtures f
	JOIN team_registrations h ON h.id = f.home_team_registration_id
	JOIN team_registrations a ON a.id = f.away_team_registration_id
	WHERE h.season_id <> f.season_id OR a.season_id <> f.season_id;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Fixtures whose participants belong to another season: ' || v_samples;
	END IF;

	SELECT string_agg(f.id::text, ', ') INTO v_samples
	FROM fixtures f
	JOIN competition_groups g ON g.id = f.group_id
	WHERE g.season_id <> f.season_id;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Fixtures assigned to a group from another season: ' || v_samples;
	END IF;

	SELECT string_agg(season_id::text || '/' || coalesce(group_id::text, '-') || '/' || home_team_registration_id::text || '/' || away_team_registration_id::text || '/' || coalesce(round::text, '-'), ', ') INTO v_samples
	FROM (
		SELECT season_id, group_id, home_team_registration_id, away_team_registration_id, round
		FROM fixtures
		GROUP BY season_id, group_id, home_team_registration_id, away_team_registration_id, round
		HAVING count(*) > 1
	) duplicates;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Duplicate fixtures with the same season/group/home/away/round: ' || v_samples;
	END IF;

	SELECT string_agg(id::text, ', ') INTO v_samples
	FROM fixtures
	WHERE round IS NOT NULL AND round <= 0;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Fixtures with a non-positive round: ' || v_samples;
	END IF;

	SELECT string_agg(id::text, ', ') INTO v_samples
	FROM matches
	WHERE home_score < 0 OR away_score < 0;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Matches with a negative score: ' || v_samples;
	END IF;

	SELECT string_agg(id::text, ', ') INTO v_samples
	FROM matches
	WHERE started_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at < started_at;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Matches ending before they started: ' || v_samples;
	END IF;

	SELECT string_agg(id::text, ', ') INTO v_samples
	FROM match_events
	WHERE event_type NOT IN ('goal','own-goal','yellow-card','second-yellow','red-card','substitution','injury','penalty-awarded','penalty-scored','penalty-missed','kickoff','half-time','full-time');
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Match events with an unsupported event type: ' || v_samples;
	END IF;

	SELECT string_agg(id::text, ', ') INTO v_samples
	FROM match_events
	WHERE minute < 0 OR minute > 150 OR (added_minutes IS NOT NULL AND (added_minutes < 0 OR added_minutes > 30));
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Match events with an invalid minute or added-time value: ' || v_samples;
	END IF;

	SELECT string_agg(id::text, ', ') INTO v_samples
	FROM match_events
	WHERE event_type = 'substitution'
		AND (player_registration_id IS NULL OR secondary_player_registration_id IS NULL);
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Substitutions missing the player coming on or off: ' || v_samples;
	END IF;

	SELECT string_agg(id::text, ', ') INTO v_samples
	FROM match_events
	WHERE player_registration_id IS NOT NULL
		AND player_registration_id = secondary_player_registration_id;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Match events using the same player twice: ' || v_samples;
	END IF;

	SELECT string_agg(e.id::text, ', ') INTO v_samples
	FROM match_events e
	JOIN player_registrations p ON p.id = e.player_registration_id
	WHERE e.team_registration_id IS NOT NULL
		AND p.team_registration_id <> e.team_registration_id;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Match events whose player belongs to another team than the event team: ' || v_samples;
	END IF;

	SELECT string_agg(e.id::text, ', ') INTO v_samples
	FROM match_events e
	JOIN player_registrations p ON p.id = e.secondary_player_registration_id
	WHERE e.team_registration_id IS NOT NULL
		AND p.team_registration_id <> e.team_registration_id;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Match events whose secondary player belongs to another team than the event team: ' || v_samples;
	END IF;

	SELECT string_agg(e.id::text, ', ') INTO v_samples
	FROM match_events e
	JOIN player_registrations p1 ON p1.id = e.player_registration_id
	JOIN player_registrations p2 ON p2.id = e.secondary_player_registration_id
	WHERE p1.team_registration_id <> p2.team_registration_id;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Match events linking players from different teams: ' || v_samples;
	END IF;

	SELECT string_agg(e.id::text, ', ') INTO v_samples
	FROM match_events e
	JOIN matches m ON m.id = e.match_id
	JOIN fixtures f ON f.id = m.fixture_id
	WHERE (e.team_registration_id IS NOT NULL AND e.team_registration_id NOT IN (f.home_team_registration_id, f.away_team_registration_id))
		OR (e.player_registration_id IS NOT NULL AND EXISTS (
			SELECT 1 FROM player_registrations p
			WHERE p.id = e.player_registration_id
				AND p.team_registration_id NOT IN (f.home_team_registration_id, f.away_team_registration_id)
		))
		OR (e.secondary_player_registration_id IS NOT NULL AND EXISTS (
			SELECT 1 FROM player_registrations p
			WHERE p.id = e.secondary_player_registration_id
				AND p.team_registration_id NOT IN (f.home_team_registration_id, f.away_team_registration_id)
		));
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Match events referencing a team or player outside the match: ' || v_samples;
	END IF;

	SELECT string_agg(id::text, ', ') INTO v_samples
	FROM lineups
	WHERE status NOT IN ('draft','submitted','published','confirmed');
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Lineups with an unsupported status: ' || v_samples;
	END IF;

	SELECT string_agg(id::text, ', ') INTO v_samples
	FROM lineups
	WHERE formation IS NOT NULL AND CASE
		WHEN formation ~ '^[1-9][0-9]*(-[1-9][0-9]*)+$'
			THEN touchline_formation_outfield_count(formation) <> 10
		ELSE true
	END;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Lineups with an invalid 10-outfield formation: ' || v_samples;
	END IF;

	SELECT string_agg(l.id::text, ', ') INTO v_samples
	FROM lineups l
	JOIN matches m ON m.id = l.match_id
	JOIN fixtures f ON f.id = m.fixture_id
	WHERE l.team_registration_id NOT IN (f.home_team_registration_id, f.away_team_registration_id);
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Lineups for a team that does not participate in the match: ' || v_samples;
	END IF;

	SELECT string_agg(lp.lineup_id::text || '/' || lp.player_registration_id::text, ', ') INTO v_samples
	FROM lineup_players lp
	JOIN lineups l ON l.id = lp.lineup_id
	JOIN player_registrations pr ON pr.id = lp.player_registration_id
	WHERE pr.team_registration_id <> l.team_registration_id;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Lineup players registered to the opposing team: ' || v_samples;
	END IF;

	SELECT string_agg(match_id::text || '/' || player_registration_id::text, ', ') INTO v_samples
	FROM (
		SELECT l.match_id, lp.player_registration_id
		FROM lineup_players lp
		JOIN lineups l ON l.id = lp.lineup_id
		GROUP BY l.match_id, lp.player_registration_id
		HAVING count(*) > 1
	) duplicates;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Players listed in more than one lineup for the same match: ' || v_samples;
	END IF;

	SELECT string_agg(lineup_id::text, ', ') INTO v_samples
	FROM (
		SELECT lineup_id FROM lineup_players WHERE is_captain GROUP BY lineup_id HAVING count(*) > 1
	) duplicates;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Lineups with more than one captain: ' || v_samples;
	END IF;

	SELECT string_agg(lineup_id::text || '/' || player_registration_id::text, ', ') INTO v_samples
	FROM lineup_players
	WHERE role NOT IN ('starter','substitute','unavailable')
		OR (position IS NOT NULL AND position NOT IN ('GK','DF','MF','FW'))
		OR (shirt_number IS NOT NULL AND (shirt_number < 1 OR shirt_number > 99))
		OR ((x IS NULL) <> (y IS NULL))
		OR (x IS NOT NULL AND (x < 0 OR x > 100))
		OR (y IS NOT NULL AND (y < 0 OR y > 100));
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Lineup players with an invalid role, position, shirt number or pitch coordinate: ' || v_samples;
	END IF;

	SELECT string_agg(season_id::text || '/' || coalesce(group_id::text, '-'), ', ') INTO v_samples
	FROM (
		SELECT season_id, group_id FROM standings_snapshots GROUP BY season_id, group_id HAVING count(*) > 1
	) duplicates;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Duplicate standings snapshots for the same season/group before versioning: ' || v_samples;
	END IF;

	SELECT string_agg(a.id::text, ', ') INTO v_samples
	FROM announcements a
	JOIN seasons s ON s.id = a.season_id
	WHERE a.competition_id IS NULL OR s.competition_id <> a.competition_id;
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Announcements whose season belongs to another competition: ' || v_samples;
	END IF;

	SELECT string_agg(id::text, ', ') INTO v_samples
	FROM uploaded_files
	WHERE size_bytes < 0 OR (sha256 IS NOT NULL AND sha256 !~ '^[0-9a-f]{64}$');
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Uploaded files with a negative size or malformed SHA-256: ' || v_samples;
	END IF;

	IF v_issues <> '' THEN
		RAISE EXCEPTION E'Phase 3 data-integrity preflight failed. Resolve the following records manually before applying migration 0002:%', v_issues;
	END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "fixtures" DROP CONSTRAINT "fixtures_home_team_registration_id_team_registrations_id_fk";
--> statement-breakpoint
ALTER TABLE "fixtures" DROP CONSTRAINT "fixtures_away_team_registration_id_team_registrations_id_fk";
--> statement-breakpoint
DROP INDEX "player_matriculation_season_uq";
--> statement-breakpoint
ALTER TABLE "lineup_players" ADD COLUMN "match_id" uuid;
--> statement-breakpoint
ALTER TABLE "lineup_players" ADD COLUMN "team_registration_id" uuid;
--> statement-breakpoint
ALTER TABLE "player_registrations" ADD COLUMN "season_id" uuid;
--> statement-breakpoint
ALTER TABLE "standings_snapshots" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
UPDATE "player_registrations" AS pr
SET "season_id" = tr."season_id"
FROM "team_registrations" AS tr
WHERE tr."id" = pr."team_registration_id";
--> statement-breakpoint
UPDATE "lineup_players" AS lp
SET "match_id" = l."match_id",
	"team_registration_id" = l."team_registration_id"
FROM "lineups" AS l
WHERE l."id" = lp."lineup_id";
--> statement-breakpoint
ALTER TABLE "player_registrations" ALTER COLUMN "season_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "lineup_players" ALTER COLUMN "match_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "lineup_players" ALTER COLUMN "team_registration_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "competition_groups" ADD CONSTRAINT "group_id_season_uq" UNIQUE("id","season_id");
--> statement-breakpoint
ALTER TABLE "team_registrations" ADD CONSTRAINT "team_registration_id_season_uq" UNIQUE("id","season_id");
--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "season_competition_id_uq" UNIQUE("competition_id","id");
--> statement-breakpoint
ALTER TABLE "player_registrations" ADD CONSTRAINT "player_registration_id_team_uq" UNIQUE("id","team_registration_id");
--> statement-breakpoint
ALTER TABLE "lineups" ADD CONSTRAINT "lineup_id_match_uq" UNIQUE("id","match_id");
--> statement-breakpoint
ALTER TABLE "lineups" ADD CONSTRAINT "lineup_id_team_uq" UNIQUE("id","team_registration_id");
--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixture_identity_uq" UNIQUE NULLS NOT DISTINCT("season_id","group_id","home_team_registration_id","away_team_registration_id","round");
--> statement-breakpoint
ALTER TABLE "standings_snapshots" ADD CONSTRAINT "standings_snapshot_version_uq" UNIQUE NULLS NOT DISTINCT("season_id","group_id","version");
--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_competition_season_fk" FOREIGN KEY ("competition_id","season_id") REFERENCES "public"."seasons"("competition_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_home_team_season_fk" FOREIGN KEY ("home_team_registration_id","season_id") REFERENCES "public"."team_registrations"("id","season_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_away_team_season_fk" FOREIGN KEY ("away_team_registration_id","season_id") REFERENCES "public"."team_registrations"("id","season_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_group_season_fk" FOREIGN KEY ("group_id","season_id") REFERENCES "public"."competition_groups"("id","season_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lineup_players" ADD CONSTRAINT "lineup_players_lineup_match_fk" FOREIGN KEY ("lineup_id","match_id") REFERENCES "public"."lineups"("id","match_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lineup_players" ADD CONSTRAINT "lineup_players_lineup_team_fk" FOREIGN KEY ("lineup_id","team_registration_id") REFERENCES "public"."lineups"("id","team_registration_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lineup_players" ADD CONSTRAINT "lineup_players_player_team_fk" FOREIGN KEY ("player_registration_id","team_registration_id") REFERENCES "public"."player_registrations"("id","team_registration_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "player_registrations" ADD CONSTRAINT "player_registrations_team_season_fk" FOREIGN KEY ("team_registration_id","season_id") REFERENCES "public"."team_registrations"("id","season_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "standings_snapshots" ADD CONSTRAINT "standings_snapshots_group_season_fk" FOREIGN KEY ("group_id","season_id") REFERENCES "public"."competition_groups"("id","season_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "team_registrations" ADD CONSTRAINT "team_registrations_group_season_fk" FOREIGN KEY ("group_id","season_id") REFERENCES "public"."competition_groups"("id","season_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "announcement_competition_idx" ON "announcements" USING btree ("competition_id","published_at");
--> statement-breakpoint
CREATE INDEX "fixture_home_team_idx" ON "fixtures" USING btree ("home_team_registration_id");
--> statement-breakpoint
CREATE INDEX "fixture_away_team_idx" ON "fixtures" USING btree ("away_team_registration_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "lineup_player_match_uq" ON "lineup_players" USING btree ("match_id","player_registration_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "lineup_one_captain_uq" ON "lineup_players" USING btree ("lineup_id") WHERE "lineup_players"."is_captain";
--> statement-breakpoint
CREATE INDEX "lineup_player_registration_idx" ON "lineup_players" USING btree ("player_registration_id");
--> statement-breakpoint
CREATE INDEX "lineup_team_idx" ON "lineups" USING btree ("team_registration_id");
--> statement-breakpoint
CREATE INDEX "match_event_player_idx" ON "match_events" USING btree ("player_registration_id","match_id");
--> statement-breakpoint
CREATE INDEX "match_event_secondary_player_idx" ON "match_events" USING btree ("secondary_player_registration_id","match_id");
--> statement-breakpoint
CREATE INDEX "match_event_team_idx" ON "match_events" USING btree ("team_registration_id","match_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "player_season_active_uq" ON "player_registrations" USING btree ("player_id","season_id") WHERE "player_registrations"."status" in ('submitted','under_review','approved');
--> statement-breakpoint
CREATE UNIQUE INDEX "player_matriculation_active_season_uq" ON "player_registrations" USING btree ("season_id","matriculation_number") WHERE "player_registrations"."matriculation_number" is not null and "player_registrations"."status" in ('submitted','under_review','approved');
--> statement-breakpoint
CREATE INDEX "player_reg_season_status_idx" ON "player_registrations" USING btree ("season_id","status");
--> statement-breakpoint
CREATE INDEX "team_reg_season_group_idx" ON "team_registrations" USING btree ("season_id","group_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));
--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcement_season_competition_check" CHECK ("announcements"."season_id" is null or "announcements"."competition_id" is not null);
--> statement-breakpoint
ALTER TABLE "competition_groups" ADD CONSTRAINT "competition_group_kind_check" CHECK ("competition_groups"."kind" in ('league','group'));
--> statement-breakpoint
ALTER TABLE "competition_rules" ADD CONSTRAINT "competition_rules_points_check" CHECK ("competition_rules"."points_win" >= 0 and "competition_rules"."points_draw" >= 0 and "competition_rules"."points_loss" >= 0);
--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competition_status_check" CHECK ("competitions"."status" in ('draft','published','registration','active','completed','archived'));
--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competition_format_check" CHECK ("competitions"."format" in ('single-league','multiple-leagues','group-stage','knockout','league-then-knockout'));
--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competition_visibility_check" CHECK ("competitions"."visibility" in ('public','private'));
--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixture_distinct_teams_check" CHECK ("fixtures"."home_team_registration_id" <> "fixtures"."away_team_registration_id");
--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixture_round_check" CHECK ("fixtures"."round" is null or "fixtures"."round" > 0);
--> statement-breakpoint
ALTER TABLE "lineup_players" ADD CONSTRAINT "lineup_player_role_check" CHECK ("lineup_players"."role" in ('starter','substitute','unavailable'));
--> statement-breakpoint
ALTER TABLE "lineup_players" ADD CONSTRAINT "lineup_player_position_check" CHECK ("lineup_players"."position" is null or "lineup_players"."position" in ('GK','DF','MF','FW'));
--> statement-breakpoint
ALTER TABLE "lineup_players" ADD CONSTRAINT "lineup_player_shirt_check" CHECK ("lineup_players"."shirt_number" is null or "lineup_players"."shirt_number" between 1 and 99);
--> statement-breakpoint
ALTER TABLE "lineup_players" ADD CONSTRAINT "lineup_player_coordinates_check" CHECK ((("lineup_players"."x" is null and "lineup_players"."y" is null) or ("lineup_players"."x" is not null and "lineup_players"."y" is not null and "lineup_players"."x" between 0 and 100 and "lineup_players"."y" between 0 and 100)));
--> statement-breakpoint
ALTER TABLE "lineups" ADD CONSTRAINT "lineup_status_check" CHECK ("lineups"."status" in ('draft','submitted','published','confirmed'));
--> statement-breakpoint
ALTER TABLE "lineups" ADD CONSTRAINT "lineup_formation_check" CHECK ("lineups"."formation" is null or case when "lineups"."formation" ~ '^[1-9][0-9]*(-[1-9][0-9]*)+$' then touchline_formation_outfield_count("lineups"."formation") = 10 else false end);
--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_event_type_check" CHECK ("match_events"."event_type" in ('goal','own-goal','yellow-card','second-yellow','red-card','substitution','injury','penalty-awarded','penalty-scored','penalty-missed','kickoff','half-time','full-time'));
--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_event_minute_check" CHECK ("match_events"."minute" between 0 and 150);
--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_event_added_minutes_check" CHECK ("match_events"."added_minutes" is null or "match_events"."added_minutes" between 0 and 30);
--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_event_distinct_players_check" CHECK ("match_events"."player_registration_id" is null or "match_events"."secondary_player_registration_id" is null or "match_events"."player_registration_id" <> "match_events"."secondary_player_registration_id");
--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_event_substitution_players_check" CHECK ("match_events"."event_type" <> 'substitution' or ("match_events"."player_registration_id" is not null and "match_events"."secondary_player_registration_id" is not null));
--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "match_scores_non_negative_check" CHECK ("matches"."home_score" >= 0 and "matches"."away_score" >= 0);
--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "match_times_check" CHECK ("matches"."started_at" is null or "matches"."ended_at" is null or "matches"."ended_at" >= "matches"."started_at");
--> statement-breakpoint
ALTER TABLE "player_registrations" ADD CONSTRAINT "player_registration_shirt_check" CHECK ("player_registrations"."shirt_number" is null or "player_registrations"."shirt_number" between 1 and 99);
--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "player_position_check" CHECK ("players"."position" is null or "players"."position" in ('GK','DF','MF','FW'));
--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "season_dates_check" CHECK ("seasons"."ends_on" is null or "seasons"."starts_on" is null or "seasons"."ends_on" >= "seasons"."starts_on");
--> statement-breakpoint
ALTER TABLE "standings_snapshots" ADD CONSTRAINT "standings_snapshot_version_check" CHECK ("standings_snapshots"."version" > 0);
--> statement-breakpoint
ALTER TABLE "uploaded_files" ADD CONSTRAINT "uploaded_file_size_check" CHECK ("uploaded_files"."size_bytes" >= 0);
--> statement-breakpoint
ALTER TABLE "uploaded_files" ADD CONSTRAINT "uploaded_file_sha256_check" CHECK ("uploaded_files"."sha256" is null or "uploaded_files"."sha256" ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION touchline_assert_match_team(p_match_id uuid, p_team_registration_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	v_home uuid;
	v_away uuid;
	v_found boolean;
BEGIN
	SELECT f.home_team_registration_id, f.away_team_registration_id
	INTO v_home, v_away
	FROM matches m
	JOIN fixtures f ON f.id = m.fixture_id
	WHERE m.id = p_match_id;
	v_found := FOUND;

	IF NOT v_found THEN
		RAISE EXCEPTION 'Match % does not exist', p_match_id USING ERRCODE = '23503';
	END IF;

	IF p_team_registration_id IS NULL
		OR p_team_registration_id NOT IN (v_home, v_away) THEN
		RAISE EXCEPTION 'Team registration % does not participate in match %', p_team_registration_id, p_match_id USING ERRCODE = '23514';
	END IF;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION touchline_validate_lineup()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	PERFORM touchline_assert_match_team(NEW.match_id, NEW.team_registration_id);
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION touchline_validate_match_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	v_home uuid;
	v_away uuid;
	v_season uuid;
	v_found boolean;
	v_player_team uuid;
	v_player_season uuid;
	v_secondary_team uuid;
	v_secondary_season uuid;
BEGIN
	SELECT f.home_team_registration_id, f.away_team_registration_id, f.season_id
	INTO v_home, v_away, v_season
	FROM matches m
	JOIN fixtures f ON f.id = m.fixture_id
	WHERE m.id = NEW.match_id;
	v_found := FOUND;

	IF NOT v_found THEN
		RAISE EXCEPTION 'Match % does not exist', NEW.match_id USING ERRCODE = '23503';
	END IF;

	IF NEW.team_registration_id IS NOT NULL
		AND NEW.team_registration_id NOT IN (v_home, v_away) THEN
		RAISE EXCEPTION 'Event team registration % does not participate in match %', NEW.team_registration_id, NEW.match_id USING ERRCODE = '23514';
	END IF;

	IF NEW.player_registration_id IS NOT NULL THEN
		SELECT pr.team_registration_id, tr.season_id
		INTO v_player_team, v_player_season
		FROM player_registrations pr
		JOIN team_registrations tr ON tr.id = pr.team_registration_id
		WHERE pr.id = NEW.player_registration_id;

		IF v_player_team IS NULL THEN
			RAISE EXCEPTION 'Player registration % does not exist', NEW.player_registration_id USING ERRCODE = '23503';
		END IF;
		IF v_player_team NOT IN (v_home, v_away) THEN
			RAISE EXCEPTION 'Player registration % does not participate in match %', NEW.player_registration_id, NEW.match_id USING ERRCODE = '23514';
		END IF;
		IF v_player_season <> v_season THEN
			RAISE EXCEPTION 'Player registration % belongs to another season than match %', NEW.player_registration_id, NEW.match_id USING ERRCODE = '23514';
		END IF;
		IF NEW.team_registration_id IS NOT NULL AND v_player_team <> NEW.team_registration_id THEN
			RAISE EXCEPTION 'Player registration % belongs to another team than the event team', NEW.player_registration_id USING ERRCODE = '23514';
		END IF;
	END IF;

	IF NEW.secondary_player_registration_id IS NOT NULL THEN
		SELECT pr.team_registration_id, tr.season_id
		INTO v_secondary_team, v_secondary_season
		FROM player_registrations pr
		JOIN team_registrations tr ON tr.id = pr.team_registration_id
		WHERE pr.id = NEW.secondary_player_registration_id;

		IF v_secondary_team IS NULL THEN
			RAISE EXCEPTION 'Secondary player registration % does not exist', NEW.secondary_player_registration_id USING ERRCODE = '23503';
		END IF;
		IF v_secondary_team NOT IN (v_home, v_away) THEN
			RAISE EXCEPTION 'Secondary player registration % does not participate in match %', NEW.secondary_player_registration_id, NEW.match_id USING ERRCODE = '23514';
		END IF;
		IF v_secondary_season <> v_season THEN
			RAISE EXCEPTION 'Secondary player registration % belongs to another season than match %', NEW.secondary_player_registration_id, NEW.match_id USING ERRCODE = '23514';
		END IF;
		IF NEW.team_registration_id IS NOT NULL AND v_secondary_team <> NEW.team_registration_id THEN
			RAISE EXCEPTION 'Secondary player registration % belongs to another team than the event team', NEW.secondary_player_registration_id USING ERRCODE = '23514';
		END IF;
		IF NEW.player_registration_id IS NOT NULL AND v_secondary_team <> v_player_team THEN
			RAISE EXCEPTION 'Event players must belong to the same team' USING ERRCODE = '23514';
		END IF;
	END IF;

	RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS lineups_participant_trg ON "lineups";
--> statement-breakpoint
CREATE TRIGGER lineups_participant_trg
BEFORE INSERT OR UPDATE OF match_id, team_registration_id ON "lineups"
FOR EACH ROW EXECUTE FUNCTION touchline_validate_lineup();
--> statement-breakpoint
DROP TRIGGER IF EXISTS match_events_consistency_trg ON "match_events";
--> statement-breakpoint
CREATE TRIGGER match_events_consistency_trg
BEFORE INSERT OR UPDATE OF match_id, team_registration_id, player_registration_id, secondary_player_registration_id ON "match_events"
FOR EACH ROW EXECUTE FUNCTION touchline_validate_match_event();
