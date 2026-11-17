import type { Id, ISODateTime } from './common';

export type RegistrationStatus =
  | 'draft'
  | 'submitted'
  | 'under-review'
  | 'approved'
  | 'rejected'
  | 'withdrawn';

export interface Team {
  id: Id;
  name: string;
  shortName?: string;
  department?: string;
  crestUrl?: string;
  captainPlayerId?: Id;
}

/** A team's entry into one competition season, including its league placement. */
export interface TeamRegistration {
  id: Id;
  teamId: Id;
  competitionId: Id;
  seasonId: Id;
  leagueId?: Id;
  status: RegistrationStatus;
  submittedAt?: ISODateTime;
  reviewNote?: string;
  captainUserId?: Id;
}
