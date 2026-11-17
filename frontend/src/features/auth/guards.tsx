'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { useAuth } from './AuthProvider';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const pathname = usePathname();

  if (status === 'loading') return <Skeleton lines={3} height={90} />;
  if (status === 'anonymous') {
    return (
      <EmptyState
        title="Sign in required"
        action={
          <Link className="tl-btn tl-btn-primary" href={`/login?returnTo=${encodeURIComponent(pathname)}`}>
            Sign in
          </Link>
        }
      >
        This area is available to signed-in accounts only.
      </EmptyState>
    );
  }
  return <>{children}</>;
}

export function RequirePermission({
  permission,
  competitionId,
  children,
}: {
  permission: string;
  competitionId?: string;
  children: ReactNode;
}) {
  const { status, can, canIn } = useAuth();
  if (status === 'loading') return <Skeleton lines={2} height={70} />;
  const allowed = competitionId ? canIn(permission, competitionId) : can(permission);
  if (!allowed) {
    return (
      <EmptyState title="Not available to your account">
        Your roles do not include this action. The server enforces the same rule even if this page is opened directly.
      </EmptyState>
    );
  }
  return <>{children}</>;
}

/** Hides an action when the caller lacks the permission; the API still re-checks. */
export function PermissionGate({
  permission,
  competitionId,
  children,
  fallback = null,
}: {
  permission: string;
  competitionId?: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can, canIn } = useAuth();
  const allowed = competitionId ? canIn(permission, competitionId) : can(permission);
  return <>{allowed ? children : fallback}</>;
}
