'use client';

import { useQuery } from '@tanstack/react-query';
import { services } from '@/services';

export const useAnnouncements = (competitionId?: string) =>
  useQuery({ queryKey: ['announcements', competitionId], queryFn: () => services.announcements.list({ competitionId }) });
export const useAnnouncement = (id: string) => useQuery({ queryKey: ['announcement', id], queryFn: () => services.announcements.get(id) });
