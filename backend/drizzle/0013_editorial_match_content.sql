CREATE TABLE "commentary_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"team_registration_id" uuid,
	"kind" varchar(16) DEFAULT 'commentary' NOT NULL,
	"event_type" varchar(40),
	"body" text NOT NULL,
	"minute" integer,
	"added_minutes" integer,
	"status" varchar(16) DEFAULT 'published' NOT NULL,
	"is_important" boolean DEFAULT false NOT NULL,
	"author_user_id" uuid,
	"edited_at" timestamp with time zone,
	"edited_by" uuid,
	"retracted_at" timestamp with time zone,
	"retracted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commentary_kind_check" CHECK ("commentary_entries"."kind" in ('commentary','key_moment')),
	CONSTRAINT "commentary_status_check" CHECK ("commentary_entries"."status" in ('draft','published','retracted')),
	CONSTRAINT "commentary_minute_check" CHECK ("commentary_entries"."minute" is null or "commentary_entries"."minute" between 0 and 150),
	CONSTRAINT "commentary_added_minutes_check" CHECK ("commentary_entries"."added_minutes" is null or "commentary_entries"."added_minutes" between 0 and 30),
	CONSTRAINT "commentary_event_type_check" CHECK ("commentary_entries"."event_type" is null or "commentary_entries"."event_type" in ('goal','own-goal','yellow-card','second-yellow','red-card','substitution','injury','penalty-awarded','penalty-scored','penalty-missed','kickoff','half-time','full-time','chance','save','other')),
	CONSTRAINT "commentary_key_moment_type_check" CHECK ("commentary_entries"."kind" <> 'key_moment' or "commentary_entries"."event_type" is not null)
);
--> statement-breakpoint
CREATE TABLE "match_overviews" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"introduction" text,
	"pre_match_notes" text,
	"live_summary" text,
	"narrative" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commentary_entries" ADD CONSTRAINT "commentary_entries_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commentary_entries" ADD CONSTRAINT "commentary_entries_team_registration_id_team_registrations_id_fk" FOREIGN KEY ("team_registration_id") REFERENCES "public"."team_registrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commentary_entries" ADD CONSTRAINT "commentary_entries_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commentary_entries" ADD CONSTRAINT "commentary_entries_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commentary_entries" ADD CONSTRAINT "commentary_entries_retracted_by_users_id_fk" FOREIGN KEY ("retracted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_overviews" ADD CONSTRAINT "match_overviews_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_overviews" ADD CONSTRAINT "match_overviews_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commentary_match_order_idx" ON "commentary_entries" USING btree ("match_id","minute","created_at");