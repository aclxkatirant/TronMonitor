'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Ban, LineChart, Pencil, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { AgentStatusBadge, ColorDot, ServerStatusBadge, UsageMeter } from '@/components/app/status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { hasPermission, useMe } from '@/hooks/use-auth';
import { useGroups, useInvalidateServers, useServer, useServerEvents, useTags } from '@/hooks/use-servers';
import { api, errorMessage } from '@/lib/api';
import { formatBytes, formatDateTime, formatDuration, formatRate, formatRelative } from '@/lib/format';
import { AGENT_EVENT_LABELS, OS_FAMILY_LABELS, type ServerDetail } from '@/lib/types';

const NO_GROUP = '__none__';

function InfoRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border/60 py-2 last:border-0 sm:flex-row sm:items-baseline sm:justify-between">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-xs sm:text-right' : 'text-sm sm:text-right'}>{value ?? '—'}</dd>
    </div>
  );
}

function EditServerDialog({ server, open, onOpenChange }: { server: ServerDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const groups = useGroups();
  const tags = useTags();
  const invalidate = useInvalidateServers();
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description ?? '');
  const [groupId, setGroupId] = useState(server.group?.id ?? NO_GROUP);
  const [tagIds, setTagIds] = useState<string[]>(server.tags.map((t) => t.id));

  const mutation = useMutation({
    mutationFn: () =>
      api.patch<ServerDetail>(`/servers/${server.id}`, {
        name: name.trim(),
        description: description.trim() || null,
        groupId: groupId === NO_GROUP ? null : groupId,
        tagIds,
      }),
    onSuccess: async () => {
      toast.success('Sunucu güncellendi.');
      await invalidate(server.id);
      onOpenChange(false);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>Sunucuyu düzenle</DialogTitle>
            <DialogDescription>{server.hostname ?? server.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="s-name">Sunucu adı</Label>
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-desc">Açıklama</Label>
            <Input id="s-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} placeholder="ör. Müşteri portalı veritabanı" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-group">Grup</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger id="s-group" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GROUP}>Grup yok</SelectItem>
                {groups.data?.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Etiketler</Label>
            {tags.data && tags.data.length > 0 ? (
              <div className="flex flex-wrap gap-2 rounded-md border border-border p-2">
                {tags.data.map((t) => {
                  const checked = tagIds.includes(t.id);
                  return (
                    <label key={t.id} className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-sm hover:bg-muted">
                      <Checkbox checked={checked} aria-label={t.name} onCheckedChange={(next) => setTagIds(next === true ? [...tagIds, t.id] : tagIds.filter((id) => id !== t.id))} />
                      <ColorDot color={t.color} /> {t.name}
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Henüz etiket yok.{' '}
                <Link href="/sunucular/gruplar" className="underline">
                  Etiket oluşturun
                </Link>
                .
              </p>
            )}
          </div>
          {mutation.isError && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(mutation.error)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={mutation.isPending || !name.trim()}>
              {mutation.isPending ? 'Kaydediliyor…' : 'Kaydet'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, destructive, onConfirm, pending, error }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; confirmLabel: string; destructive?: boolean; onConfirm: () => void; pending: boolean; error?: unknown }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(error)}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button type="button" variant={destructive ? 'destructive' : 'default'} onClick={onConfirm} disabled={pending}>
            {pending ? 'İşleniyor…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentCard({ server, canManage }: { server: ServerDetail; canManage: boolean }) {
  const invalidate = useInvalidateServers();
  const [interval, setInterval] = useState(String(server.agent?.collectionIntervalSec ?? 15));
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [eventsPage, setEventsPage] = useState(1);
  const events = useServerEvents(server.id, eventsPage);

  const updateInterval = useMutation({
    mutationFn: () => api.patch<ServerDetail>(`/servers/${server.id}/agent`, { collectionIntervalSec: Number(interval) }),
    onSuccess: async () => {
      toast.success('Toplama aralığı güncellendi; ajan bir sonraki heartbeat ile uygular.');
      await invalidate(server.id);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const revoke = useMutation({
    mutationFn: () => api.post<ServerDetail>(`/servers/${server.id}/agent/revoke`),
    onSuccess: async () => {
      toast.success('Ajan erişimi iptal edildi.');
      setRevokeOpen(false);
      await invalidate(server.id);
    },
  });

  const agent = server.agent;
  if (!agent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ajan</CardTitle>
          <CardDescription>Bu sunucuya bağlı bir ajan yok.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const totalPages = events.data ? Math.max(1, Math.ceil(events.data.total / 25)) : 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          Ajan
          <AgentStatusBadge status={agent.status} />
        </CardTitle>
        <CardDescription>Bağlantı durumu, sürüm ve kimlik bilgisi.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl>
          <InfoRow label="Sürüm" value={agent.version} mono />
          <InfoRow label="Son bağlanma" value={formatDateTime(agent.lastConnectedAt)} />
          <InfoRow label="Son kopma" value={formatDateTime(agent.lastDisconnectedAt)} />
          <InfoRow label="Son IP adresi" value={agent.lastIpAddress} mono />
          <InfoRow label="Anahtar kimliği" value={agent.credential ? `${agent.credential.keyId.slice(0, 12)}…` : '—'} mono />
          <InfoRow label="Kimlik bilgisi" value={agent.credential ? (agent.credential.status === 'ACTIVE' ? `Etkin · son kullanım ${formatRelative(agent.credential.lastUsedAt)}` : `İptal edildi · ${formatDateTime(agent.credential.revokedAt)}`) : '—'} />
        </dl>

        {canManage && (
          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end sm:justify-between">
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                updateInterval.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="interval">Toplama aralığı (sn)</Label>
                <Input id="interval" type="number" min={5} max={3600} value={interval} onChange={(e) => setInterval(e.target.value)} className="w-32" />
              </div>
              <Button type="submit" variant="outline" disabled={updateInterval.isPending || Number(interval) === agent.collectionIntervalSec}>
                Uygula
              </Button>
            </form>
            <Button variant="destructive" onClick={() => setRevokeOpen(true)} disabled={agent.status === 'REVOKED'}>
              <Ban /> Ajan erişimini iptal et
            </Button>
          </div>
        )}

        <div className="border-t border-border pt-4">
          <p className="mb-2 text-sm font-medium">Bağlantı geçmişi</p>
          {events.isPending ? (
            <Skeleton className="h-20 w-full" />
          ) : events.isError ? (
            <p className="text-sm text-muted-foreground">{errorMessage(events.error)}</p>
          ) : events.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Henüz olay yok.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Olay</TableHead>
                    <TableHead>Zaman</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Sürüm</TableHead>
                    <TableHead>Ayrıntı</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.data.items.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-sm">{AGENT_EVENT_LABELS[e.type]}</TableCell>
                      <TableCell className="text-sm" title={e.createdAt}>
                        {formatDateTime(e.createdAt)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{e.ipAddress ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{e.agentVersion ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.detail ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {events.data.total > 25 && (
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Sayfa {eventsPage}/{totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="xs" disabled={eventsPage <= 1} onClick={() => setEventsPage((p) => p - 1)}>
                      Önceki
                    </Button>
                    <Button variant="outline" size="xs" disabled={eventsPage >= totalPages} onClick={() => setEventsPage((p) => p + 1)}>
                      Sonraki
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>

      <ConfirmDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title="Ajan erişimini iptal et"
        description="Ajanın kimlik bilgisi kalıcı olarak geçersiz olur; sunucu çevrimdışı görünür ve veri gönderemez. Yeniden izlemek için sunucuda yeni bir kayıt belirteciyle 'install --force' çalıştırılmalıdır."
        confirmLabel="İptal et"
        destructive
        onConfirm={() => revoke.mutate()}
        pending={revoke.isPending}
        error={revoke.error}
      />
    </Card>
  );
}

export default function ServerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const me = useMe();
  const canManage = hasPermission(me.data, 'servers.manage');
  const canManageAgent = hasPermission(me.data, 'agents.manage');
  const canDelete = hasPermission(me.data, 'servers.delete');
  const canReadMetrics = hasPermission(me.data, 'metrics.read');
  const server = useServer(params.id);
  const invalidate = useInvalidateServers();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const remove = useMutation({
    mutationFn: () => api.delete<void>(`/servers/${params.id}`),
    onSuccess: async () => {
      toast.success('Sunucu silindi.');
      await invalidate();
      router.replace('/sunucular');
    },
  });

  if (server.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (server.isError) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(server.error)}</AlertDescription>
        </Alert>
        <Button asChild variant="outline">
          <Link href="/sunucular">
            <ArrowLeft /> Sunuculara dön
          </Link>
        </Button>
      </div>
    );
  }

  const s = server.data;
  const live = s.status === 'ONLINE' || s.status === 'DEGRADED';
  const m = s.metrics;

  return (
    <div className="space-y-6">
      <PageHeader
        title={s.name}
        description={[s.hostname, s.description].filter(Boolean).join(' · ') || undefined}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/sunucular">
                <ArrowLeft /> Sunucular
              </Link>
            </Button>
            {canReadMetrics && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/sunucular/${s.id}/metrikler`}>
                  <LineChart /> Metrikler
                </Link>
              </Button>
            )}
            {canManage && (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil /> Düzenle
              </Button>
            )}
            {canDelete && (
              <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                <Trash2 /> Sil
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <ServerStatusBadge status={s.status} />
        <span className="text-muted-foreground">Son heartbeat: {formatRelative(s.lastHeartbeatAt)}</span>
        {s.group && (
          <Badge variant="secondary" className="gap-1">
            <ColorDot color={s.group.color} /> {s.group.name}
          </Badge>
        )}
        {s.tags.map((t) => (
          <Badge key={t.id} variant="outline" className="gap-1">
            <ColorDot color={t.color} /> {t.name}
          </Badge>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>CPU</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{live && m ? `%${Math.round(m.cpuPercent)}` : '—'}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <UsageMeter value={live ? m?.cpuPercent : null} />
            <p className="mt-2">
              {s.cpuModel ?? 'Model bilinmiyor'} · {s.cpuCores ?? '?'} çekirdek
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Bellek</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{live && m ? `%${Math.round(m.memoryPercent)}` : '—'}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <UsageMeter value={live ? m?.memoryPercent : null} />
            <p className="mt-2">{m ? `${formatBytes(m.memoryUsedBytes)} / ${formatBytes(m.memoryTotalBytes)}` : formatBytes(s.totalMemoryBytes)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Disk (toplam)</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{m?.diskUsedPercent != null ? `%${Math.round(m.diskUsedPercent)}` : '—'}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <UsageMeter value={m?.diskUsedPercent} />
            <p className="mt-2">{m ? `${formatBytes(m.diskUsedBytes)} / ${formatBytes(m.diskTotalBytes)}` : '—'}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sistem bilgisi</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <InfoRow label="Ana makine adı" value={s.hostname} mono />
              <InfoRow label="İşletim sistemi" value={`${OS_FAMILY_LABELS[s.osFamily]}${s.osName ? ` · ${s.osName}` : ''}`} />
              <InfoRow label="Sürüm" value={s.osVersion} mono />
              <InfoRow label="Sürüm türü" value={s.osEdition} />
              <InfoRow label="Çekirdek" value={s.kernelVersion} mono />
              <InfoRow label="Mimari" value={s.architecture} mono />
              <InfoRow label="Açık kalma süresi" value={live && m?.uptimeSeconds != null ? formatDuration(m.uptimeSeconds) : '—'} />
              <InfoRow label="Son açılış" value={formatDateTime(s.bootTime)} />
              <InfoRow label="Kayıt tarihi" value={formatDateTime(s.registeredAt)} />
              <InfoRow label="Son metrik" value={m ? formatRelative(m.timestamp) : '—'} />
            </dl>
          </CardContent>
        </Card>

        <AgentCard server={s} canManage={canManageAgent} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Disk hacimleri</CardTitle>
            <CardDescription>Son örnekteki kapasite ve G/Ç hızı.</CardDescription>
          </CardHeader>
          <CardContent>
            {s.disks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Henüz disk verisi yok.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hacim</TableHead>
                    <TableHead>Kullanım</TableHead>
                    <TableHead>Boş</TableHead>
                    <TableHead>Okuma</TableHead>
                    <TableHead>Yazma</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.disks.map((d) => (
                    <TableRow key={d.volume}>
                      <TableCell className="font-mono text-xs">{d.volume}</TableCell>
                      <TableCell>
                        <UsageMeter value={d.usedPercent} label={`${formatBytes(d.usedBytes)} / ${formatBytes(d.totalBytes)}`} />
                      </TableCell>
                      <TableCell className="text-sm">{formatBytes(d.freeBytes)}</TableCell>
                      <TableCell className="text-sm">{formatRate(d.readBps)}</TableCell>
                      <TableCell className="text-sm">{formatRate(d.writeBps)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ağ arayüzleri</CardTitle>
            <CardDescription>Son örnekteki anlık trafik.</CardDescription>
          </CardHeader>
          <CardContent>
            {s.network.length === 0 ? (
              <p className="text-sm text-muted-foreground">Henüz ağ verisi yok.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Arayüz</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead>Gelen</TableHead>
                    <TableHead>Giden</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.network.map((n) => (
                    <TableRow key={n.name}>
                      <TableCell className="text-sm">{n.name}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <span className={n.isUp ? 'size-2 rounded-full bg-status-ok' : 'size-2 rounded-full bg-status-neutral'} aria-hidden />
                          {n.isUp ? 'Açık' : 'Kapalı'}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">{formatRate(n.rxBps)}</TableCell>
                      <TableCell className="text-sm">{formatRate(n.txBps)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {editOpen && <EditServerDialog key={s.updatedAt} server={s} open={editOpen} onOpenChange={setEditOpen} />}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Sunucuyu sil"
        description={`"${s.name}" sunucusu, ajan kimlik bilgileri, tüm metrik geçmişi ve olayları kalıcı olarak silinir. Bu işlem geri alınamaz. Sunucudaki ajan hizmeti ayrıca kaldırılmalıdır.`}
        confirmLabel="Kalıcı olarak sil"
        destructive
        onConfirm={() => remove.mutate()}
        pending={remove.isPending}
        error={remove.error}
      />
    </div>
  );
}
