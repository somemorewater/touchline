import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RegisterForm } from '@/features/auth/RegisterForm';
import { Skeleton } from '@/components/ui/States';

export const metadata: Metadata = { title: 'Create account' };

export default function RegisterPage() {
  return (
    <Suspense fallback={<Skeleton lines={4} />}>
      <RegisterForm />
    </Suspense>
  );
}
