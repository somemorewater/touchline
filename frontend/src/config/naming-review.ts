/**
 * Two team-name lists were supplied and they do not match. TOUCHLINE uses the league-group
 * names (the structure supplied in the competition brief) as the team records and has NOT
 * linked them to the names below. Pairings in `possibleMatch` are guesses for the organisers
 * to confirm or correct; nothing in the application reads them.
 */
export interface NamingReviewItem {
  leagueGroupName: string;
  league: 'A' | 'B';
  registeredListName?: string;
  confidence: 'exact' | 'unconfirmed-guess';
}

export const NAMING_REVIEW: NamingReviewItem[] = [
  { leagueGroupName: 'AUTOMECH BOIS', league: 'A', registeredListName: 'AUTOMECH BOIS', confidence: 'exact' },
  { leagueGroupName: 'COMPUTER SCIENCE', league: 'A', registeredListName: 'COMP FC', confidence: 'unconfirmed-guess' },
  { leagueGroupName: 'ICE', league: 'A', registeredListName: 'ICE UTD', confidence: 'unconfirmed-guess' },
  { leagueGroupName: 'STAT/MATHS UTD', league: 'A', registeredListName: 'STATS AND MATHS UTD', confidence: 'unconfirmed-guess' },
  { leagueGroupName: 'ND CIVIL FC', league: 'A', registeredListName: 'ND CIVIL ENGINEERING', confidence: 'unconfirmed-guess' },
  { leagueGroupName: 'TELECOM FC', league: 'A', registeredListName: 'TELECOM FC', confidence: 'exact' },
  { leagueGroupName: 'CYBER BOYS', league: 'B', registeredListName: 'CYBER FC', confidence: 'unconfirmed-guess' },
  { leagueGroupName: 'PHYSICS/PWE UTD', league: 'B', registeredListName: 'PHY/ELECT UTD', confidence: 'unconfirmed-guess' },
  { leagueGroupName: 'AEROSPACE', league: 'B', registeredListName: 'AEROSPACE', confidence: 'exact' },
  { leagueGroupName: 'ND ELECTRICAL', league: 'B', registeredListName: 'ND ELECT ELECT FC', confidence: 'unconfirmed-guess' },
  { leagueGroupName: 'MET AND MECH', league: 'B', registeredListName: 'MECH AND MATS FC', confidence: 'unconfirmed-guess' },
  { leagueGroupName: 'ELECTRICAL AND CHEMISTRY UNITED', league: 'B', registeredListName: 'CHEM AND ELECT UTD', confidence: 'unconfirmed-guess' },
];
