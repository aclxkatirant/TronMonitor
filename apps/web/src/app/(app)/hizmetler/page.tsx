'use client';

import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Boxes, Play, RotateCw, Search, Square } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { ServerStatusBadge } from '@/components/app/status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { hasPermission, useMe } from '@/hooks/use-auth';
import { useMonitoredServices, useServerServices, useServiceCommands } from '@/hooks/use-admin';
import { useInvalidate } from '@/hooks/use-operations';
import { useServers } from '@/hooks/use-servers';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { COMMAND_STATUS_LABELS, type MonitoredServiceItem, type ServiceState } from '@/lib/types';
import { cn } from '@/lib/utils';

const ALL = '__all__';
const PAGE_SIZE = 100;
const STATE_COLOR: Record<ServiceState, string> = { RUNNING: 'bg-status-ok', STOPPED: 'bg-status-neutral', FAILED: 'bg-status-error', STARTING: 'bg-status-warn', STOPPING: 'bg-status-warn', UNKNOWN: 'bg-status-neutral' };
const ACTION_LABELS = { start: 'Başlat', stop: 'Durdur', restart: 'Yeniden başlat' } as const;
type Action = keyof typeof ACTION_LABELS;

function StateBadge({ state, label }: { state: ServiceState; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={cn('size-2 rounded-full', STATE_COLOR[state])} aria-hidden /> {label}
    </span>
  );
}

export default function ServicesPage() {
  const me = useMe();
  const canManage = hasPermission(me.data, 'services.manage');
  const canControl = hasPermission(me.data, 'services.control');
  const servers = useServers({ pageSize: 200, sort: 'name' }, { refetchInterval: 60_000 });
  const monitored = useMonitoredServices();
  const [serverId, setServerId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [state, setState] = useState(ALL);
  const [onlyMonitored, setOnlyMonitored] = useState(false);
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<{ service: MonitoredServiceItem; action: Action } | null>(null);
  const invalidate = useInvalidate([['services']]);

  const items = servers.data?.items ?? [];
  const selected = items.find((s) => s.id === serverId) ?? items[0] ?? null;
  const services = useServerServices(selected?.id ?? null, { search: submitted || undefined, state: state === ALL ? undefined : state, monitored: onlyMonitored ? true : undefined, page, pageSize: PAGE_SIZE });
  const commands = useServiceCommands(selected?.id);

  const toggle = useMutation({
    mutationFn: ({ service, isMonitored }: { service: MonitoredServiceItem; isMonitored: boolean }) => api.patch(`/servers/${service.serverId}/services/${service.id}`, { isMonitored }),
    onSuccess: async (_d, v) => {
      toast.success(v.isMonitored ? 'Hizmet izlemeye alındı.' : 'Hizmet izlemeden çıkarıldı.');
      await invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const control = useMutation({
    mutationFn: ({ service, action }: { service: MonitoredServiceItem; action: Action }) => api.post(`/servers/${service.serverId}/services/${service.id}/control`, { action }),
    onSuccess: async () => {
      toast.success('Komut ajana iletilmek üzere kuyruğa alındı; sonuç aşağıdaki komut geçmişinde görünür.');
      setConfirm(null);
      await invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPage(1);
    setSubmitted(search.trim());
  }

  const totalPages = services.data ? Math.max(1, Math.ceil(services.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader title="Hizmetler" description="Windows hizmetleri ve systemd birimleri; izlenecek hizmetleri seçin, gerekirse yetkiyle yönetin." />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">İzlenen hizmetler</CardTitle>
          <CardDescription>Tüm sunucularda izlemeye alınmış hizmetler. Bunlar durursa kritik olay açılır.</CardDescription>
        </CardHeader>
        <CardContent>
          {monitored.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : monitored.isError ? (
            <p className="text-sm text-muted-foreground">{errorMessage(monitored.error)}</p>
          ) : monitored.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Henüz izlenen hizmet yok. Aşağıdaki listeden hizmetleri izlemeye alın.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {monitored.data.map((s) => (
                <button key={s.id} type="button" onClick={() => setServerId(s.serverId)} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-muted">
                  <span className={cn('size-2 rounded-full', STATE_COLOR[s.state])} aria-hidden />
                  <span className="font-medium">{s.displayName || s.name}</span>
                  <span className="text-xs text-muted-foreground">{s.server?.name}</span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {servers.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : servers.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(servers.error)}</AlertDescription>
        </Alert>
      ) : !selected ? (
        <EmptyState icon={Boxes} title="Sunucu yok" description="Hizmetler, kayıtlı sunucuların ajanları tarafından raporlanır." action={<Button asChild><Link href="/sunucular/ekle">Sunucu ekle</Link></Button>} />
      ) : (
        <div className="space-y-4">
          <form onSubmit={onSearch} className="grid gap-2 sm:grid-cols-[260px_1fr_180px_auto_auto] sm:items-center">
            <Select
              value={selected.id}
              onValueChange={(v) => {
                setServerId(v);
                setPage(1);
              }}
            >
              <SelectTrigger aria-label="Sunucu seç" className="w-full">
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
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Hizmet adı ara…" className="pl-8" aria-label="Hizmet ara" />
            </div>
            <Select
              value={state}
              onValueChange={(v) => {
                setState(v);
                setPage(1);
              }}
            >
              <SelectTrigger aria-label="Durum filtresi" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tüm durumlar</SelectItem>
                <SelectItem value="RUNNING">Çalışıyor</SelectItem>
                <SelectItem value="STOPPED">Durduruldu</SelectItem>
                <SelectItem value="FAILED">Başarısız</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm whitespace-nowrap">
              <Switch
                checked={onlyMonitored}
                onCheckedChange={(v) => {
                  setOnlyMonitored(v);
                  setPage(1);
                }}
              />{' '}
              Yalnızca izlenenler
            </label>
            <Button type="submit" variant="outline">
              Ara
            </Button>
          </form>

          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <ServerStatusBadge status={selected.status} />
            {services.data && (
              <span>
                {services.data.total} hizmet · {services.data.summary.RUNNING ?? 0} çalışıyor · {services.data.summary.STOPPED ?? 0} durmuş · {services.data.summary.FAILED ?? 0} başarısız
              </span>
            )}
            {selected.agent?.status !== 'CONNECTED' && <Badge variant="outline">Ajan bağlı değil; liste güncellenmiyor olabilir</Badge>}
          </div>

          {services.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : services.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(services.error)}</AlertDescription>
            </Alert>
          ) : services.data.items.length === 0 ? (
            <EmptyState icon={Boxes} title="Hizmet bulunamadı" description={services.data.total === 0 && !submitted && state === ALL && !onlyMonitored ? 'Ajan henüz hizmet listesi göndermedi (ilk rapor bağlantıdan birkaç saniye sonra gelir).' : 'Filtreyle eşleşen hizmet yok.'} />
          ) : (
            <div className="rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>İzle</TableHead>
                    <TableHead>Hizmet</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead>Başlangıç</TableHead>
                    <TableHead>Son değişim</TableHead>
                    {canControl && <TableHead className="text-right">Yönet</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {services.data.items.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Switch checked={s.isMonitored} disabled={!canManage || toggle.isPending} aria-label={`${s.displayName || s.name} hizmetini izle`} onCheckedChange={(isMonitored) => toggle.mutate({ service: s, isMonitored })} />
                      </TableCell>
                      <TableCell>
                        <span className="block text-sm font-medium">{s.displayName || s.name}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{s.name}</span>
                      </TableCell>
                      <TableCell>
                        <StateBadge state={s.state} label={s.stateLabel} />
                      </TableCell>
                      <TableCell className="text-sm">{s.startupType ?? '—'}</TableCell>
                      <TableCell className="text-sm" title={formatDateTime(s.lastStateChangeAt)}>
                        {formatRelative(s.lastStateChangeAt)}
                      </TableCell>
                      {canControl && (
                        <TableCell className="text-right">
                          <span className="inline-flex gap-1">
                            {s.state !== 'RUNNING' && (
                              <Button variant="ghost" size="icon-sm" aria-label="Başlat" title="Başlat" onClick={() => setConfirm({ service: s, action: 'start' })}>
                                <Play />
                              </Button>
                            )}
                            {s.state === 'RUNNING' && (
                              <>
                                <Button variant="ghost" size="icon-sm" aria-label="Yeniden başlat" title="Yeniden başlat" onClick={() => setConfirm({ service: s, action: 'restart' })}>
                                  <RotateCw />
                                </Button>
                                <Button variant="ghost" size="icon-sm" aria-label="Durdur" title="Durdur" onClick={() => setConfirm({ service: s, action: 'stop' })}>
                                  <Square />
                                </Button>
                              </>
                            )}
                          </span>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {services.data && services.data.total > PAGE_SIZE && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Sayfa {page}/{totalPages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Önceki
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Sonraki
                </Button>
              </div>
            </div>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Komut geçmişi</CardTitle>
              <CardDescription>Bu sunucuya gönderilen hizmet komutları ve ajanın bildirdiği sonuçlar.</CardDescription>
            </CardHeader>
            <CardContent>
              {commands.isPending ? (
                <Skeleton className="h-12 w-full" />
              ) : !commands.data || commands.data.length === 0 ? (
                <p className="text-sm text-muted-foreground">Henüz komut gönderilmedi.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Zaman</TableHead>
                      <TableHead>Komut</TableHead>
                      <TableHead>İsteyen</TableHead>
                      <TableHead>Durum</TableHead>
                      <TableHead>Sonuç</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {commands.data.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm">{formatDateTime(c.createdAt)}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {c.type} · {c.payload.serviceName}
                        </TableCell>
                        <TableCell className="text-sm">{c.requestedBy ?? '—'}</TableCell>
                        <TableCell className={cn('text-sm', c.status === 'SUCCEEDED' ? 'text-status-ok' : c.status === 'FAILED' || c.status === 'EXPIRED' ? 'text-status-error' : 'text-muted-foreground')}>{COMMAND_STATUS_LABELS[c.status]}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.result ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm ? `${ACTION_LABELS[confirm.action]}: ${confirm.service.displayName || confirm.service.name}` : ''}</DialogTitle>
            <DialogDescription>
              Komut ajana bir sonraki heartbeat ile iletilir ve sunucuda yönetici yetkisiyle uygulanır. Bu işlem işlem kayıtlarına yazılır.
              {confirm?.action === 'stop' && ' Hizmeti durdurmak ona bağlı uygulamaları etkileyebilir.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Vazgeç
            </Button>
            <Button variant={confirm?.action === 'stop' ? 'destructive' : 'default'} disabled={control.isPending} onClick={() => confirm && control.mutate(confirm)}>
              {confirm ? ACTION_LABELS[confirm.action] : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
