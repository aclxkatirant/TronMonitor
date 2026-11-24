'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Server } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { ServerStatusBadge, UsageMeter } from '@/components/app/status';
import { RangePicker, type RangeSelection } from '@/components/charts/range-picker';
import { ServerMetricsPanel } from '@/components/charts/server-metrics-panel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTopServers } from '@/hooks/use-metrics';
import { useServers } from '@/hooks/use-servers';
import { errorMessage } from '@/lib/api';
import type { ServerStatus } from '@/lib/types';

function TopTable({ title, rows, metric }: { title: string; rows: { serverId: string; name: string; status: string; cpuPercent: number; memoryPercent: number }[]; metric: 'cpuPercent' | 'memoryPercent' }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>Son örneklere göre, çevrimiçi sunucular</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz veri yok.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sunucu</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className="text-right">Kullanım</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.serverId}>
                  <TableCell>
                    <Link href={`/sunucular/${r.serverId}/metrikler`} className="text-sm font-medium hover:underline">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <ServerStatusBadge status={r.status as ServerStatus} />
                  </TableCell>
                  <TableCell className="text-right">
                    <UsageMeter value={r[metric]} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function MonitoringPage() {
  const servers = useServers({ pageSize: 200, sort: 'name' }, { refetchInterval: 60_000 });
  const top = useTopServers();
  const [serverId, setServerId] = useState<string | null>(null);
  const [selection, setSelection] = useState<RangeSelection>({ range: '1h' });

  const items = servers.data?.items ?? [];
  // Seçim yoksa veya seçili sunucu silinmişse ilk sunucu gösterilir.
  const selected = items.find((s) => s.id === serverId) ?? items[0] ?? null;

  return (
    <div className="space-y-6">
      <PageHeader title="İzleme" description="Sunucu performansı: anlık yoğunluk ve geçmiş grafikler." />

      <div className="grid gap-4 lg:grid-cols-2">
        {top.isPending ? (
          <>
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </>
        ) : top.isError ? (
          <Alert variant="destructive" className="lg:col-span-2">
            <AlertDescription>{errorMessage(top.error)}</AlertDescription>
          </Alert>
        ) : (
          <>
            <TopTable title="En yoğun CPU" rows={top.data.byCpu} metric="cpuPercent" />
            <TopTable title="En yoğun bellek" rows={top.data.byMemory} metric="memoryPercent" />
          </>
        )}
      </div>

      {servers.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : servers.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(servers.error)}</AlertDescription>
        </Alert>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Server}
          title="İzlenecek sunucu yok"
          description="Grafikler, kayıtlı sunucular metrik göndermeye başladığında burada görünür."
          action={
            <Button asChild>
              <Link href="/sunucular/ekle">Sunucu ekle</Link>
            </Button>
          }
        />
      ) : (
        selected && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Select value={selected.id} onValueChange={setServerId}>
                <SelectTrigger className="w-72" aria-label="Sunucu seç">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {items.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ServerStatusBadge status={selected.status} />
              <RangePicker value={selection} onChange={setSelection} />
            </div>
            <ServerMetricsPanel serverId={selected.id} osFamily={selected.osFamily} selection={selection} />
          </div>
        )
      )}
    </div>
  );
}
