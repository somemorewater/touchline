import { CompetitionDetail } from '@/features/competitions/CompetitionDetail';

export default async function CompetitionPage({ params }: { params: Promise<{ competitionId: string }> }) {
  const { competitionId } = await params;
  return <CompetitionDetail idOrSlug={competitionId} />;
}
