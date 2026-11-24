'use client';

import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Bell, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
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
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { hasPermission, useMe } from '@/hooks/use-auth';
import { useChannels, useInvalidate, useNotificationCatalog, useRecentNotifications } from '@/hooks/use-operations';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { NotificationCatalog, NotificationChannel, NotificationChannelType } from '@/lib/types';

const TYPE_LABELS: Record<NotificationChannelType, string> = { DISCORD: 'Discord', TELEGRAM: 'Telegram', EMAIL: 'E-posta' };
const DEFAULT_EVENTS = ['AGENT_DISCONNECTED', 'AGENT_RECOVERED', 'CHECK_DOWN', 'CHECK_RECOVERED', 'LOW_DISK', 'SSL_EXPIRING'];

interface ConfigState {
  webhookUrl: string;
  username: string;
  botToken: string;
  chatId: string;
  host: string;
  port: string;
  secure: boolean;
  smtpUser: string;
  password: string;
  from: string;
  to: string;
}

function initialConfig(channel: NotificationChannel | null): ConfigState {
  const c = (channel?.config ?? {}) as Record<string, unknown>;
  return {
    webhookUrl: '',
    username: typeof c.username === 'string' ? c.username : '',
    botToken: '',
    chatId: typeof c.chatId === 'string' ? c.chatId : '',
    host: typeof c.host === 'string' ? c.host : '',
    port: c.port !== undefined ? String(c.port) : '587',
    secure: c.secure === true,
    smtpUser: typeof c.username === 'string' ? c.username : '',
    password: '',
    from: typeof c.from === 'string' ? c.from : '',
    to: Array.isArray(c.to) ? (c.to as string[]).join(', ') : '',
  };
}

function ChannelDialog({ open, onOpenChange, channel, catalog }: { open: boolean; onOpenChange: (open: boolean) => void; channel: NotificationChannel | null; catalog: NotificationCatalog }) {
  const isEdit = channel !== null;
  const [name, setName] = useState(channel?.name ?? '');
  const [type, setType] = useState<NotificationChannelType>(channel?.type ?? 'DISCORD');
  const [events, setEvents] = useState<string[]>(channel?.enabledEvents ?? DEFAULT_EVENTS);
  const [isEnabled, setIsEnabled] = useState(channel?.isEnabled ?? true);
  const [cfg, setCfg] = useState<ConfigState>(() => initialConfig(channel));
  const invalidate = useInvalidate([['notifications']]);
  const masked = (channel?.config ?? {}) as Record<string, string>;

  const mutation = useMutation({
    mutationFn: () => {
      const config: Record<string, unknown> =
        type === 'DISCORD'
          ? { webhookUrl: cfg.webhookUrl.trim(), username: cfg.username.trim() }
          : type === 'TELEGRAM'
            ? { botToken: cfg.botToken.trim(), chatId: cfg.chatId.trim() }
            : { host: cfg.host.trim(), port: Number(cfg.port), secure: cfg.secure, username: cfg.smtpUser.trim(), password: cfg.password, from: cfg.from.trim(), to: cfg.to.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean) };
      const payload = { name: name.trim(), enabledEvents: events, isEnabled, config };
      return isEdit ? api.patch<NotificationChannel>(`/notification-channels/${channel.id}`, payload) : api.post<NotificationChannel>('/notification-channels', { ...payload, type });
    },
    onSuccess: async () => {
      toast.success(isEdit ? 'Kanal güncellendi.' : 'Kanal oluşturuldu. "Test gönder" ile doğrulayın.');
      await invalidate();
      onOpenChange(false);
    },
  });

  function set<K extends keyof ConfigState>(key: K, value: ConfigState[K]) {
    setCfg((c) => ({ ...c, [key]: value }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  const secretHint = isEdit ? 'Değiştirmek istemiyorsanız boş bırakın.' : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Kanalı düzenle' : 'Yeni bildirim kanalı'}</DialogTitle>
            <DialogDescription>Sırlar sunucuda şifrelenerek saklanır ve bir daha gösterilmez.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <div className="space-y-1.5">
              <Label htmlFor="n-name">Kanal adı</Label>
              <Input id="n-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="ör. Ops Discord" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="n-type">Tür</Label>
              <Select value={type} onValueChange={(v) => setType(v as NotificationChannelType)} disabled={isEdit}>
                <SelectTrigger id="n-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {catalog.types.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {type === 'DISCORD' && (
            <div className="grid gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="n-webhook">Webhook adresi</Label>
                <Input id="n-webhook" type="url" value={cfg.webhookUrl} onChange={(e) => set('webhookUrl', e.target.value)} placeholder={masked.webhookUrl || 'https://discord.com/api/webhooks/…'} required={!isEdit} />
                <p className="text-xs text-muted-foreground">Sunucu ayarları → Entegrasyonlar → Webhook&apos;lar. {secretHint}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="n-username">Gönderen adı (isteğe bağlı)</Label>
                <Input id="n-username" value={cfg.username} onChange={(e) => set('username', e.target.value)} placeholder="TronMonitor" />
              </div>
            </div>
          )}

          {type === 'TELEGRAM' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="n-token">Bot belirteci</Label>
                <Input id="n-token" value={cfg.botToken} onChange={(e) => set('botToken', e.target.value)} placeholder={masked.botToken || '123456:ABC…'} required={!isEdit} />
                <p className="text-xs text-muted-foreground">@BotFather ile alınır. {secretHint}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="n-chat">Sohbet kimliği</Label>
                <Input id="n-chat" value={cfg.chatId} onChange={(e) => set('chatId', e.target.value)} placeholder="-1001234567890" required />
              </div>
            </div>
          )}

          {type === 'EMAIL' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="n-host">SMTP sunucusu</Label>
                <Input id="n-host" value={cfg.host} onChange={(e) => set('host', e.target.value)} placeholder="smtp.ornek.com" required />
              </div>
              <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="n-port">Port</Label>
                  <Input id="n-port" type="number" min={1} max={65535} value={cfg.port} onChange={(e) => set('port', e.target.value)} required />
                </div>
                <label className="flex h-8 items-center gap-2 text-sm">
                  <Switch checked={cfg.secure} onCheckedChange={(v) => set('secure', v)} /> TLS (465)
                </label>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="n-user">Kullanıcı adı</Label>
                <Input id="n-user" value={cfg.smtpUser} onChange={(e) => set('smtpUser', e.target.value)} autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="n-pass">Parola</Label>
                <Input id="n-pass" type="password" value={cfg.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" placeholder={masked.password ? '••••••••' : ''} />
                {secretHint && <p className="text-xs text-muted-foreground">{secretHint}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="n-from">Gönderen</Label>
                <Input id="n-from" type="email" value={cfg.from} onChange={(e) => set('from', e.target.value)} placeholder="tronmonitor@ornek.com" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="n-to">Alıcılar (virgülle)</Label>
                <Input id="n-to" value={cfg.to} onChange={(e) => set('to', e.target.value)} placeholder="ops@ornek.com, nobetci@ornek.com" required />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Bildirim gönderilecek olaylar</Label>
            <div className="grid max-h-48 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
              {catalog.events.map((e) => (
                <label key={e.key} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
                  <Checkbox checked={events.includes(e.key)} aria-label={e.label} onCheckedChange={(next) => setEvents(next === true ? [...events, e.key] : events.filter((k) => k !== e.key))} />
                  {e.label}
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} /> Kanal etkin
          </label>

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
              {mutation.isPending ? 'Kaydediliyor…' : isEdit ? 'Kaydet' : 'Oluştur'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function NotificationsPage() {
  const me = useMe();
  const canManage = hasPermission(me.data, 'notifications.manage');
  const channels = useChannels();
  const catalog = useNotificationCatalog();
  const recent = useRecentNotifications();
  const invalidate = useInvalidate([['notifications']]);
  const [dialog, setDialog] = useState<{ open: boolean; channel: NotificationChannel | null; key: number }>({ open: false, channel: null, key: 0 });

  const test = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; error?: string }>(`/notification-channels/${id}/test`),
    onSuccess: async (r) => {
      toast[r.ok ? 'success' : 'error'](r.ok ? 'Test bildirimi gönderildi.' : `Test başarısız: ${r.error ?? 'bilinmiyor'}`);
      await invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/notification-channels/${id}`),
    onSuccess: async () => {
      toast.success('Kanal silindi.');
      await invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) => api.patch<NotificationChannel>(`/notification-channels/${id}`, { isEnabled }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const eventLabel = (key: string) => catalog.data?.events.find((e) => e.key === key)?.label ?? key;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bildirimler"
        description="Olaylar açıldığında ve çözüldüğünde Discord, Telegram veya e-posta ile haber verin."
        actions={
          canManage && catalog.data ? (
            <Button onClick={() => setDialog((d) => ({ open: true, channel: null, key: d.key + 1 }))}>
              <Plus /> Kanal ekle
            </Button>
          ) : undefined
        }
      />

      {channels.isPending || catalog.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : channels.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(channels.error)}</AlertDescription>
        </Alert>
      ) : channels.data.length === 0 ? (
        <EmptyState icon={Bell} title="Henüz bildirim kanalı yok" description="Bir Discord webhook'u, Telegram botu veya SMTP sunucusu ekleyin; olaylar anında iletilsin." action={canManage ? <Button onClick={() => setDialog((d) => ({ open: true, channel: null, key: d.key + 1 }))}>Kanal ekle</Button> : undefined} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {channels.data.map((c) => (
            <Card key={c.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="flex items-center gap-2">
                    {c.name}
                    <Badge variant="secondary">{TYPE_LABELS[c.type]}</Badge>
                    {!c.isEnabled && <Badge variant="outline">Devre dışı</Badge>}
                  </span>
                  {canManage && <Switch checked={c.isEnabled} aria-label="Kanalı etkinleştir" onCheckedChange={(isEnabled) => toggle.mutate({ id: c.id, isEnabled })} />}
                </CardTitle>
                <CardDescription>
                  {c.type === 'DISCORD' && `Webhook: ${String(c.config?.webhookUrl ?? '—')}`}
                  {c.type === 'TELEGRAM' && `Sohbet: ${String(c.config?.chatId ?? '—')}`}
                  {c.type === 'EMAIL' && `${String(c.config?.host ?? '')}:${String(c.config?.port ?? '')} → ${Array.isArray(c.config?.to) ? (c.config.to as string[]).join(', ') : '—'}`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1">
                  {c.enabledEvents.length === 0 ? <span className="text-xs text-muted-foreground">Hiçbir olay seçilmemiş</span> : c.enabledEvents.map((e) => <Badge key={e} variant="outline">{eventLabel(e)}</Badge>)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Son test: {c.lastTestedAt ? `${formatRelative(c.lastTestedAt)} · ${c.lastTestResult ?? ''}` : 'yapılmadı'}
                </p>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => test.mutate(c.id)} disabled={test.isPending}>
                      <Send /> Test gönder
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setDialog((d) => ({ open: true, channel: c, key: d.key + 1 }))}>
                      <Pencil /> Düzenle
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove.mutate(c.id)} disabled={remove.isPending}>
                      <Trash2 /> Sil
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Son gönderimler</CardTitle>
          <CardDescription>Kuyruğa alınan bildirimler ve teslim durumu (başarısız gönderimler 5 kez yeniden denenir).</CardDescription>
        </CardHeader>
        <CardContent>
          {recent.isPending ? (
            <Skeleton className="h-20 w-full" />
          ) : recent.isError ? (
            <p className="text-sm text-muted-foreground">{errorMessage(recent.error)}</p>
          ) : recent.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Henüz bildirim gönderilmedi.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zaman</TableHead>
                  <TableHead>Kanal</TableHead>
                  <TableHead>Olay</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Ayrıntı</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.data.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="text-sm">{formatDateTime(n.createdAt)}</TableCell>
                    <TableCell className="text-sm">{n.channelName}</TableCell>
                    <TableCell className="text-sm">{n.eventLabel}</TableCell>
                    <TableCell className={n.status === 'SENT' ? 'text-sm text-status-ok' : n.status === 'FAILED' ? 'text-sm text-status-error' : 'text-sm text-muted-foreground'}>{n.status === 'SENT' ? 'Gönderildi' : n.status === 'FAILED' ? 'Başarısız' : 'Bekliyor'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{n.lastError ?? (n.incident ? n.incident.title : '—')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {dialog.open && catalog.data && <ChannelDialog key={dialog.key} open={dialog.open} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} channel={dialog.channel} catalog={catalog.data} />}
    </div>
  );
}
