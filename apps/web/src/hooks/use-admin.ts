'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AgentCommandItem, ApiTokenItem, AuditLogItem, AuditMeta, MonitoredServiceItem, Paginated, ServiceListResponse } from '@/lib/types';

function params(filters: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
}

export function useServerServices(serverId: string | null, filters: { search?: string; monitored?: boolean; state?: string; page?: number; pageSize?: number }) {
  const q = params(filters);
  return useQuery({ queryKey: ['services', 'server', serverId, q], queryFn: () => api.get<ServiceListResponse>(`/servers/${serverId}/services?${q}`), enabled: !!serverId, placeholderData: keepPreviousData, refetchInterval: 30_000 });
}

export function useMonitoredServices() {
  return useQuery({ queryKey: ['services', 'monitored'], queryFn: () => api.get<MonitoredServiceItem[]>('/services/monitored'), refetchInterval: 30_000 });
}

export function useServiceCommands(serverId?: string) {
  const q = params({ serverId, limit: 25 });
  return useQuery({ queryKey: ['services', 'commands', q], queryFn: () => api.get<AgentCommandItem[]>(`/services/commands?${q}`), refetchInterval: 10_000 });
}

export interface AuditFilters {
  search?: string;
  action?: string;
  resourceType?: string;
  result?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export function useAuditLogs(filters: AuditFilters) {
  const q = params(filters as Record<string, string | number | undefined>);
  return useQuery({ queryKey: ['audit', 'list', q], queryFn: () => api.get<Paginated<AuditLogItem>>(`/audit-logs?${q}`), placeholderData: keepPreviousData });
}

export function useAuditMeta() {
  return useQuery({ queryKey: ['audit', 'meta'], queryFn: () => api.get<AuditMeta>('/audit-logs/meta'), staleTime: 60_000 });
}

export function useApiTokens(all: boolean) {
  return useQuery({ queryKey: ['api-tokens', all], queryFn: () => api.get<ApiTokenItem[]>(`/api-tokens?all=${all}`) });
}

export function useApiTokenScopes() {
  return useQuery({ queryKey: ['api-tokens', 'scopes'], queryFn: () => api.get<{ key: string; description: string }[]>('/api-tokens/meta/scopes'), staleTime: 5 * 60_000 });
}
