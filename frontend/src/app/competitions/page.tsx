import type { Metadata } from 'next';
import { CompetitionsView } from '@/features/competitions/CompetitionsView';

export const metadata: Metadata = { title: 'Competitions' };
export default function CompetitionsPage() {
  return <CompetitionsView />;
}
