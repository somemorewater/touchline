import type { Metadata } from 'next';
import { PlayersView } from '@/features/players/PlayersView';

export const metadata: Metadata = { title: 'Players' };
export default function PlayersPage() {
  return <PlayersView />;
}
