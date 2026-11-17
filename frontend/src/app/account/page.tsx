import type { Metadata } from 'next';
import { RequireAuth } from '@/features/auth/guards';
import { AccountView } from '@/features/account/AccountView';

export const metadata: Metadata = { title: 'Account' };

export default function AccountPage() {
  return (
    <RequireAuth>
      <AccountView />
    </RequireAuth>
  );
}
