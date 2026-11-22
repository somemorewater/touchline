import { describe, expect, it } from 'vitest';
import type { MatchScope } from '../src/security/access.js';
import { canSeeLineup, isLineupPubliclyAvailable, lineupPublicAvailabilityAt } from '../src/modules/lineups/visibility.js';

const kickoff = new Date('2030-06-15T18:00:00.000Z');
const scope: MatchScope = {
  matchId: 'match',
  fixtureId: 'fixture',
  seasonId: 'season',
  competitionId: 'competition',
  competitionStatus: 'active',
  competitionVisibility: 'public',
  fixturePublishedAt: new Date('2030-01-01T00:00:00.000Z'),
  fixtureScheduledAt: kickoff,
  fixtureStatus: 'scheduled',
  matchStatus: 'scheduled',
  homeTeamRegistrationId: 'home',
  awayTeamRegistrationId: 'away',
};
const visibility = { all: false, ownedTeamIds: [], publicMatch: true, reviewer: false };
const published = { status: 'published', publishedAt: new Date('2030-06-15T16:00:00.000Z'), teamRegistrationId: 'home' };

describe('public lineup availability', () => {
  it('calculates kickoff minus one hour and exposes a published lineup at that instant', () => {
    const availableAt = lineupPublicAvailabilityAt(scope)!;
    expect(availableAt.toISOString()).toBe('2030-06-15T17:00:00.000Z');
    expect(isLineupPubliclyAvailable(visibility, scope, published, new Date('2030-06-15T16:59:59.999Z'))).toBe(false);
    expect(isLineupPubliclyAvailable(visibility, scope, published, availableAt)).toBe(true);
  });

  it('hides confirmed, unpublished, postponed, cancelled, and unscheduled lineups from public callers', () => {
    expect(isLineupPubliclyAvailable(visibility, scope, { ...published, status: 'confirmed' }, kickoff)).toBe(false);
    expect(isLineupPubliclyAvailable(visibility, scope, { ...published, publishedAt: null }, kickoff)).toBe(false);
    expect(isLineupPubliclyAvailable(visibility, scope, { ...published, publishedAt: new Date('2030-06-15T18:30:00.000Z') }, kickoff)).toBe(false);
    expect(isLineupPubliclyAvailable(visibility, { ...scope, fixtureStatus: 'postponed' }, published, kickoff)).toBe(false);
    expect(isLineupPubliclyAvailable(visibility, { ...scope, fixtureStatus: 'cancelled' }, published, kickoff)).toBe(false);
    expect(isLineupPubliclyAvailable(visibility, { ...scope, matchStatus: 'abandoned' }, published, kickoff)).toBe(false);
    expect(lineupPublicAvailabilityAt({ ...scope, fixtureScheduledAt: null })).toBeNull();
  });

  it('keeps private lineup access for owners regardless of public availability', () => {
    const owner = { ...visibility, publicMatch: false, ownedTeamIds: ['home'] };
    expect(canSeeLineup(owner, { ...published, status: 'draft', publishedAt: null }, scope, new Date('2030-06-15T12:00:00.000Z'))).toBe(true);
  });
});
