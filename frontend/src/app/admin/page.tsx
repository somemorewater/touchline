import type { Metadata } from 'next';
import { RequireAuth } from '@/features/auth/guards';
import { AdminConsole } from '@/features/admin/AdminConsole';

export const metadata: Metadata = { title: 'Administration' };

export default function AdminPage() {
  return (
    <RequireAuth>
      <AdminConsole />
    </RequireAuth>
  );
}
