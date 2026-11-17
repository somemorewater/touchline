import { PlayerProfile } from '@/features/players/PlayerProfile';

export default async function PlayerPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  return <PlayerProfile playerId={playerId} />;
}
