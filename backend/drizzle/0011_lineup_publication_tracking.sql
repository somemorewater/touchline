ALTER TABLE "lineups" ADD COLUMN "published_at" timestamp with time zone;
ALTER TABLE "lineups" ADD COLUMN "published_by" uuid;
ALTER TABLE "lineups" ADD CONSTRAINT "lineups_published_by_users_id_fk"
  FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
CREATE INDEX "lineup_publication_idx" ON "lineups" USING btree ("status", "published_at");
