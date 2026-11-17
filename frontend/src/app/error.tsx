'use client';

import { ErrorState } from '@/components/ui/States';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState title="Something went wrong on this page" onRetry={reset} />;
}
