import { MatchCentre } from '@/features/matches/MatchCentre';

export default async function MatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  return <MatchCentre matchId={matchId} />;
}
