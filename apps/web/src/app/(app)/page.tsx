'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, CircleAlert, Plus, Server } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { UsageMeter } from '@/components/app/status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { hasPermission, useMe } from '@/hooks/use-auth';
import { useDashboardSummary } from '@/hooks/use-servers';
import { api, errorMessage, isApiError } from '@/lib/api';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format';
import { AGENT_EVENT_LABELS } from '@/lib/types';

interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  checks: { database: 'ok' | 'error'; redis: 'ok' | 'error' };
  timestamp: string;
}

function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      try {
        return await api.get<HealthResponse>('/health');
      } catch (error) {
        if (isApiError(error) && error.status === 503) {
          return { status: 'degraded', version: '?', checks: { database: 'error', redis: 'error' }, timestamp: new Date().toISOString() } satisfies HealthResponse;
        }
        throw error;
      }
    },
    refetchInterval: 30_000,
  });
}

function StatCard({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'ok' | 'error' | 'warn' }) {
  const toneClass = tone === 'ok' ? 'text-status-ok' : tone === 'error' ? 'text-status-error' : tone === 'warn' ? 'text-status-warn' : '';
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={`text-2xl tabular-nums ${toneClass}`}>{value}</CardTitle>
      </CardHeader>
      {hint && <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>}
    </Card>
  );
}

export default function OverviewPage() {
  const me = useMe();
  const health = useHealth();
  const summary = useDashboardSummary();
  const canRegister = hasPermission(me.data, 'servers.register');

  const s = summary.data;

  return (
    <div className="space-y-6">
      <PageHeader title="Genel Bakış" description="Altyapınızın özet durumu." />

      {summary.isError && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(summary.error)}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Toplam sunucu" value={s ? s.servers.total : <Skeleton className="h-7 w-10" />} hint={s ? `${s.servers.windows} Windows · ${s.servers.linux} Linux` : undefined} />
        <StatCard label="Çevrimiçi" value={s ? s.servers.online : <Skeleton className="h-7 w-10" />} tone={s && s.servers.total > 0 ? 'ok' : undefined} hint={s ? `${s.servers.degraded} sorunlu` : undefined} />
        <StatCard label="Çevrimdışı" value={s ? s.servers.offline : <Skeleton className="h-7 w-10" />} tone={s && s.servers.offline > 0 ? 'error' : undefined} hint={s && s.servers.pending > 0 ? `${s.servers.pending} bekliyor` : undefined} />
        <StatCard
          label="Erişilebilirlik"
          value={s ? (s.availabilityPercent === null ? '—' : `%${s.availabilityPercent}`) : <Skeleton className="h-7 w-14" />}
          tone={s && s.availabilityPercent !== null ? (s.availabilityPercent >= 99 ? 'ok' : s.availabilityPercent >= 90 ? 'warn' : 'error') : undefined}
          hint={s ? `${s.activeIncidents} etkin olay` : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ortalama kullanım</CardTitle>
            <CardDescription>{s ? `${s.usage.sampledServers} çevrimiçi sunucunun son örnekleri` : ' '}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {s ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">CPU</span>
                  <UsageMeter value={s.usage.avgCpuPercent} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Bellek</span>
                  <UsageMeter value={s.usage.avgMemoryPercent} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Disk</span>
                  <UsageMeter value={s.usage.diskUsedPercent} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {s.usage.diskUsedPercent !== null ? `${formatBytes(s.usage.diskUsedBytes)} / ${formatBytes(s.usage.diskTotalBytes)} disk kullanımda` : 'Henüz metrik verisi yok.'}
                </p>
              </>
            ) : (
              <Skeleton className="h-24 w-full" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Platform sağlığı</CardTitle>
            <CardDescription>Merkezi bileşenler</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {health.isPending ? (
              <Skeleton className="h-20 w-full" />
            ) : health.isError ? (
              <p className="flex items-center gap-2 text-status-error">
                <CircleAlert className="size-4" aria-hidden /> API&apos;ye ulaşılamıyor
              </p>
            ) : (
              <>
                <p className="flex items-center gap-2">
                  {health.data.status === 'ok' ? <CheckCircle2 className="size-4 text-status-ok" aria-hidden /> : <CircleAlert className="size-4 text-status-warn" aria-hidden />}
                  {health.data.status === 'ok' ? 'Tüm bileşenler çalışıyor' : 'Kısmi sorun'}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Veritabanı</span>
                  <span>{health.data.checks.database === 'ok' ? 'Bağlı' : 'Hata'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Redis</span>
                  <span>{health.data.checks.redis === 'ok' ? 'Bağlı' : 'Hata'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">API sürümü</span>
                  <span className="font-mono text-xs">{health.data.version}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Son olaylar</CardTitle>
            <CardDescription>Ajan bağlantı geçmişi</CardDescription>
          </CardHeader>
          <CardContent>
            {!s ? (
              <Skeleton className="h-24 w-full" />
            ) : s.recentEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">Henüz olay yok.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {s.recentEvents.slice(0, 6).map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <Link href={`/sunucular/${e.serverId}`} className="block truncate font-medium hover:underline">
                        {e.serverName}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{AGENT_EVENT_LABELS[e.type]}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(e.createdAt)}>
                      {formatRelative(e.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {s && s.servers.total === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hoş geldiniz{me.data ? `, ${me.data.fullName}` : ''}</CardTitle>
            <CardDescription>İlk sunucunuzu ekleyerek izlemeye başlayın.</CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={Server}
              title="İzlenecek sunucu yok"
              description="Bir kayıt belirteci oluşturun ve kurulum komutunu sunucuda çalıştırın; sunucu birkaç saniye içinde burada görünür."
              action={
                canRegister ? (
                  <Button asChild>
                    <Link href="/sunucular/ekle">
                      <Plus /> Sunucu ekle
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      )}

      {s && s.servers.total > 0 && (
        <div className="text-sm">
          <Link href="/sunucular" className="inline-flex items-center gap-1 text-foreground hover:underline">
            Tüm sunucuları görüntüle <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      )}
    </div>
  );
}
