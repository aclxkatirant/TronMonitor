'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { RangeSelection } from '@/components/charts/range-picker';
import { toQuery } from '@/components/charts/range-picker';

// Tür takma adı (interface değil): böylece TimePoint'in indeks imzasıyla uyumlu olur.
export type MetricPoint = {
  t: string;
  cpuAvg: number | null;
  cpuMax: number | null;
  memAvg: number | null;
  memMax: number | null;
  netRx: number | null;
  netTx: number | null;
  diskRead: number | null;
  diskWrite: number | null;
  diskUsedPct: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  samples: number;
};

export interface MetricsHistory {
  range: { from: string; to: string; bucketSeconds: number; source: 'raw' | 'minute5' | 'hour1' | 'day1' };
  points: MetricPoint[];
}

export interface VolumeHistory {
  range: MetricsHistory['range'];
  available: boolean;
  series: { volume: string; points: { t: string; usedPct: number | null; usedBytes: number | null; totalBytes: number | null }[] }[];
}

export interface InterfaceHistory {
  range: MetricsHistory['range'];
  available: boolean;
  series: { name: string; points: { t: string; rx: number | null; tx: number | null }[] }[];
}

export interface TopServers {
  byCpu: { serverId: string; name: string; status: string; cpuPercent: number; memoryPercent: number; timestamp: string }[];
  byMemory: { serverId: string; name: string; status: string; cpuPercent: number; memoryPercent: number; timestamp: string }[];
  sampled: number;
}

const REFETCH_MS = 30_000;

export function useMetricsHistory(serverId: string | null, selection: RangeSelection) {
  const query = toQuery(selection);
  return useQuery({
    queryKey: ['server', serverId, 'metrics', query],
    queryFn: () => api.get<MetricsHistory>(`/servers/${serverId}/metrics?${query}`),
    enabled: !!serverId,
    placeholderData: keepPreviousData,
    refetchInterval: selection.range === 'custom' ? false : REFETCH_MS,
  });
}

export function useVolumeHistory(serverId: string | null, selection: RangeSelection) {
  const query = toQuery(selection);
  return useQuery({
    queryKey: ['server', serverId, 'metrics', 'volumes', query],
    queryFn: () => api.get<VolumeHistory>(`/servers/${serverId}/metrics/volumes?${query}`),
    enabled: !!serverId,
    placeholderData: keepPreviousData,
    refetchInterval: selection.range === 'custom' ? false : REFETCH_MS,
  });
}

export function useInterfaceHistory(serverId: string | null, selection: RangeSelection) {
  const query = toQuery(selection);
  return useQuery({
    queryKey: ['server', serverId, 'metrics', 'interfaces', query],
    queryFn: () => api.get<InterfaceHistory>(`/servers/${serverId}/metrics/interfaces?${query}`),
    enabled: !!serverId,
    placeholderData: keepPreviousData,
    refetchInterval: selection.range === 'custom' ? false : REFETCH_MS,
  });
}

export function useTopServers() {
  return useQuery({ queryKey: ['servers', 'metrics', 'top'], queryFn: () => api.get<TopServers>('/metrics/top'), refetchInterval: 20_000 });
}
