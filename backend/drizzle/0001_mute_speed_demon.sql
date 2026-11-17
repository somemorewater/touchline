CREATE TABLE "match_officials" (
	"match_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(20) DEFAULT 'official' NOT NULL,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_officials_match_id_user_id_pk" PRIMARY KEY("match_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(40)
);
--> statement-breakpoint
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_user_id_role_id_competition_id_pk";--> statement-breakpoint
ALTER TABLE "user_roles" ALTER COLUMN "competition_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user_roles" ALTER COLUMN "competition_id" DROP NOT NULL;--> statement-breakpoint
UPDATE "user_roles" SET "competition_id" = NULL WHERE "competition_id" = '00000000-0000-0000-0000-000000000000';--> statement-breakpoint
INSERT INTO "sessions" ("id", "user_id", "created_at", "expires_at", "revoked_at", "revoked_reason")
SELECT
	"family_id",
	(array_agg("user_id" ORDER BY "created_at"))[1],
	min("created_at"),
	max("expires_at"),
	CASE
		WHEN bool_or("revoked_at" IS NULL AND "expires_at" > now()) THEN NULL
		ELSE COALESCE(max("revoked_at"), now())
	END,
	CASE
		WHEN bool_or("revoked_at" IS NULL AND "expires_at" > now()) THEN NULL
		ELSE 'migrated'
	END
FROM "refresh_tokens"
GROUP BY "family_id"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "match_officials" ADD CONSTRAINT "match_officials_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_officials" ADD CONSTRAINT "match_officials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_officials" ADD CONSTRAINT "match_officials_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_official_user_idx" ON "match_officials" USING btree ("user_id","match_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "sessions" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "session_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_family_id_sessions_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_token_family_idx" ON "refresh_tokens" USING btree ("family_id","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_global_uq" ON "user_roles" USING btree ("user_id","role_id") WHERE "user_roles"."competition_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_scoped_uq" ON "user_roles" USING btree ("user_id","role_id","competition_id") WHERE "user_roles"."competition_id" is not null;--> statement-breakpoint
CREATE INDEX "user_roles_competition_idx" ON "user_roles" USING btree ("competition_id");