'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AgentEvent, DashboardSummary, Paginated, PlatformCatalog, RegistrationTokenRecord, ServerDetail, ServerGroup, ServerListItem, Tag } from '@/lib/types';

export interface ServerFilters {
  search?: string;
  osFamily?: string;
  status?: string;
  groupId?: string;
  tagId?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

function toParams(filters: ServerFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters) as [string, string | number | undefined][]) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export function useServers(filters: ServerFilters, options: { refetchInterval?: number } = {}) {
  const query = toParams(filters);
  return useQuery({
    queryKey: ['servers', 'list', query],
    queryFn: () => api.get<Paginated<ServerListItem>>(`/servers?${query}`),
    placeholderData: keepPreviousData,
    refetchInterval: options.refetchInterval ?? 20_000,
  });
}

export function useServer(id: string | null) {
  return useQuery({
    queryKey: ['server', id],
    queryFn: () => api.get<ServerDetail>(`/servers/${id}`),
    enabled: !!id,
    refetchInterval: 20_000,
  });
}

export function useServerEvents(id: string | null, page = 1) {
  return useQuery({
    queryKey: ['server', id, 'events', page],
    queryFn: () => api.get<Paginated<AgentEvent>>(`/servers/${id}/events?page=${page}&pageSize=25`),
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
}

export function useGroups(enabled = true) {
  return useQuery({ queryKey: ['servers', 'groups'], queryFn: () => api.get<ServerGroup[]>('/server-groups'), enabled, staleTime: 60_000 });
}

export function useTags(enabled = true) {
  return useQuery({ queryKey: ['servers', 'tags'], queryFn: () => api.get<Tag[]>('/tags'), enabled, staleTime: 60_000 });
}

export function usePlatforms() {
  return useQuery({ queryKey: ['registration-tokens', 'platforms'], queryFn: () => api.get<PlatformCatalog>('/registration-tokens/meta/platforms'), staleTime: 10 * 60_000 });
}

export function useRegistrationTokens(options: { refetchInterval?: number; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['registration-tokens', 'list'],
    queryFn: () => api.get<RegistrationTokenRecord[]>('/registration-tokens'),
    refetchInterval: options.refetchInterval,
    enabled: options.enabled ?? true,
  });
}

export function useDashboardSummary() {
  return useQuery({ queryKey: ['dashboard', 'summary'], queryFn: () => api.get<DashboardSummary>('/dashboard/summary'), refetchInterval: 20_000 });
}

export function useInvalidateServers() {
  const queryClient = useQueryClient();
  return async (serverId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['servers'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      serverId ? queryClient.invalidateQueries({ queryKey: ['server', serverId] }) : Promise.resolve(),
    ]);
  };
}
