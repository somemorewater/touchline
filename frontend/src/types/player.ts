import type { Id, ISODate, ISODateTime, Measured } from './common';
import type { RegistrationStatus } from './team';
import type { PlayerPosition } from '@/lib/positions';

export type { PlayerPosition, PositionCategory } from '@/lib/positions';
export type SquadStatus = 'registered' | 'approved' | 'suspended' | 'released';

export interface Player {
  id: Id;
  fullName: string;
  teamId: Id;
  department?: string;
  position?: PlayerPosition;
  shirtNumber?: number;
  photoUrl?: string;
  dateOfBirth?: ISODate;
  squadStatus: SquadStatus;
}

export interface PlayerRegistration {
  id: Id;
  playerId: Id;
  competitionId: Id;
  seasonId: Id;
  matriculationNumber?: string;
  status: RegistrationStatus;
  eligibilityVerified: boolean;
  submittedAt?: ISODateTime;
  reviewNote?: string;
}

export interface PlayerStatistics {
  playerId: Id;
  competitionId: Id;
  seasonId: Id;
  appearances: Measured;
  starts: Measured;
  substituteAppearances: Measured;
  minutesPlayed: Measured;
  goals: Measured;
  assists: Measured;
  yellowCards: Measured;
  redCards: Measured;
  cleanSheets?: Measured;
}

export interface TeamStatistics {
  teamId: Id;
  competitionId: Id;
  seasonId: Id;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheets: Measured;
  yellowCards: Measured;
  redCards: Measured;
}
