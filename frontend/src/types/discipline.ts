import type { Id, ISODate, ISODateTime } from './common';

export type CaseStatus = 'open' | 'under-review' | 'decided' | 'appealed' | 'closed';

export interface DisciplinaryCase {
  id: Id;
  playerId: Id;
  teamId: Id;
  competitionId: Id;
  matchId?: Id;
  offence: string;
  openedAt: ISODateTime;
  decision?: string;
  status: CaseStatus;
}

export interface Suspension {
  id: Id;
  playerId: Id;
  competitionId: Id;
  caseId?: Id;
  matchesRemaining: number;
  startsOn: ISODate;
  liftedAt?: ISODateTime;
}

export type ProtestStatus =
  | 'draft'
  | 'submitted'
  | 'under-review'
  | 'awaiting-evidence'
  | 'accepted'
  | 'rejected'
  | 'resolved';

export type ProtestCategory =
  | 'match-result'
  | 'player-eligibility'
  | 'referee-report'
  | 'disciplinary-decision'
  | 'rule-violation'
  | 'administrative-decision';

export interface Protest {
  id: Id;
  category: ProtestCategory;
  competitionId: Id;
  matchId?: Id;
  teamId: Id;
  description: string;
  submittedAt?: ISODateTime;
  status: ProtestStatus;
  /** Visible to the submitting team. Internal notes live separately and never here. */
  publicDecision?: string;
}

export interface DisputeEvidence {
  id: Id;
  protestId: Id;
  fileName: string;
  mimeType: string;
  uploadedAt: ISODateTime;
}
