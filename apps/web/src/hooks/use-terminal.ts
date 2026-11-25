'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Paginated, ServerCredentialView, TerminalCommandItem, TerminalServerItem, TerminalSessionItem } from '@/lib/types';

export function useTerminalServers() {
  return useQuery({ queryKey: ['terminal', 'servers'], queryFn: () => api.get<TerminalServerItem[]>('/terminal/servers'), refetchInterval: 15_000 });
}

export function useTerminalSessions(filters: { serverId?: string; page?: number; pageSize?: number }) {
  const p = new URLSearchParams();
  if (filters.serverId) p.set('serverId', filters.serverId);
  p.set('page', String(filters.page ?? 1));
  p.set('pageSize', String(filters.pageSize ?? 20));
  const q = p.toString();
  return useQuery({ queryKey: ['terminal', 'sessions', q], queryFn: () => api.get<Paginated<TerminalSessionItem>>(`/terminal/sessions?${q}`), placeholderData: keepPreviousData, refetchInterval: 15_000 });
}

export function useTerminalCommands(sessionId: string | null) {
  return useQuery({ queryKey: ['terminal', 'commands', sessionId], queryFn: () => api.get<TerminalCommandItem[]>(`/terminal/sessions/${sessionId}/commands`), enabled: !!sessionId });
}

export function useServerCredential(serverId: string | null, enabled: boolean) {
  return useQuery({ queryKey: ['terminal', 'credential', serverId], queryFn: () => api.get<ServerCredentialView | null>(`/servers/${serverId}/credential`), enabled: enabled && !!serverId });
}

/** Terminal WebSocket adresi: aynı köken (/api/v1/terminal). */
export function terminalSocketUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const override = process.env.NEXT_PUBLIC_WS_URL;
  if (override) return override.replace(/\/ws$/, '/terminal');
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/v1/terminal`;
}
