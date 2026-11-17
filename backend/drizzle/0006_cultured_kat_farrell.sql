-- Phase 7: administration, disciplinary cases, disputes, evidence, announcements
-- and notifications. Existing Phase 1-6 data is preserved. The preflight aborts
-- rather than reinterpreting historical records.
DO $$
DECLARE
	v_issues text := '';
	v_samples text;
BEGIN
	SELECT string_agg(id::text || ' (' || coalesce(audience, '<null>') || ')', ', ') INTO v_samples
	FROM announcements
	WHERE audience NOT IN ('public','participants','captains','officials','administrators');
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Announcements with an unrecognised audience: ' || v_samples;
	END IF;

	SELECT string_agg(id::text, ', ') INTO v_samples
	FROM uploaded_files
	WHERE storage_key IS NULL OR btrim(storage_key) = '';
	IF v_samples IS NOT NULL THEN
		v_issues := v_issues || E'\n- Uploaded files without a storage key: ' || v_samples;
	END IF;

	IF v_issues <> '' THEN
		RAISE EXCEPTION E'Phase 7 data preflight failed. Resolve the following records manually before applying migration 0006:%', v_issues;
	END IF;
END
$$;
--> statement-breakpoint
CREATE TABLE "disciplinary_case_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"entry_type" varchar(28) NOT NULL,
	"body" text,
	"from_status" varchar(24),
	"to_status" varchar(24),
	"actor_user_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disciplinary_case_entry_type_check" CHECK ("disciplinary_case_entries"."entry_type" in ('status_change','reviewer_assigned','finding','response','decision','appeal','note','sanction'))
);
--> statement-breakpoint
CREATE TABLE "disciplinary_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"season_id" uuid,
	"subject_type" varchar(20) NOT NULL,
	"subject_player_registration_id" uuid,
	"subject_user_id" uuid,
	"subject_team_registration_id" uuid,
	"origin_type" varchar(32) DEFAULT 'competition_administration' NOT NULL,
	"origin_match_id" uuid,
	"origin_event_id" uuid,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"status" varchar(24) DEFAULT 'open' NOT NULL,
	"assigned_reviewer_id" uuid,
	"created_by" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disciplinary_case_status_check" CHECK ("disciplinary_cases"."status" in ('open','under_review','awaiting_response','decided','appealed','closed')),
	CONSTRAINT "disciplinary_case_subject_check" CHECK ("disciplinary_cases"."subject_type" in ('player','team','official','match','other') and ("disciplinary_cases"."subject_player_registration_id" is not null or "disciplinary_cases"."subject_user_id" is not null or "disciplinary_cases"."subject_team_registration_id" is not null or "disciplinary_cases"."origin_match_id" is not null)),
	CONSTRAINT "disciplinary_case_origin_check" CHECK ("disciplinary_cases"."origin_type" in ('match_event','referee_report','competition_administration','other')),
	CONSTRAINT "disciplinary_case_closure_check" CHECK ("disciplinary_cases"."status" <> 'closed' or ("disciplinary_cases"."closed_at" is not null and "disciplinary_cases"."closure_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "disciplinary_sanctions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"season_id" uuid,
	"subject_type" varchar(20) NOT NULL,
	"subject_player_registration_id" uuid,
	"subject_user_id" uuid,
	"subject_team_registration_id" uuid,
	"sanction_type" varchar(28) NOT NULL,
	"reason" text NOT NULL,
	"matches_count" integer,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disciplinary_sanction_type_check" CHECK ("disciplinary_sanctions"."sanction_type" in ('warning','match_suspension','competition_suspension','other')),
	CONSTRAINT "disciplinary_sanction_status_check" CHECK ("disciplinary_sanctions"."status" in ('active','served','appealed','revoked')),
	CONSTRAINT "disciplinary_sanction_subject_check" CHECK ("disciplinary_sanctions"."subject_type" in ('player','team','official','other')),
	CONSTRAINT "disciplinary_sanction_dates_check" CHECK ("disciplinary_sanctions"."ends_at" is null or "disciplinary_sanctions"."starts_at" is null or "disciplinary_sanctions"."ends_at" >= "disciplinary_sanctions"."starts_at"),
	CONSTRAINT "disciplinary_sanction_count_check" CHECK ("disciplinary_sanctions"."matches_count" is null or "disciplinary_sanctions"."matches_count" > 0),
	CONSTRAINT "disciplinary_sanction_scope_check" CHECK (("disciplinary_sanctions"."sanction_type" not in ('match_suspension','competition_suspension')) or ("disciplinary_sanctions"."matches_count" is not null or "disciplinary_sanctions"."ends_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "dispute_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"entry_type" varchar(28) NOT NULL,
	"body" text,
	"from_status" varchar(24),
	"to_status" varchar(24),
	"actor_user_id" uuid,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispute_entry_type_check" CHECK ("dispute_entries"."entry_type" in ('status_change','reviewer_assigned','response','information_request','information_provided','decision','note'))
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"season_id" uuid,
	"match_id" uuid,
	"team_registration_id" uuid,
	"subject_type" varchar(32) NOT NULL,
	"subject_ref_id" uuid,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"assigned_reviewer_id" uuid,
	"outcome" varchar(24),
	"decision" text,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispute_status_check" CHECK ("disputes"."status" in ('draft','submitted','under_review','awaiting_information','decided','closed')),
	CONSTRAINT "dispute_subject_check" CHECK ("disputes"."subject_type" in ('match_result','match_event','player_eligibility','team_participation','competition_decision','other')),
	CONSTRAINT "dispute_outcome_check" CHECK ("disputes"."outcome" is null or "disputes"."outcome" in ('accepted','rejected','partially_accepted','no_action')),
	CONSTRAINT "dispute_decision_check" CHECK ("disputes"."status" not in ('decided','closed') or "disputes"."decision" is not null),
	CONSTRAINT "dispute_closure_check" CHECK ("disputes"."status" <> 'closed' or ("disputes"."closed_at" is not null and "disputes"."closure_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "evidence_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"case_id" uuid,
	"dispute_id" uuid,
	"attached_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"removal_reason" text,
	CONSTRAINT "evidence_target_check" CHECK (("evidence_files"."case_id" is not null and "evidence_files"."dispute_id" is null) or ("evidence_files"."case_id" is null and "evidence_files"."dispute_id" is not null)),
	CONSTRAINT "evidence_removal_check" CHECK (("evidence_files"."removed_at" is null and "evidence_files"."removed_by" is null) or ("evidence_files"."removed_at" is not null and "evidence_files"."removed_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" varchar(20) DEFAULT 'in_app' NOT NULL,
	"status" varchar(20) DEFAULT 'delivered' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_delivery_channel_check" CHECK ("notification_deliveries"."channel" in ('in_app','email')),
	CONSTRAINT "notification_delivery_status_check" CHECK ("notification_deliveries"."status" in ('pending','delivered','failed','skipped')),
	CONSTRAINT "notification_delivery_attempts_check" CHECK ("notification_deliveries"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(60) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"entity_type" varchar(80),
	"entity_id" uuid,
	"competition_id" uuid,
	"dedupe_key" varchar(200),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "competition_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "season_id" uuid;--> statement-breakpoint
-- Derive competition/season scope for historical audit rows where the entity
-- relationship makes it unambiguous. Historical rows stay otherwise unchanged.
UPDATE audit_logs AS a
SET competition_id = f_season.competition_id,
    season_id = f_season.id
FROM matches m
JOIN fixtures f ON f.id = m.fixture_id
JOIN seasons f_season ON f_season.id = f.season_id
WHERE a.entity_type = 'match' AND a.entity_id = m.id
  AND a.competition_id IS NULL;--> statement-breakpoint
UPDATE audit_logs AS a
SET competition_id = s.competition_id,
    season_id = s.id
FROM seasons s
WHERE a.entity_type = 'season' AND a.entity_id = s.id
  AND a.competition_id IS NULL;--> statement-breakpoint
UPDATE audit_logs AS a
SET competition_id = s.competition_id,
    season_id = s.id
FROM player_registrations pr
JOIN seasons s ON s.id = pr.season_id
WHERE a.entity_type = 'player_registration' AND a.entity_id = pr.id
  AND a.competition_id IS NULL;--> statement-breakpoint
UPDATE audit_logs AS a
SET competition_id = s.competition_id,
    season_id = tr.season_id
FROM team_registrations tr
JOIN seasons s ON s.id = tr.season_id
WHERE a.entity_type = 'team_registration' AND a.entity_id = tr.id
  AND a.competition_id IS NULL;--> statement-breakpoint
UPDATE audit_logs AS a
SET competition_id = s.competition_id,
    season_id = s.id
FROM fixtures f
JOIN seasons s ON s.id = f.season_id
WHERE a.entity_type = 'fixture' AND a.entity_id = f.id
  AND a.competition_id IS NULL;--> statement-breakpoint
UPDATE audit_logs AS a
SET competition_id = s.competition_id,
    season_id = f.season_id
FROM lineups l
JOIN matches m ON m.id = l.match_id
JOIN fixtures f ON f.id = m.fixture_id
JOIN seasons s ON s.id = f.season_id
WHERE a.entity_type = 'lineup' AND a.entity_id = l.id
  AND a.competition_id IS NULL;--> statement-breakpoint
UPDATE audit_logs AS a
SET competition_id = an.competition_id,
    season_id = an.season_id
FROM announcements an
WHERE a.entity_type = 'announcement' AND a.entity_id = an.id
  AND a.competition_id IS NULL;--> statement-breakpoint
ALTER TABLE "uploaded_files" ADD COLUMN "storage_provider" varchar(30) DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_by" uuid;--> statement-breakpoint
ALTER TABLE "disciplinary_case_entries" ADD CONSTRAINT "disciplinary_case_entries_case_id_disciplinary_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."disciplinary_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_case_entries" ADD CONSTRAINT "disciplinary_case_entries_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_cases" ADD CONSTRAINT "disciplinary_cases_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_cases" ADD CONSTRAINT "disciplinary_cases_subject_player_registration_id_player_registrations_id_fk" FOREIGN KEY ("subject_player_registration_id") REFERENCES "public"."player_registrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_cases" ADD CONSTRAINT "disciplinary_cases_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_cases" ADD CONSTRAINT "disciplinary_cases_subject_team_registration_id_team_registrations_id_fk" FOREIGN KEY ("subject_team_registration_id") REFERENCES "public"."team_registrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_cases" ADD CONSTRAINT "disciplinary_cases_origin_match_id_matches_id_fk" FOREIGN KEY ("origin_match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_cases" ADD CONSTRAINT "disciplinary_cases_origin_event_id_match_events_id_fk" FOREIGN KEY ("origin_event_id") REFERENCES "public"."match_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_cases" ADD CONSTRAINT "disciplinary_cases_assigned_reviewer_id_users_id_fk" FOREIGN KEY ("assigned_reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_cases" ADD CONSTRAINT "disciplinary_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_cases" ADD CONSTRAINT "disciplinary_cases_season_competition_fk" FOREIGN KEY ("season_id","competition_id") REFERENCES "public"."seasons"("id","competition_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_cases" ADD CONSTRAINT "disciplinary_cases_team_season_fk" FOREIGN KEY ("subject_team_registration_id","season_id") REFERENCES "public"."team_registrations"("id","season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_sanctions" ADD CONSTRAINT "disciplinary_sanctions_case_id_disciplinary_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."disciplinary_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_sanctions" ADD CONSTRAINT "disciplinary_sanctions_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_sanctions" ADD CONSTRAINT "disciplinary_sanctions_subject_player_registration_id_player_registrations_id_fk" FOREIGN KEY ("subject_player_registration_id") REFERENCES "public"."player_registrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_sanctions" ADD CONSTRAINT "disciplinary_sanctions_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_sanctions" ADD CONSTRAINT "disciplinary_sanctions_subject_team_registration_id_team_registrations_id_fk" FOREIGN KEY ("subject_team_registration_id") REFERENCES "public"."team_registrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_sanctions" ADD CONSTRAINT "disciplinary_sanctions_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_sanctions" ADD CONSTRAINT "disciplinary_sanctions_season_competition_fk" FOREIGN KEY ("season_id","competition_id") REFERENCES "public"."seasons"("id","competition_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_entries" ADD CONSTRAINT "dispute_entries_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_entries" ADD CONSTRAINT "dispute_entries_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_team_registration_id_team_registrations_id_fk" FOREIGN KEY ("team_registration_id") REFERENCES "public"."team_registrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_assigned_reviewer_id_users_id_fk" FOREIGN KEY ("assigned_reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_season_competition_fk" FOREIGN KEY ("season_id","competition_id") REFERENCES "public"."seasons"("id","competition_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_team_season_fk" FOREIGN KEY ("team_registration_id","season_id") REFERENCES "public"."team_registrations"("id","season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_file_id_uploaded_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."uploaded_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_case_id_disciplinary_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."disciplinary_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_attached_by_users_id_fk" FOREIGN KEY ("attached_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disciplinary_case_entry_case_idx" ON "disciplinary_case_entries" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "disciplinary_case_competition_idx" ON "disciplinary_cases" USING btree ("competition_id","status","created_at");--> statement-breakpoint
CREATE INDEX "disciplinary_case_season_idx" ON "disciplinary_cases" USING btree ("season_id","status");--> statement-breakpoint
CREATE INDEX "disciplinary_case_reviewer_idx" ON "disciplinary_cases" USING btree ("assigned_reviewer_id","status");--> statement-breakpoint
CREATE INDEX "disciplinary_case_player_idx" ON "disciplinary_cases" USING btree ("subject_player_registration_id");--> statement-breakpoint
CREATE INDEX "disciplinary_case_team_idx" ON "disciplinary_cases" USING btree ("subject_team_registration_id");--> statement-breakpoint
CREATE INDEX "disciplinary_sanction_competition_idx" ON "disciplinary_sanctions" USING btree ("competition_id","status","created_at");--> statement-breakpoint
CREATE INDEX "disciplinary_sanction_player_idx" ON "disciplinary_sanctions" USING btree ("subject_player_registration_id","status");--> statement-breakpoint
CREATE INDEX "disciplinary_sanction_team_idx" ON "disciplinary_sanctions" USING btree ("subject_team_registration_id","status");--> statement-breakpoint
CREATE INDEX "disciplinary_sanction_case_idx" ON "disciplinary_sanctions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "dispute_entry_dispute_idx" ON "dispute_entries" USING btree ("dispute_id","created_at");--> statement-breakpoint
CREATE INDEX "dispute_competition_idx" ON "disputes" USING btree ("competition_id","status","created_at");--> statement-breakpoint
CREATE INDEX "dispute_season_idx" ON "disputes" USING btree ("season_id","status");--> statement-breakpoint
CREATE INDEX "dispute_submitter_idx" ON "disputes" USING btree ("submitted_by","created_at");--> statement-breakpoint
CREATE INDEX "dispute_reviewer_idx" ON "disputes" USING btree ("assigned_reviewer_id","status");--> statement-breakpoint
CREATE INDEX "dispute_team_idx" ON "disputes" USING btree ("team_registration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_file_unique" ON "evidence_files" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "evidence_case_idx" ON "evidence_files" USING btree ("case_id","removed_at");--> statement-breakpoint
CREATE INDEX "evidence_dispute_idx" ON "evidence_files" USING btree ("dispute_id","removed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_channel_uq" ON "notification_deliveries" USING btree ("notification_id","channel");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_unread_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "notification_competition_idx" ON "notifications" USING btree ("competition_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dedupe_uq" ON "notifications" USING btree ("user_id","dedupe_key") WHERE "notifications"."dedupe_key" is not null;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_suspended_by_users_id_fk" FOREIGN KEY ("suspended_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_audience_idx" ON "announcements" USING btree ("audience","competition_id","published_at");--> statement-breakpoint
CREATE INDEX "audit_entity_created_idx" ON "audit_logs" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_competition_created_idx" ON "audit_logs" USING btree ("competition_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_season_created_idx" ON "audit_logs" USING btree ("season_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_action_created_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "uploaded_file_uploader_idx" ON "uploaded_files" USING btree ("uploaded_by","created_at");--> statement-breakpoint
CREATE INDEX "users_active_idx" ON "users" USING btree ("is_active","created_at");--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcement_audience_check" CHECK ("announcements"."audience" in ('public','participants','captains','officials','administrators'));--> statement-breakpoint
ALTER TABLE "uploaded_files" ADD CONSTRAINT "uploaded_file_provider_check" CHECK ("uploaded_files"."storage_provider" in ('local'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_suspension_check" CHECK (("users"."suspended_at" is null and "users"."suspended_reason" is null and "users"."suspended_by" is null) or ("users"."suspended_at" is not null and "users"."suspended_reason" is not null));--> statement-breakpoint
-- Audit records are append-only. The application already never updates or
-- deletes them; this trigger makes the contract enforceable in the database.
-- Row-level triggers do not fire for TRUNCATE, so test/teardown resets remain
-- possible while ordinary UPDATE/DELETE attempts fail.
CREATE OR REPLACE FUNCTION touchline_audit_logs_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'audit_logs is append-only; % is not permitted', TG_OP;
END
$$;--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION touchline_audit_logs_append_only();