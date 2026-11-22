ALTER TABLE "players" DROP CONSTRAINT "player_position_check";
--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "player_position_check" CHECK ("players"."position" is null or "players"."position" in ('GK','CB','LB','RB','DM','CM','RM','LM','AM','LW','RW','CF','SS','DF','MF','FW'));
--> statement-breakpoint
ALTER TABLE "lineup_players" DROP CONSTRAINT "lineup_player_position_check";
--> statement-breakpoint
ALTER TABLE "lineup_players" ADD CONSTRAINT "lineup_player_position_check" CHECK ("lineup_players"."position" is null or "lineup_players"."position" in ('GK','CB','LB','RB','DM','CM','RM','LM','AM','LW','RW','CF','SS','DF','MF','FW'));
