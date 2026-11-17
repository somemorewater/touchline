import type { Metadata } from 'next';
import { RequireAuth } from '@/features/auth/guards';
import { OfficialWorkspace } from '@/features/official/OfficialWorkspace';

export const metadata: Metadata = { title: 'Official workspace' };

export default function OfficialPage() {
  return (
    <RequireAuth>
      <OfficialWorkspace />
    </RequireAuth>
  );
}
