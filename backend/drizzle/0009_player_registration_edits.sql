CREATE TABLE "player_registration_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL REFERENCES "player_registrations"("id") ON DELETE CASCADE,
	"proposed_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
	"proposed" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"reviewed_at" timestamptz,
	"review_note" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "player_registration_edit_status_check" CHECK ("status" in ('pending','approved','rejected','superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "player_registration_pending_edit_uq" ON "player_registration_edits" ("registration_id") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX "player_registration_edit_status_idx" ON "player_registration_edits" ("status", "created_at");
