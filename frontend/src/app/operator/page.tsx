import type { Metadata } from 'next';
import { RequireAuth } from '@/features/auth/guards';
import { OperatorControlRoom } from '@/features/operator/OperatorControlRoom';

export const metadata: Metadata = { title: 'Operator control room' };

export default function OperatorPage() {
  return (
    <RequireAuth>
      <OperatorControlRoom />
    </RequireAuth>
  );
}
