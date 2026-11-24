'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Pencil, Play, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { CheckStatusBadge, SeverityBadge } from '@/components/app/severity';
import { RangePicker, rangeHours, type RangeSelection } from '@/components/charts/range-picker';
import { TimeSeriesChart } from '@/components/charts/time-series-chart';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { hasPermission, useMe } from '@/hooks/use-auth';
import { useCheck, useCheckHistory, useCheckResults, useInvalidate } from '@/hooks/use-operations';
import { api, errorMessage } from '@/lib/api';
import { daysUntil, formatDateTime, formatPercent, formatRelative } from '@/lib/format';
import { CheckDialog } from '../check-dialog';

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

export default function CheckDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const me = useMe();
  const canManage = hasPermission(me.data, 'uptime.manage');
  const check = useCheck(params.id);
  const results = useCheckResults(params.id, 50);
  const [selection, setSelection] = useState<RangeSelection>({ range: '24h' });
  const history = useCheckHistory(params.id, selection);
  const invalidate = useInvalidate([['checks'], ['dashboard'], ['incidents']]);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const run = useMutation({
    mutationFn: () => api.post<{ isUp: boolean; responseTimeMs: number | null; errorMessage: string | null }>(`/checks/${params.id}/run`),
    onSuccess: async (r) => {
      toast[r.isUp ? 'success' : 'error'](r.isUp ? `Kontrol başarılı (${r.responseTimeMs ?? '?'} ms).` : `Kontrol başarısız: ${r.errorMessage ?? 'bilinmiyor'}`);
      await invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete<void>(`/checks/${params.id}`),
    onSuccess: async () => {
      toast.success('Kontrol silindi.');
      await invalidate();
      router.replace('/erisilebilirlik');
    },
  });

  const points = useMemo(() => history.data?.points ?? [], [history.data]);
  const hours = rangeHours(selection);

  if (check.isPending) return <Skeleton className="h-96 w-full" />;
  if (check.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(check.error)}</AlertDescription>
      </Alert>
    );
  }
  const c = check.data;
  const sslDays = daysUntil(c.sslExpiresAt);

  return (
    <div className="space-y-6">
      <PageHeader
        title={c.name}
        description={`${c.typeLabel} · ${c.target}${c.port ? `:${c.port}` : ''}`}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/erisilebilirlik">
                <ArrowLeft /> Kontroller
              </Link>
            </Button>
            {canManage && (
              <>
                <Button variant="outline" size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
                  <Play /> Şimdi çalıştır
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil /> Düzenle
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                  <Trash2 /> Sil
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        {c.isEnabled ? <CheckStatusBadge status={c.status} /> : <Badge variant="outline">Devre dışı</Badge>}
        <span className="text-muted-foreground">Son denetim: {formatRelative(c.lastCheckedAt)}</span>
        <span className="text-muted-foreground">Durum değişimi: {formatDateTime(c.lastStatusChangeAt)}</span>
        {c.server && (
          <Link href={`/sunucular/${c.server.id}`} className="hover:underline">
            Sunucu: {c.server.name}
          </Link>
        )}
      </div>

      {c.activeIncidents.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {c.activeIncidents.map((i) => (
              <Link key={i.id} href={`/olaylar/${i.id}`} className="inline-flex items-center gap-2 hover:underline">
                <SeverityBadge severity={i.severity} /> {i.title}
              </Link>
            ))}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Erişilebilirlik (24 sa)" value={formatPercent(c.uptime24h, 2)} />
        <Stat label="Erişilebilirlik (7 gün)" value={formatPercent(c.uptime7d, 2)} />
        <Stat label="Erişilebilirlik (30 gün)" value={formatPercent(c.uptime30d, 2)} />
        <Stat label={c.type === 'HTTPS' ? 'SSL bitişine' : 'Son yanıt'} value={c.type === 'HTTPS' ? (sslDays === null ? '—' : sslDays < 0 ? 'Doldu' : `${sslDays} gün`) : c.lastResponseMs !== null ? `${c.lastResponseMs} ms` : '—'} />
      </div>

      <RangePicker value={selection} onChange={setSelection} />
      <div className="grid gap-4 lg:grid-cols-2">
        <TimeSeriesChart title="Yanıt süresi" description="Ortalama ve en yüksek (ms)" points={points} series={[{ key: 'avgMs', label: 'Ortalama' }, { key: 'maxMs', label: 'En yüksek', color: 'var(--series-2)' }]} unit="number" loading={history.isFetching} rangeHours={hours} />
        <TimeSeriesChart title="Erişilebilirlik" description="Başarılı denetim yüzdesi" points={points} series={[{ key: 'availability', label: 'Erişilebilirlik', color: 'var(--series-3)' }]} variant="area" unit="percent" fixedPercent loading={history.isFetching} rangeHours={hours} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Son sonuçlar</CardTitle>
          <CardDescription>
            Aralık {c.intervalSec} sn · zaman aşımı {c.timeoutSec} sn · {c.retryCount} yeniden deneme · hata eşiği {c.failureThreshold}, toparlanma eşiği {c.recoveryThreshold}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {results.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : results.isError ? (
            <p className="text-sm text-muted-foreground">{errorMessage(results.error)}</p>
          ) : results.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Henüz sonuç yok.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zaman</TableHead>
                  <TableHead>Sonuç</TableHead>
                  <TableHead>Yanıt</TableHead>
                  <TableHead>HTTP</TableHead>
                  <TableHead>Hata</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">{formatDateTime(r.checkedAt)}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <span className={r.isUp ? 'size-2 rounded-full bg-status-ok' : 'size-2 rounded-full bg-status-error'} aria-hidden />
                        {r.isUp ? 'Başarılı' : 'Başarısız'}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">{r.responseTimeMs !== null ? `${r.responseTimeMs} ms` : '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{r.statusCode ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.errorMessage ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editOpen && <CheckDialog key={c.updatedAt} open={editOpen} onOpenChange={setEditOpen} check={c} />}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Kontrolü sil</DialogTitle>
            <DialogDescription>&quot;{c.name}&quot; kontrolü ve tüm sonuç geçmişi kalıcı olarak silinir; açık olayları da kaldırılır.</DialogDescription>
          </DialogHeader>
          {remove.isError && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(remove.error)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Vazgeç
            </Button>
            <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Kalıcı olarak sil
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
