import { TeamProfile } from '@/features/teams/TeamProfile';

export default async function TeamPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  return <TeamProfile teamId={teamId} />;
}
