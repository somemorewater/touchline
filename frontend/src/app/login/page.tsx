import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/features/auth/LoginForm';
import { Skeleton } from '@/components/ui/States';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <Suspense fallback={<Skeleton lines={4} />}>
      <LoginForm />
    </Suspense>
  );
}
