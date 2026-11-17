import type { Metadata } from 'next';
import { RequireAuth } from '@/features/auth/guards';
import { CaptainWorkspace } from '@/features/captain/CaptainWorkspace';

export const metadata: Metadata = { title: 'Captain workspace' };

export default function CaptainPage() {
  return (
    <RequireAuth>
      <CaptainWorkspace />
    </RequireAuth>
  );
}
