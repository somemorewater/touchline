import Link from 'next/link';
import { EmptyState } from '@/components/ui/States';

export default function NotFound() {
  return <EmptyState title="Page not found" action={<Link href="/">Go to the home page</Link>}>This address does not match a page on TOUCHLINE.</EmptyState>;
}
