import { broadcastToMatch } from '../../security/connections.js';

export interface LiveEventPayload {
  id: string;
  matchId: string;
  eventType: string;
  teamRegistrationId: string | null;
  playerRegistrationId: string | null;
  secondaryPlayerRegistrationId: string | null;
  minute: number;
  addedMinutes: number | null;
  description: string | null;
  voided: boolean;
  corrected: boolean;
}

export interface LiveMatchPayload {
  matchId: string;
  status: string;
  currentMinute: number | null;
  addedMinutes: number | null;
  homeScore: number;
  awayScore: number;
  resultConfirmedAt: string | null;
}

/** Sanitized event shape: no actor IDs, audit reasons or credentials. */
export function sanitizeEvent(event: {
  id: string;
  matchId: string;
  eventType: string;
  teamRegistrationId: string | null;
  playerRegistrationId: string | null;
  secondaryPlayerRegistrationId: string | null;
  minute: number;
  addedMinutes: number | null;
  description: string | null;
  voidedAt: Date | null;
  correctedAt: Date | null;
}): LiveEventPayload {
  return {
    id: event.id,
    matchId: event.matchId,
    eventType: event.eventType,
    teamRegistrationId: event.teamRegistrationId,
    playerRegistrationId: event.playerRegistrationId,
    secondaryPlayerRegistrationId: event.secondaryPlayerRegistrationId,
    minute: event.minute,
    addedMinutes: event.addedMinutes,
    description: event.description,
    voided: event.voidedAt !== null,
    corrected: event.correctedAt !== null,
  };
}

export function broadcastMatchUpdate(
  matchId: string,
  match: {
    status: string;
    currentMinute: number | null;
    addedMinutes: number | null;
    homeScore: number;
    awayScore: number;
    resultConfirmedAt: Date | null;
  },
  reason: string,
  event?: LiveEventPayload,
): void {
  const matchPayload: LiveMatchPayload = {
    matchId,
    status: match.status,
    currentMinute: match.currentMinute,
    addedMinutes: match.addedMinutes,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    resultConfirmedAt: match.resultConfirmedAt
      ? match.resultConfirmedAt.toISOString()
      : null,
  };
  broadcastToMatch(matchId, {
    type: 'match.update',
    reason,
    at: new Date().toISOString(),
    match: matchPayload,
    ...(event ? { event } : {}),
  });
}
