ALTER TABLE "players" DROP CONSTRAINT "player_position_check";--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "player_position_check" CHECK ("players"."position" is null or "players"."position" in ('GK','CB','LB','RB','DM','CM','RM','LM','AM','LW','RW','CF','DF','MF','FW'));
