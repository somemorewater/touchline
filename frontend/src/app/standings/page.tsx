import type { Metadata } from 'next';
import { StandingsView } from '@/features/standings/StandingsView';

export const metadata: Metadata = { title: 'Standings' };
export default function StandingsPage() {
  return <StandingsView />;
}
