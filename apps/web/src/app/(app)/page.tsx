'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, CircleAlert, Server, Users } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { hasPermission, useMe } from '@/hooks/use-auth';
import { api, isApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { Paginated, UserSummary } from '@/lib/types';

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
        // 503 yanıtı da sağlık gövdesi taşır; onu görüntüleriz.
        if (isApiError(error) && error.status === 503) {
          return { status: 'degraded', version: '?', checks: { database: 'error', redis: 'error' }, timestamp: new Date().toISOString() } satisfies HealthResponse;
        }
        throw error;
      }
    },
    refetchInterval: 30_000,
  });
}

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={ok ? 'inline-block size-2 rounded-full bg-status-ok' : 'inline-block size-2 rounded-full bg-status-error'} aria-hidden />;
}

export default function OverviewPage() {
  const me = useMe();
  const health = useHealth();
  const canReadUsers = hasPermission(me.data, 'users.read');
  const users = useQuery({
    queryKey: ['users', 'overview-count'],
    queryFn: () => api.get<Paginated<UserSummary>>('/users?page=1&pageSize=1'),
    enabled: canReadUsers,
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Genel Bakış" description="Altyapınızın özet durumu." />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Platform sağlığı</CardDescription>
            <CardTitle className="flex items-center gap-2 text-base">
              {health.isPending ? (
                <Skeleton className="h-5 w-24" />
              ) : health.isError ? (
                <>
                  <CircleAlert className="size-4 text-status-error" aria-hidden /> Ulaşılamıyor
                </>
              ) : health.data.status === 'ok' ? (
                <>
                  <CheckCircle2 className="size-4 text-status-ok" aria-hidden /> Çalışıyor
                </>
              ) : (
                <>
                  <CircleAlert className="size-4 text-status-warn" aria-hidden /> Kısmi sorun
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {health.data ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Veritabanı</span>
                  <span className="flex items-center gap-1.5">
                    <StatusDot ok={health.data.checks.database === 'ok'} />
                    {health.data.checks.database === 'ok' ? 'Bağlı' : 'Hata'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Redis</span>
                  <span className="flex items-center gap-1.5">
                    <StatusDot ok={health.data.checks.redis === 'ok'} />
                    {health.data.checks.redis === 'ok' ? 'Bağlı' : 'Hata'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">API sürümü</span>
                  <span className="font-mono text-xs">{health.data.version}</span>
                </div>
              </>
            ) : health.isError ? (
              <p className="text-muted-foreground">Sağlık bilgisi alınamadı.</p>
            ) : (
              <Skeleton className="h-16 w-full" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Kayıtlı sunucular</CardDescription>
            <CardTitle className="text-2xl tabular-nums">0</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Henüz sunucu kaydedilmedi. Sunucu kaydı bir sonraki sürümde etkinleştirilecek.</CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Kullanıcılar</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {!canReadUsers ? '—' : users.isPending ? <Skeleton className="h-7 w-10" /> : users.isError ? '—' : users.data.total}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {canReadUsers ? (
              <Link href="/kullanicilar" className="inline-flex items-center gap-1 text-foreground hover:underline">
                Kullanıcıları yönet <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            ) : (
              'Kullanıcı listesini görüntüleme izniniz yok.'
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hoş geldiniz{me.data ? `, ${me.data.fullName}` : ''}</CardTitle>
          <CardDescription>
            Son giriş: {formatDateTime(me.data?.lastLoginAt)} · Rol: {me.data?.roleLabel ?? '—'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Server}
            title="İzlenecek sunucu yok"
            description="Sunucu kaydı ve ajan kurulumu etkinleştirildiğinde CPU, bellek, disk ve ağ istatistikleri burada görünecek."
            action={
              canReadUsers ? (
                <Button asChild variant="outline" size="sm">
                  <Link href="/kullanicilar">
                    <Users /> Ekip üyelerini ekle
                  </Link>
                </Button>
              ) : undefined
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
