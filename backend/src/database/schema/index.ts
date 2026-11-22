import { pgTable, pgEnum, uuid, varchar, text, boolean, timestamp, date, integer, jsonb, unique, uniqueIndex, index, numeric, primaryKey, foreignKey, check, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
const timestamps = { createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(), updatedAt: timestamp('updated_at',{withTimezone:true}).notNull().defaultNow() };
export const registrationStatus = pgEnum('registration_status',['draft','submitted','under_review','approved','rejected','withdrawn']);
export const matchStatus = pgEnum('match_status',['scheduled','live','first_half','half_time','second_half','extra_time','penalties','full_time','postponed','cancelled','abandoned']);
export const users = pgTable('users',{
  id:uuid('id').primaryKey().defaultRandom(),
  email:varchar('email',{length:320}).notNull().unique(),
  passwordHash:text('password_hash').notNull(),
  displayName:varchar('display_name',{length:160}).notNull(),
  isActive:boolean('is_active').notNull().default(true),
  suspendedAt:timestamp('suspended_at',{withTimezone:true}),
  suspendedReason:text('suspended_reason'),
  suspendedBy:uuid('suspended_by').references((): AnyPgColumn => users.id,{onDelete:'set null'}),
  ...timestamps
},t=>[
  uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
  index('users_active_idx').on(t.isActive,t.createdAt),
  check('users_suspension_check', sql`(${t.suspendedAt} is null and ${t.suspendedReason} is null and ${t.suspendedBy} is null) or (${t.suspendedAt} is not null and ${t.suspendedReason} is not null)`),
]);
export const roles = pgTable('roles',{id:uuid('id').primaryKey().defaultRandom(),name:varchar('name',{length:80}).notNull().unique(),description:text('description')});
export const permissions = pgTable('permissions',{id:uuid('id').primaryKey().defaultRandom(),key:varchar('key',{length:120}).notNull().unique(),description:text('description')});
export const rolePermissions = pgTable('role_permissions',{roleId:uuid('role_id').notNull().references(()=>roles.id,{onDelete:'cascade'}),permissionId:uuid('permission_id').notNull().references(()=>permissions.id,{onDelete:'cascade'})},t=>[primaryKey({columns:[t.roleId,t.permissionId]})]);
export const userRoles = pgTable('user_roles',{id:uuid('id').primaryKey().defaultRandom(),userId:uuid('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),roleId:uuid('role_id').notNull().references(()=>roles.id,{onDelete:'restrict'}),competitionId:uuid('competition_id').references(()=>competitions.id,{onDelete:'cascade'}),...timestamps},t=>[uniqueIndex('user_roles_global_uq').on(t.userId,t.roleId).where(sql`${t.competitionId} is null`),uniqueIndex('user_roles_scoped_uq').on(t.userId,t.roleId,t.competitionId).where(sql`${t.competitionId} is not null`),index('user_roles_competition_idx').on(t.competitionId)]);
export const sessions = pgTable('sessions',{id:uuid('id').primaryKey().defaultRandom(),userId:uuid('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),lastSeenAt:timestamp('last_seen_at',{withTimezone:true}),revokedAt:timestamp('revoked_at',{withTimezone:true}),revokedReason:varchar('revoked_reason',{length:40})},t=>[index('session_user_idx').on(t.userId,t.revokedAt),index('session_expiry_idx').on(t.expiresAt)]);
export const refreshTokens = pgTable('refresh_tokens',{id:uuid('id').primaryKey().defaultRandom(),userId:uuid('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),tokenHash:text('token_hash').notNull().unique(),familyId:uuid('family_id').notNull().references(()=>sessions.id,{onDelete:'cascade'}),expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),revokedAt:timestamp('revoked_at',{withTimezone:true}),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()},t=>[index('refresh_token_family_idx').on(t.familyId,t.revokedAt)]);
export const competitions = pgTable('competitions',{
  id:uuid('id').primaryKey().defaultRandom(),
  slug:varchar('slug',{length:120}).notNull().unique(),
  name:varchar('name',{length:200}).notNull(),
  description:text('description'),
  status:varchar('status',{length:24}).notNull().default('draft'),
  format:varchar('format',{length:32}).notNull().default('single-league'),
  visibility:varchar('visibility',{length:16}).notNull().default('public'),
  ...timestamps
},t=>[
  check('competition_status_check', sql`${t.status} in ('draft','published','registration','active','completed','archived')`),
  check('competition_format_check', sql`${t.format} in ('single-league','multiple-leagues','group-stage','knockout','league-then-knockout')`),
  check('competition_visibility_check', sql`${t.visibility} in ('public','private')`),
]);
export const seasons = pgTable('seasons',{
  id:uuid('id').primaryKey().defaultRandom(),
  competitionId:uuid('competition_id').notNull().references(()=>competitions.id,{onDelete:'restrict'}),
  label:varchar('label',{length:80}).notNull(),
  startsOn:date('starts_on'),
  endsOn:date('ends_on'),
  status:varchar('status',{length:24}).notNull().default('planned'),
  ...timestamps
},t=>[
  uniqueIndex('season_comp_label_uq').on(t.competitionId,t.label),
  unique('season_competition_id_uq').on(t.competitionId,t.id),
  check('season_dates_check', sql`${t.endsOn} is null or ${t.startsOn} is null or ${t.endsOn} >= ${t.startsOn}`),
  check('season_status_check', sql`${t.status} in ('planned','active','completed','archived')`),
]);
export const competitionGroups = pgTable('competition_groups',{
  id:uuid('id').primaryKey().defaultRandom(),
  seasonId:uuid('season_id').notNull().references(()=>seasons.id,{onDelete:'restrict'}),
  name:varchar('name',{length:100}).notNull(),
  kind:varchar('kind',{length:20}).notNull().default('league'),
  archivedAt:timestamp('archived_at',{withTimezone:true})
},t=>[
  uniqueIndex('group_season_name_uq').on(t.seasonId,t.name),
  unique('group_id_season_uq').on(t.id,t.seasonId),
  check('competition_group_kind_check', sql`${t.kind} in ('league','group')`),
]);
export const competitionRules = pgTable('competition_rules',{
  seasonId:uuid('season_id').primaryKey().references(()=>seasons.id,{onDelete:'restrict'}),
  pointsWin:integer('points_win').notNull().default(3),
  pointsDraw:integer('points_draw').notNull().default(1),
  pointsLoss:integer('points_loss').notNull().default(0),
  tieBreakers:jsonb('tie_breakers').$type<string[]>().notNull().default(['goal_difference','goals_for']),
  rules:jsonb('rules').$type<Record<string,unknown>>().notNull().default({}),
  updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow()
},t=>[
  check('competition_rules_points_check', sql`${t.pointsWin} >= 0 and ${t.pointsDraw} >= 0 and ${t.pointsLoss} >= 0`),
]);
export const teams = pgTable('teams',{id:uuid('id').primaryKey().defaultRandom(),name:varchar('name',{length:160}).notNull(),shortName:varchar('short_name',{length:50}),department:varchar('department',{length:120}),logoFileId:uuid('logo_file_id'),archivedAt:timestamp('archived_at',{withTimezone:true}),...timestamps},t=>[index('team_name_idx').on(t.name),uniqueIndex('team_name_lower_uq').on(sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`)]);
export const teamRegistrations = pgTable('team_registrations',{
  id:uuid('id').primaryKey().defaultRandom(),
  teamId:uuid('team_id').notNull().references(()=>teams.id,{onDelete:'restrict'}),
  seasonId:uuid('season_id').notNull().references(()=>seasons.id,{onDelete:'restrict'}),
  groupId:uuid('group_id').references(()=>competitionGroups.id,{onDelete:'set null'}),
  captainUserId:uuid('captain_user_id').references(()=>users.id,{onDelete:'set null'}),
  status:registrationStatus('status').notNull().default('draft'),
  submittedAt:timestamp('submitted_at',{withTimezone:true}),
  reviewedBy:uuid('reviewed_by').references(()=>users.id,{onDelete:'set null'}),
  reviewedAt:timestamp('reviewed_at',{withTimezone:true}),
  reviewNote:text('review_note'),
  ...timestamps
},t=>[
  uniqueIndex('team_registration_season_uq').on(t.teamId,t.seasonId),
  unique('team_registration_id_season_uq').on(t.id,t.seasonId),
  index('team_reg_season_status_idx').on(t.seasonId,t.status),
  index('team_reg_season_group_idx').on(t.seasonId,t.groupId),
  foreignKey({name:'team_registrations_group_season_fk',columns:[t.groupId,t.seasonId],foreignColumns:[competitionGroups.id,competitionGroups.seasonId]}),
]);
export const players = pgTable('players',{
  id:uuid('id').primaryKey().defaultRandom(),
  fullName:varchar('full_name',{length:180}).notNull(),
  department:varchar('department',{length:120}),
  dateOfBirth:date('date_of_birth'),
  position:varchar('position',{length:8}),
  preferredFoot:varchar('preferred_foot',{length:8}),
  photoFileId:uuid('photo_file_id'),
  contactEmail:varchar('contact_email',{length:320}),
  archivedAt:timestamp('archived_at',{withTimezone:true}),
  ...timestamps
},t=>[
  index('player_name_idx').on(t.fullName),
  // Keep legacy DF/MF/FW accepted so existing players remain valid without
  // inventing a narrower position for them.
  check('player_position_check', sql`${t.position} is null or ${t.position} in ('GK','CB','LB','RB','DM','CM','RM','LM','AM','LW','RW','CF','SS','DF','MF','FW')`),
]);
export const playerRegistrations = pgTable('player_registrations',{
  id:uuid('id').primaryKey().defaultRandom(),
  playerId:uuid('player_id').notNull().references(()=>players.id,{onDelete:'restrict'}),
  teamRegistrationId:uuid('team_registration_id').notNull().references(()=>teamRegistrations.id,{onDelete:'restrict'}),
  seasonId:uuid('season_id').notNull(),
  matriculationNumber:varchar('matriculation_number',{length:80}),
  shirtNumber:integer('shirt_number'),
  status:registrationStatus('status').notNull().default('draft'),
  eligibilityApproved:boolean('eligibility_approved').notNull().default(false),
  submittedAt:timestamp('submitted_at',{withTimezone:true}),
  reviewedBy:uuid('reviewed_by').references(()=>users.id,{onDelete:'set null'}),
  reviewedAt:timestamp('reviewed_at',{withTimezone:true}),
  reviewNote:text('review_note'),
  ...timestamps
},t=>[
  uniqueIndex('player_team_reg_uq').on(t.playerId,t.teamRegistrationId),
  uniqueIndex('player_season_active_uq').on(t.playerId,t.seasonId).where(sql`${t.status} in ('submitted','under_review','approved')`),
  uniqueIndex('player_matriculation_active_season_uq').on(t.seasonId,t.matriculationNumber).where(sql`${t.matriculationNumber} is not null and ${t.status} in ('submitted','under_review','approved')`),
  uniqueIndex('shirt_number_team_uq').on(t.teamRegistrationId,t.shirtNumber),
  index('player_reg_status_idx').on(t.teamRegistrationId,t.status),
  index('player_reg_season_status_idx').on(t.seasonId,t.status),
  unique('player_registration_id_team_uq').on(t.id,t.teamRegistrationId),
  foreignKey({name:'player_registrations_team_season_fk',columns:[t.teamRegistrationId,t.seasonId],foreignColumns:[teamRegistrations.id,teamRegistrations.seasonId]}),
  check('player_registration_shirt_check', sql`${t.shirtNumber} is null or ${t.shirtNumber} between 1 and 99`),
]);
export const playerRegistrationEdits = pgTable('player_registration_edits', {
  id: uuid('id').primaryKey().defaultRandom(),
  registrationId: uuid('registration_id').notNull().references(() => playerRegistrations.id, { onDelete: 'cascade' }),
  proposedBy: uuid('proposed_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  proposed: jsonb('proposed').$type<Record<string, unknown>>().notNull(),
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNote: text('review_note'),
  ...timestamps,
}, t => [
  uniqueIndex('player_registration_pending_edit_uq').on(t.registrationId).where(sql`${t.status} = 'pending'`),
  index('player_registration_edit_status_idx').on(t.status, t.createdAt),
  check('player_registration_edit_status_check', sql`${t.status} in ('pending','approved','rejected','superseded')`),
]);
export const fixtures = pgTable('fixtures',{
  id:uuid('id').primaryKey().defaultRandom(),
  seasonId:uuid('season_id').notNull().references(()=>seasons.id,{onDelete:'restrict'}),
  groupId:uuid('group_id').references(()=>competitionGroups.id,{onDelete:'set null'}),
  homeTeamRegistrationId:uuid('home_team_registration_id').notNull(),
  awayTeamRegistrationId:uuid('away_team_registration_id').notNull(),
  round:integer('round'),
  scheduledAt:timestamp('scheduled_at',{withTimezone:true}),
  venue:varchar('venue',{length:200}),
  status:varchar('status',{length:20}).notNull().default('scheduled'),
  publishedAt:timestamp('published_at',{withTimezone:true}),
  createdBy:uuid('created_by').references(()=>users.id,{onDelete:'set null'}),
  ...timestamps
},t=>[
  index('fixture_season_date_idx').on(t.seasonId,t.scheduledAt),
  index('fixture_home_team_idx').on(t.homeTeamRegistrationId),
  index('fixture_away_team_idx').on(t.awayTeamRegistrationId),
  index('fixture_season_status_idx').on(t.seasonId,t.status),
  unique('fixture_identity_uq').on(t.seasonId,t.groupId,t.homeTeamRegistrationId,t.awayTeamRegistrationId,t.round).nullsNotDistinct(),
  foreignKey({name:'fixtures_home_team_season_fk',columns:[t.homeTeamRegistrationId,t.seasonId],foreignColumns:[teamRegistrations.id,teamRegistrations.seasonId]}),
  foreignKey({name:'fixtures_away_team_season_fk',columns:[t.awayTeamRegistrationId,t.seasonId],foreignColumns:[teamRegistrations.id,teamRegistrations.seasonId]}),
  foreignKey({name:'fixtures_group_season_fk',columns:[t.groupId,t.seasonId],foreignColumns:[competitionGroups.id,competitionGroups.seasonId]}),
  check('fixture_distinct_teams_check', sql`${t.homeTeamRegistrationId} <> ${t.awayTeamRegistrationId}`),
  check('fixture_round_check', sql`${t.round} is null or ${t.round} > 0`),
  check('fixture_status_check', sql`${t.status} in ('draft','scheduled','postponed','cancelled','completed','abandoned')`),
]);
export const matches = pgTable('matches',{
  id:uuid('id').primaryKey().defaultRandom(),
  fixtureId:uuid('fixture_id').notNull().unique().references(()=>fixtures.id,{onDelete:'restrict'}),
  status:matchStatus('status').notNull().default('scheduled'),
  homeScore:integer('home_score').notNull().default(0),
  awayScore:integer('away_score').notNull().default(0),
  resultConfirmedAt:timestamp('result_confirmed_at',{withTimezone:true}),
  confirmedBy:uuid('confirmed_by').references(()=>users.id,{onDelete:'set null'}),
  startedAt:timestamp('started_at',{withTimezone:true}),
  endedAt:timestamp('ended_at',{withTimezone:true}),
  currentMinute:integer('current_minute'),
  addedMinutes:integer('added_minutes'),
  ...timestamps
},t=>[
  index('match_status_idx').on(t.status),
  check('match_scores_non_negative_check', sql`${t.homeScore} >= 0 and ${t.awayScore} >= 0`),
  check('match_times_check', sql`${t.startedAt} is null or ${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`),
  check('match_current_minute_check', sql`${t.currentMinute} is null or ${t.currentMinute} between 0 and 150`),
  check('match_added_minutes_check', sql`${t.addedMinutes} is null or ${t.addedMinutes} between 0 and 30`),
  check('match_result_status_check', sql`${t.resultConfirmedAt} is null or ${t.status} = 'full_time'`),
]);
export const matchOfficials = pgTable('match_officials',{matchId:uuid('match_id').notNull().references(()=>matches.id,{onDelete:'cascade'}),userId:uuid('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),role:varchar('role',{length:20}).notNull().default('official'),assignedBy:uuid('assigned_by').references(()=>users.id,{onDelete:'set null'}),assignedAt:timestamp('assigned_at',{withTimezone:true}).notNull().defaultNow()},t=>[primaryKey({columns:[t.matchId,t.userId]}),index('match_official_user_idx').on(t.userId,t.matchId)]);
export const matchEvents = pgTable('match_events',{
  id:uuid('id').primaryKey().defaultRandom(),
  matchId:uuid('match_id').notNull().references(()=>matches.id,{onDelete:'restrict'}),
  clientEventId:uuid('client_event_id').notNull(),
  eventType:varchar('event_type',{length:40}).notNull(),
  teamRegistrationId:uuid('team_registration_id').references(()=>teamRegistrations.id,{onDelete:'restrict'}),
  playerRegistrationId:uuid('player_registration_id').references(()=>playerRegistrations.id,{onDelete:'restrict'}),
  secondaryPlayerRegistrationId:uuid('secondary_player_registration_id').references(()=>playerRegistrations.id,{onDelete:'restrict'}),
  minute:integer('minute').notNull(),
  addedMinutes:integer('added_minutes'),
  description:text('description'),
  clientTimestamp:timestamp('client_timestamp',{withTimezone:true}),
  createdBy:uuid('created_by').references(()=>users.id,{onDelete:'set null'}),
  receivedAt:timestamp('received_at',{withTimezone:true}).notNull().defaultNow(),
  voidedAt:timestamp('voided_at',{withTimezone:true}),
  voidedBy:uuid('voided_by').references(()=>users.id,{onDelete:'set null'}),
  voidReason:text('void_reason'),
  correctedAt:timestamp('corrected_at',{withTimezone:true}),
  correctedBy:uuid('corrected_by').references(()=>users.id,{onDelete:'set null'}),
  correctionReason:text('correction_reason'),
  ...timestamps
},t=>[
  uniqueIndex('match_event_client_id_uq').on(t.matchId,t.clientEventId),
  index('match_event_order_idx').on(t.matchId,t.minute,t.createdAt),
  index('match_event_player_idx').on(t.playerRegistrationId,t.matchId),
  index('match_event_secondary_player_idx').on(t.secondaryPlayerRegistrationId,t.matchId),
  index('match_event_team_idx').on(t.teamRegistrationId,t.matchId),
  check('match_event_type_check', sql`${t.eventType} in ('goal','own-goal','yellow-card','second-yellow','red-card','substitution','injury','penalty-awarded','penalty-scored','penalty-missed','kickoff','half-time','full-time')`),
  check('match_event_minute_check', sql`${t.minute} between 0 and 150`),
  check('match_event_added_minutes_check', sql`${t.addedMinutes} is null or ${t.addedMinutes} between 0 and 30`),
  check('match_event_distinct_players_check', sql`${t.playerRegistrationId} is null or ${t.secondaryPlayerRegistrationId} is null or ${t.playerRegistrationId} <> ${t.secondaryPlayerRegistrationId}`),
  check('match_event_substitution_players_check', sql`${t.eventType} <> 'substitution' or (${t.playerRegistrationId} is not null and ${t.secondaryPlayerRegistrationId} is not null)`),
]);
export const lineups = pgTable('lineups',{
  id:uuid('id').primaryKey().defaultRandom(),
  matchId:uuid('match_id').notNull().references(()=>matches.id,{onDelete:'restrict'}),
  teamRegistrationId:uuid('team_registration_id').notNull().references(()=>teamRegistrations.id,{onDelete:'restrict'}),
  formation:varchar('formation',{length:32}),
  status:varchar('status',{length:20}).notNull().default('draft'),
  submittedAt:timestamp('submitted_at',{withTimezone:true}),
  confirmedAt:timestamp('confirmed_at',{withTimezone:true}),
  confirmedBy:uuid('confirmed_by').references(()=>users.id,{onDelete:'set null'}),
  returnedAt:timestamp('returned_at',{withTimezone:true}),
  returnedBy:uuid('returned_by').references(()=>users.id,{onDelete:'set null'}),
  returnReason:text('return_reason'),
  ...timestamps
},t=>[
  uniqueIndex('lineup_match_team_uq').on(t.matchId,t.teamRegistrationId),
  unique('lineup_id_match_uq').on(t.id,t.matchId),
  unique('lineup_id_team_uq').on(t.id,t.teamRegistrationId),
  index('lineup_team_idx').on(t.teamRegistrationId),
  index('lineup_match_status_idx').on(t.matchId,t.status),
  check('lineup_status_check', sql`${t.status} in ('draft','submitted','published','confirmed','returned')`),
  check('lineup_formation_check', sql`${t.formation} is null or case when ${t.formation} ~ '^[1-9][0-9]*(-[1-9][0-9]*)+$' then touchline_formation_outfield_count(${t.formation}) = 10 else false end`),
]);
export const lineupPlayers = pgTable('lineup_players',{
  lineupId:uuid('lineup_id').notNull().references(()=>lineups.id,{onDelete:'cascade'}),
  matchId:uuid('match_id').notNull(),
  teamRegistrationId:uuid('team_registration_id').notNull(),
  playerRegistrationId:uuid('player_registration_id').notNull().references(()=>playerRegistrations.id,{onDelete:'restrict'}),
  role:varchar('role',{length:20}).notNull(),
  shirtNumber:integer('shirt_number'),
  position:varchar('position',{length:8}),
  x:numeric('x',{precision:5,scale:2}),
  y:numeric('y',{precision:5,scale:2}),
  isCaptain:boolean('is_captain').notNull().default(false)
},t=>[
  primaryKey({columns:[t.lineupId,t.playerRegistrationId]}),
  uniqueIndex('lineup_player_match_uq').on(t.matchId,t.playerRegistrationId),
  uniqueIndex('lineup_one_captain_uq').on(t.lineupId).where(sql`${t.isCaptain}`),
  index('lineup_player_registration_idx').on(t.playerRegistrationId),
  foreignKey({name:'lineup_players_lineup_match_fk',columns:[t.lineupId,t.matchId],foreignColumns:[lineups.id,lineups.matchId]}),
  foreignKey({name:'lineup_players_lineup_team_fk',columns:[t.lineupId,t.teamRegistrationId],foreignColumns:[lineups.id,lineups.teamRegistrationId]}),
  foreignKey({name:'lineup_players_player_team_fk',columns:[t.playerRegistrationId,t.teamRegistrationId],foreignColumns:[playerRegistrations.id,playerRegistrations.teamRegistrationId]}),
  check('lineup_player_role_check', sql`${t.role} in ('starter','substitute','unavailable')`),
  check('lineup_player_position_check', sql`${t.position} is null or ${t.position} in ('GK','CB','LB','RB','DM','CM','RM','LM','AM','LW','RW','CF','SS','DF','MF','FW')`),
  check('lineup_player_shirt_check', sql`${t.shirtNumber} is null or ${t.shirtNumber} between 1 and 99`),
  check('lineup_player_coordinates_check', sql`((${t.x} is null and ${t.y} is null) or (${t.x} is not null and ${t.y} is not null and ${t.x} between 0 and 100 and ${t.y} between 0 and 100))`),
]);
export const standingsSnapshots = pgTable('standings_snapshots',{
  id:uuid('id').primaryKey().defaultRandom(),
  seasonId:uuid('season_id').notNull().references(()=>seasons.id,{onDelete:'restrict'}),
  groupId:uuid('group_id').references(()=>competitionGroups.id,{onDelete:'set null'}),
  version:integer('version').notNull().default(1),
  isCurrent:boolean('is_current').notNull().default(false),
  calculatedAt:timestamp('calculated_at',{withTimezone:true}).notNull().defaultNow(),
  meta:jsonb('meta').$type<Record<string,unknown>>().notNull().default({}),
  rows:jsonb('rows').$type<Record<string,unknown>[]>().notNull()
},t=>[
  unique('standings_snapshot_version_uq').on(t.seasonId,t.groupId,t.version).nullsNotDistinct(),
  uniqueIndex('standings_snapshot_current_uq').on(t.seasonId,sql`coalesce(${t.groupId}, '00000000-0000-0000-0000-000000000000'::uuid)`).where(sql`${t.isCurrent}`),
  foreignKey({name:'standings_snapshots_group_season_fk',columns:[t.groupId,t.seasonId],foreignColumns:[competitionGroups.id,competitionGroups.seasonId]}),
  check('standings_snapshot_version_check', sql`${t.version} > 0`),
]);
export const announcements = pgTable('announcements',{
  id:uuid('id').primaryKey().defaultRandom(),
  competitionId:uuid('competition_id').references(()=>competitions.id,{onDelete:'restrict'}),
  seasonId:uuid('season_id').references(()=>seasons.id,{onDelete:'restrict'}),
  title:varchar('title',{length:200}).notNull(),
  body:text('body').notNull(),
  audience:varchar('audience',{length:24}).notNull().default('public'),
  publishedAt:timestamp('published_at',{withTimezone:true}),
  archivedAt:timestamp('archived_at',{withTimezone:true}),
  createdBy:uuid('created_by').references(()=>users.id,{onDelete:'set null'}),
  ...timestamps
},t=>[
  index('announcement_public_idx').on(t.publishedAt,t.archivedAt),
  index('announcement_competition_idx').on(t.competitionId,t.publishedAt),
  index('announcement_audience_idx').on(t.audience,t.competitionId,t.publishedAt),
  foreignKey({name:'announcements_competition_season_fk',columns:[t.competitionId,t.seasonId],foreignColumns:[seasons.competitionId,seasons.id]}),
  check('announcement_season_competition_check', sql`${t.seasonId} is null or ${t.competitionId} is not null`),
  check('announcement_audience_check', sql`${t.audience} in ('public','participants','captains','officials','administrators')`),
]);
export const auditLogs = pgTable('audit_logs',{
  id:uuid('id').primaryKey().defaultRandom(),
  actorUserId:uuid('actor_user_id').references(()=>users.id,{onDelete:'set null'}),
  competitionId:uuid('competition_id').references(()=>competitions.id,{onDelete:'set null'}),
  seasonId:uuid('season_id').references(()=>seasons.id,{onDelete:'set null'}),
  action:varchar('action',{length:100}).notNull(),
  entityType:varchar('entity_type',{length:80}).notNull(),
  entityId:uuid('entity_id'),
  before:jsonb('before'),
  after:jsonb('after'),
  reason:text('reason'),
  requestId:varchar('request_id',{length:120}),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()
},t=>[
  index('audit_entity_idx').on(t.entityType,t.entityId),
  index('audit_actor_idx').on(t.actorUserId,t.createdAt),
  index('audit_entity_created_idx').on(t.entityType,t.entityId,t.createdAt),
  index('audit_competition_created_idx').on(t.competitionId,t.createdAt),
  index('audit_season_created_idx').on(t.seasonId,t.createdAt),
  index('audit_action_created_idx').on(t.action,t.createdAt),
  index('audit_created_idx').on(t.createdAt),
]);

export const disciplinaryCases = pgTable('disciplinary_cases',{
  id:uuid('id').primaryKey().defaultRandom(),
  competitionId:uuid('competition_id').notNull().references(()=>competitions.id,{onDelete:'restrict'}),
  seasonId:uuid('season_id'),
  subjectType:varchar('subject_type',{length:20}).notNull(),
  subjectPlayerRegistrationId:uuid('subject_player_registration_id').references(()=>playerRegistrations.id,{onDelete:'restrict'}),
  subjectUserId:uuid('subject_user_id').references(()=>users.id,{onDelete:'set null'}),
  subjectTeamRegistrationId:uuid('subject_team_registration_id').references(()=>teamRegistrations.id,{onDelete:'restrict'}),
  originType:varchar('origin_type',{length:32}).notNull().default('competition_administration'),
  originMatchId:uuid('origin_match_id').references(()=>matches.id,{onDelete:'set null'}),
  originEventId:uuid('origin_event_id').references(()=>matchEvents.id,{onDelete:'set null'}),
  title:varchar('title',{length:200}).notNull(),
  description:text('description').notNull(),
  status:varchar('status',{length:24}).notNull().default('open'),
  assignedReviewerId:uuid('assigned_reviewer_id').references(()=>users.id,{onDelete:'set null'}),
  createdBy:uuid('created_by').references(()=>users.id,{onDelete:'set null'}),
  openedAt:timestamp('opened_at',{withTimezone:true}).notNull().defaultNow(),
  decidedAt:timestamp('decided_at',{withTimezone:true}),
  closedAt:timestamp('closed_at',{withTimezone:true}),
  closureReason:text('closure_reason'),
  ...timestamps
},t=>[
  index('disciplinary_case_competition_idx').on(t.competitionId,t.status,t.createdAt),
  index('disciplinary_case_season_idx').on(t.seasonId,t.status),
  index('disciplinary_case_reviewer_idx').on(t.assignedReviewerId,t.status),
  index('disciplinary_case_player_idx').on(t.subjectPlayerRegistrationId),
  index('disciplinary_case_team_idx').on(t.subjectTeamRegistrationId),
  foreignKey({name:'disciplinary_cases_season_competition_fk',columns:[t.seasonId,t.competitionId],foreignColumns:[seasons.id,seasons.competitionId]}),
  foreignKey({name:'disciplinary_cases_team_season_fk',columns:[t.subjectTeamRegistrationId,t.seasonId],foreignColumns:[teamRegistrations.id,teamRegistrations.seasonId]}),
  check('disciplinary_case_status_check', sql`${t.status} in ('open','under_review','awaiting_response','decided','appealed','closed')`),
  check('disciplinary_case_subject_check', sql`${t.subjectType} in ('player','team','official','match','other') and (${t.subjectPlayerRegistrationId} is not null or ${t.subjectUserId} is not null or ${t.subjectTeamRegistrationId} is not null or ${t.originMatchId} is not null)`),
  check('disciplinary_case_origin_check', sql`${t.originType} in ('match_event','referee_report','competition_administration','other')`),
  check('disciplinary_case_closure_check', sql`${t.status} <> 'closed' or (${t.closedAt} is not null and ${t.closureReason} is not null)`),
]);

export const disciplinaryCaseEntries = pgTable('disciplinary_case_entries',{
  id:uuid('id').primaryKey().defaultRandom(),
  caseId:uuid('case_id').notNull().references(()=>disciplinaryCases.id,{onDelete:'cascade'}),
  entryType:varchar('entry_type',{length:28}).notNull(),
  body:text('body'),
  fromStatus:varchar('from_status',{length:24}),
  toStatus:varchar('to_status',{length:24}),
  actorUserId:uuid('actor_user_id').references(()=>users.id,{onDelete:'set null'}),
  metadata:jsonb('metadata').$type<Record<string,unknown>>().notNull().default({}),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()
},t=>[
  index('disciplinary_case_entry_case_idx').on(t.caseId,t.createdAt),
  check('disciplinary_case_entry_type_check', sql`${t.entryType} in ('status_change','reviewer_assigned','finding','response','decision','appeal','note','sanction')`),
]);

export const disciplinarySanctions = pgTable('disciplinary_sanctions',{
  id:uuid('id').primaryKey().defaultRandom(),
  caseId:uuid('case_id').notNull().references(()=>disciplinaryCases.id,{onDelete:'restrict'}),
  competitionId:uuid('competition_id').notNull().references(()=>competitions.id,{onDelete:'restrict'}),
  seasonId:uuid('season_id'),
  subjectType:varchar('subject_type',{length:20}).notNull(),
  subjectPlayerRegistrationId:uuid('subject_player_registration_id').references(()=>playerRegistrations.id,{onDelete:'restrict'}),
  subjectUserId:uuid('subject_user_id').references(()=>users.id,{onDelete:'set null'}),
  subjectTeamRegistrationId:uuid('subject_team_registration_id').references(()=>teamRegistrations.id,{onDelete:'restrict'}),
  sanctionType:varchar('sanction_type',{length:28}).notNull(),
  reason:text('reason').notNull(),
  matchesCount:integer('matches_count'),
  startsAt:timestamp('starts_at',{withTimezone:true}),
  endsAt:timestamp('ends_at',{withTimezone:true}),
  status:varchar('status',{length:16}).notNull().default('active'),
  issuedBy:uuid('issued_by').references(()=>users.id,{onDelete:'set null'}),
  ...timestamps
},t=>[
  index('disciplinary_sanction_competition_idx').on(t.competitionId,t.status,t.createdAt),
  index('disciplinary_sanction_player_idx').on(t.subjectPlayerRegistrationId,t.status),
  index('disciplinary_sanction_team_idx').on(t.subjectTeamRegistrationId,t.status),
  index('disciplinary_sanction_case_idx').on(t.caseId),
  foreignKey({name:'disciplinary_sanctions_season_competition_fk',columns:[t.seasonId,t.competitionId],foreignColumns:[seasons.id,seasons.competitionId]}),
  check('disciplinary_sanction_type_check', sql`${t.sanctionType} in ('warning','match_suspension','competition_suspension','other')`),
  check('disciplinary_sanction_status_check', sql`${t.status} in ('active','served','appealed','revoked')`),
  check('disciplinary_sanction_subject_check', sql`${t.subjectType} in ('player','team','official','other')`),
  check('disciplinary_sanction_dates_check', sql`${t.endsAt} is null or ${t.startsAt} is null or ${t.endsAt} >= ${t.startsAt}`),
  check('disciplinary_sanction_count_check', sql`${t.matchesCount} is null or ${t.matchesCount} > 0`),
  check('disciplinary_sanction_scope_check', sql`(${t.sanctionType} not in ('match_suspension','competition_suspension')) or (${t.matchesCount} is not null or ${t.endsAt} is not null)`),
]);

export const disputes = pgTable('disputes',{
  id:uuid('id').primaryKey().defaultRandom(),
  competitionId:uuid('competition_id').notNull().references(()=>competitions.id,{onDelete:'restrict'}),
  seasonId:uuid('season_id'),
  matchId:uuid('match_id').references(()=>matches.id,{onDelete:'set null'}),
  teamRegistrationId:uuid('team_registration_id').references(()=>teamRegistrations.id,{onDelete:'restrict'}),
  subjectType:varchar('subject_type',{length:32}).notNull(),
  subjectRefId:uuid('subject_ref_id'),
  title:varchar('title',{length:200}).notNull(),
  description:text('description').notNull(),
  status:varchar('status',{length:24}).notNull().default('draft'),
  assignedReviewerId:uuid('assigned_reviewer_id').references(()=>users.id,{onDelete:'set null'}),
  outcome:varchar('outcome',{length:24}),
  decision:text('decision'),
  submittedBy:uuid('submitted_by').references(()=>users.id,{onDelete:'set null'}),
  submittedAt:timestamp('submitted_at',{withTimezone:true}),
  decidedAt:timestamp('decided_at',{withTimezone:true}),
  closedAt:timestamp('closed_at',{withTimezone:true}),
  closureReason:text('closure_reason'),
  ...timestamps
},t=>[
  index('dispute_competition_idx').on(t.competitionId,t.status,t.createdAt),
  index('dispute_season_idx').on(t.seasonId,t.status),
  index('dispute_submitter_idx').on(t.submittedBy,t.createdAt),
  index('dispute_reviewer_idx').on(t.assignedReviewerId,t.status),
  index('dispute_team_idx').on(t.teamRegistrationId),
  foreignKey({name:'disputes_season_competition_fk',columns:[t.seasonId,t.competitionId],foreignColumns:[seasons.id,seasons.competitionId]}),
  foreignKey({name:'disputes_team_season_fk',columns:[t.teamRegistrationId,t.seasonId],foreignColumns:[teamRegistrations.id,teamRegistrations.seasonId]}),
  check('dispute_status_check', sql`${t.status} in ('draft','submitted','under_review','awaiting_information','decided','closed')`),
  check('dispute_subject_check', sql`${t.subjectType} in ('match_result','match_event','player_eligibility','team_participation','competition_decision','other')`),
  check('dispute_outcome_check', sql`${t.outcome} is null or ${t.outcome} in ('accepted','rejected','partially_accepted','no_action')`),
  check('dispute_decision_check', sql`${t.status} not in ('decided','closed') or ${t.decision} is not null`),
  check('dispute_closure_check', sql`${t.status} <> 'closed' or (${t.closedAt} is not null and ${t.closureReason} is not null)`),
]);

export const disputeEntries = pgTable('dispute_entries',{
  id:uuid('id').primaryKey().defaultRandom(),
  disputeId:uuid('dispute_id').notNull().references(()=>disputes.id,{onDelete:'cascade'}),
  entryType:varchar('entry_type',{length:28}).notNull(),
  body:text('body'),
  fromStatus:varchar('from_status',{length:24}),
  toStatus:varchar('to_status',{length:24}),
  actorUserId:uuid('actor_user_id').references(()=>users.id,{onDelete:'set null'}),
  isInternal:boolean('is_internal').notNull().default(false),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()
},t=>[
  index('dispute_entry_dispute_idx').on(t.disputeId,t.createdAt),
  check('dispute_entry_type_check', sql`${t.entryType} in ('status_change','reviewer_assigned','response','information_request','information_provided','decision','note')`),
]);

export const evidenceFiles = pgTable('evidence_files',{
  id:uuid('id').primaryKey().defaultRandom(),
  fileId:uuid('file_id').notNull().references(()=>uploadedFiles.id,{onDelete:'restrict'}),
  caseId:uuid('case_id').references(()=>disciplinaryCases.id,{onDelete:'restrict'}),
  disputeId:uuid('dispute_id').references(()=>disputes.id,{onDelete:'restrict'}),
  attachedBy:uuid('attached_by').references(()=>users.id,{onDelete:'set null'}),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
  removedAt:timestamp('removed_at',{withTimezone:true}),
  removedBy:uuid('removed_by').references(()=>users.id,{onDelete:'set null'}),
  removalReason:text('removal_reason')
},t=>[
  uniqueIndex('evidence_file_unique').on(t.fileId),
  index('evidence_case_idx').on(t.caseId,t.removedAt),
  index('evidence_dispute_idx').on(t.disputeId,t.removedAt),
  check('evidence_target_check', sql`(${t.caseId} is not null and ${t.disputeId} is null) or (${t.caseId} is null and ${t.disputeId} is not null)`),
  check('evidence_removal_check', sql`(${t.removedAt} is null and ${t.removedBy} is null) or (${t.removedAt} is not null and ${t.removedBy} is not null)`),
]);

export const notifications = pgTable('notifications',{
  id:uuid('id').primaryKey().defaultRandom(),
  userId:uuid('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),
  type:varchar('type',{length:60}).notNull(),
  title:varchar('title',{length:200}).notNull(),
  body:text('body').notNull(),
  entityType:varchar('entity_type',{length:80}),
  entityId:uuid('entity_id'),
  competitionId:uuid('competition_id').references(()=>competitions.id,{onDelete:'set null'}),
  dedupeKey:varchar('dedupe_key',{length:200}),
  readAt:timestamp('read_at',{withTimezone:true}),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()
},t=>[
  index('notification_user_idx').on(t.userId,t.createdAt),
  index('notification_unread_idx').on(t.userId,t.readAt),
  index('notification_competition_idx').on(t.competitionId,t.createdAt),
  uniqueIndex('notification_dedupe_uq').on(t.userId,t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
]);

export const notificationDeliveries = pgTable('notification_deliveries',{
  id:uuid('id').primaryKey().defaultRandom(),
  notificationId:uuid('notification_id').notNull().references(()=>notifications.id,{onDelete:'cascade'}),
  channel:varchar('channel',{length:20}).notNull().default('in_app'),
  status:varchar('status',{length:20}).notNull().default('delivered'),
  attempts:integer('attempts').notNull().default(0),
  lastError:text('last_error'),
  deliveredAt:timestamp('delivered_at',{withTimezone:true}),
  ...timestamps
},t=>[
  uniqueIndex('notification_delivery_channel_uq').on(t.notificationId,t.channel),
  check('notification_delivery_channel_check', sql`${t.channel} in ('in_app','email')`),
  check('notification_delivery_status_check', sql`${t.status} in ('pending','delivered','failed','skipped')`),
  check('notification_delivery_attempts_check', sql`${t.attempts} >= 0`),
]);
export const uploadedFiles = pgTable('uploaded_files',{
  id:uuid('id').primaryKey().defaultRandom(),
  storageKey:text('storage_key').notNull().unique(),
  storageProvider:varchar('storage_provider',{length:30}).notNull().default('local'),
  originalName:varchar('original_name',{length:255}).notNull(),
  contentType:varchar('content_type',{length:120}).notNull(),
  sizeBytes:integer('size_bytes').notNull(),
  sha256:varchar('sha256',{length:64}),
  isPrivate:boolean('is_private').notNull().default(true),
  uploadedBy:uuid('uploaded_by').references(()=>users.id,{onDelete:'set null'}),
  archivedAt:timestamp('archived_at',{withTimezone:true}),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()
},t=>[
  check('uploaded_file_size_check', sql`${t.sizeBytes} >= 0`),
  check('uploaded_file_sha256_check', sql`${t.sha256} is null or ${t.sha256} ~ '^[0-9a-f]{64}$'`),
  check('uploaded_file_provider_check', sql`${t.storageProvider} in ('local')`),
  index('uploaded_file_uploader_idx').on(t.uploadedBy,t.createdAt),
]);
