/** Derive review presentation without changing the approved registration row. */
export function registrationDisplayStatus(registrationStatus: string, latestEditStatus?: string | null): string {
  if (registrationStatus === 'approved' && latestEditStatus === 'pending') return 'pending_changes';
  if (registrationStatus === 'approved' && latestEditStatus === 'rejected') return 'rejected_changes';
  return registrationStatus;
}
