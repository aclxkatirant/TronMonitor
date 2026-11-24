'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { CheckHistory, CheckResultItem, IncidentDetail, IncidentListItem, NotificationCatalog, NotificationChannel, Paginated, RecentNotification, UptimeCheck, UptimeCheckDetail } from '@/lib/types';
import type { RangeSelection } from '@/components/charts/range-picker';
import { toQuery } from '@/components/charts/range-picker';

export interface IncidentFilters {
  status?: string;
  severity?: string;
  type?: string;
  serverId?: string;
  page?: number;
  pageSize?: number;
}

function params(filters: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
}

export function useIncidents(filters: IncidentFilters) {
  const q = params(filters as Record<string, string | number | undefined>);
  return useQuery({ queryKey: ['incidents', 'list', q], queryFn: () => api.get<Paginated<IncidentListItem>>(`/incidents?${q}`), placeholderData: keepPreviousData, refetchInterval: 30_000 });
}

export function useIncident(id: string | null) {
  return useQuery({ queryKey: ['incidents', id], queryFn: () => api.get<IncidentDetail>(`/incidents/${id}`), enabled: !!id, refetchInterval: 30_000 });
}

export function useIncidentCatalog() {
  return useQuery({ queryKey: ['incidents', 'catalog'], queryFn: () => api.get<{ types: { value: string; label: string }[]; severities: { value: string; label: string }[] }>('/incidents/meta/catalog'), staleTime: 10 * 60_000 });
}

export function useChecks(filters: { serverId?: string } = {}) {
  const q = params(filters);
  return useQuery({ queryKey: ['checks', 'list', q], queryFn: () => api.get<UptimeCheck[]>(`/checks?${q}`), refetchInterval: 20_000 });
}

export function useCheck(id: string | null) {
  return useQuery({ queryKey: ['checks', id], queryFn: () => api.get<UptimeCheckDetail>(`/checks/${id}`), enabled: !!id, refetchInterval: 20_000 });
}

export function useCheckResults(id: string | null, limit = 50) {
  return useQuery({ queryKey: ['checks', id, 'results', limit], queryFn: () => api.get<CheckResultItem[]>(`/checks/${id}/results?limit=${limit}`), enabled: !!id, refetchInterval: 20_000 });
}

export function useCheckHistory(id: string | null, selection: RangeSelection) {
  const q = toQuery(selection);
  return useQuery({ queryKey: ['checks', id, 'history', q], queryFn: () => api.get<CheckHistory>(`/checks/${id}/history?${q}`), enabled: !!id, placeholderData: keepPreviousData, refetchInterval: selection.range === 'custom' ? false : 30_000 });
}

export function useChannels() {
  return useQuery({ queryKey: ['notifications', 'channels'], queryFn: () => api.get<NotificationChannel[]>('/notification-channels') });
}

export function useNotificationCatalog() {
  return useQuery({ queryKey: ['notifications', 'catalog'], queryFn: () => api.get<NotificationCatalog>('/notification-channels/meta/catalog'), staleTime: 10 * 60_000 });
}

export function useRecentNotifications() {
  return useQuery({ queryKey: ['notifications', 'recent'], queryFn: () => api.get<RecentNotification[]>('/notification-channels/recent'), refetchInterval: 30_000 });
}

export function useInvalidate(keys: string[][]) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all(keys.map((key) => queryClient.invalidateQueries({ queryKey: key })));
  };
}
