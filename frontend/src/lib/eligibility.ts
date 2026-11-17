import type { Competition, Player, PlayerRegistration, Suspension, TeamRegistration } from '@/types';

export type IneligibilityCode =
  | 'no-competition-registration'
  | 'registration-not-approved'
  | 'eligibility-not-verified'
  | 'team-not-approved'
  | 'squad-status'
  | 'suspended'
  | 'registered-after-deadline';

export interface EligibilityContext {
  competition: Competition;
  playerRegistration?: PlayerRegistration;
  teamRegistration?: TeamRegistration;
  suspensions: Suspension[];
  /** Registration closing instant, when the organisers have set one. */
  registrationClosesAt?: string;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: { code: IneligibilityCode; message: string }[];
}

/**
 * The single place that decides whether a player may be selected.
 * Forms, squad lists and lineup builders all call this; none re-implement it.
 * The backend must make the same decision authoritatively.
 */
export function evaluateEligibility(player: Player, ctx: EligibilityContext): EligibilityResult {
  const reasons: EligibilityResult['reasons'] = [];
  const add = (code: IneligibilityCode, message: string) => reasons.push({ code, message });
  const reg = ctx.playerRegistration;

  if (!reg || reg.competitionId !== ctx.competition.id) {
    add('no-competition-registration', 'Not registered for this competition.');
  } else {
    if (reg.status !== 'approved') add('registration-not-approved', 'Registration has not been approved.');
    if (!reg.eligibilityVerified) add('eligibility-not-verified', 'Eligibility documents have not been verified.');
    if (ctx.registrationClosesAt && reg.submittedAt && Date.parse(reg.submittedAt) > Date.parse(ctx.registrationClosesAt)) {
      add('registered-after-deadline', 'Registered after the registration deadline.');
    }
  }
  if (!ctx.teamRegistration || ctx.teamRegistration.status !== 'approved') {
    add('team-not-approved', "The player's team is not approved for this competition.");
  }
  if (player.squadStatus !== 'approved') add('squad-status', 'Not an approved member of the squad.');
  if (ctx.suspensions.some((s) => s.playerId === player.id && !s.liftedAt && s.matchesRemaining > 0)) {
    add('suspended', 'Serving a suspension.');
  }
  return { eligible: reasons.length === 0, reasons };
}
