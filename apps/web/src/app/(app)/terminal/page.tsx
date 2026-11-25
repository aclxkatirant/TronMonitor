'use client';

import dynamic from 'next/dynamic';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { KeyRound, Plug, PlugZap, TerminalSquare } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { ServerStatusBadge } from '@/components/app/status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CredentialDialog } from '@/components/terminal/credential-dialog';
import type { TerminalEvent, TerminalTarget } from '@/components/terminal/terminal-view';
import { hasPermission, useMe } from '@/hooks/use-auth';
import { useInvalidate } from '@/hooks/use-operations';
import { useServerCredential, useTerminalCommands, useTerminalServers, useTerminalSessions } from '@/hooks/use-terminal';
import { api, errorMessage } from '@/lib/api';
import { elapsedSeconds, formatDateTime, formatDuration } from '@/lib/format';
import { OS_FAMILY_LABELS, type TerminalServerItem, type TerminalSessionItem, type TerminalSessionStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

const TerminalView = dynamic(() => import('@/components/terminal/terminal-view').then((m) => m.TerminalView), { ssr: false, loading: () => <Skeleton className="h-[360px] w-full" /> });

const PAGE_SIZE = 20;
const STATUS_CLASS: Record<TerminalSessionStatus, string> = { CONNECTING: 'text-status-warn', ACTIVE: 'text-status-ok', CLOSED: 'text-muted-foreground', FAILED: 'text-status-error', TIMED_OUT: 'text-status-warn', TERMINATED: 'text-status-warn' };
type Protocol = 'SSH' | 'AGENT';
type ConnState = { phase: 'idle' } | { phase: 'connecting'; message: string } | { phase: 'ready'; sessionId: string; protocol: string } | { phase: 'ended'; message: string; failed: boolean };

function methodLabel(m: Protocol): string {
  return m === 'SSH' ? 'SSH' : 'Ajan kabuğu';
}

export default function TerminalPage() {
  const me = useMe();
  const canCredentials = hasPermission(me.data, 'terminal.credentials');
  const canSeeAll = hasPermission(me.data, 'audit.read');
  const servers = useTerminalServers();
  const [serverId, setServerId] = useState<string | null>(null);
  const [protocol, setProtocol] = useState<Protocol | null>(null);
  const [target, setTarget] = useState<TerminalTarget | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [conn, setConn] = useState<ConnState>({ phase: 'idle' });
  const [credentialFor, setCredentialFor] = useState<TerminalServerItem | null>(null);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const invalidate = useInvalidate([['terminal']]);

  const items = servers.data ?? [];
  const selected = items.find((s) => s.id === serverId) ?? null;
  const methods = selected?.methods ?? [];
  const effectiveProtocol: Protocol | null = protocol && methods.includes(protocol) ? protocol : (methods[0] ?? null);
  const connected = conn.phase === 'ready' || conn.phase === 'connecting';
  const credential = useServerCredential(credentialFor?.id ?? null, canCredentials);
  const sessions = useTerminalSessions({ page, pageSize: PAGE_SIZE });
  const commands = useTerminalCommands(expanded);

  const terminate = useMutation({
    mutationFn: (id: string) => api.post<void>(`/terminal/sessions/${id}/terminate`),
    onSuccess: async () => {
      toast.success('Oturum sonlandırıldı.');
      await invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function connect() {
    if (!selected || !effectiveProtocol) return;
    const key = attempt + 1;
    setAttempt(key);
    setTarget({ key, serverId: selected.id, protocol: effectiveProtocol });
  }

  function disconnect() {
    setTarget(null);
    setConn({ phase: 'ended', message: 'Bağlantı kapatıldı.', failed: false });
    void invalidate();
  }

  function onEvent(event: TerminalEvent) {
    switch (event.type) {
      case 'connecting':
        setConn({ phase: 'connecting', message: event.message });
        break;
      case 'ready':
        setConn({ phase: 'ready', sessionId: event.sessionId, protocol: event.protocol });
        void invalidate();
        break;
      case 'error':
        setConn({ phase: 'ended', message: event.message, failed: true });
        setTarget(null);
        void invalidate();
        break;
      case 'exit':
        setConn({ phase: 'ended', message: `${event.statusLabel}${event.reason ? `: ${event.reason}` : ''}`, failed: event.status === 'FAILED' });
        setTarget(null);
        void invalidate();
        break;
      case 'disconnected':
        setConn({ phase: 'ended', message: 'Bağlantı kapandı.', failed: false });
        setTarget(null);
        void invalidate();
        break;
    }
  }

  const totalPages = sessions.data ? Math.max(1, Math.ceil(sessions.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader title="Terminal" description="Linux sunuculara SSH ile, ajan kurulu sunuculara ajan üzerinden (Windows'ta PowerShell) tarayıcıdan kabuk erişimi. Yazılan komutlar işlem kaydına yazılır." />

      {servers.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : servers.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(servers.error)}</AlertDescription>
        </Alert>
      ) : items.length === 0 ? (
        <EmptyState icon={TerminalSquare} title="Sunucu yok" description="Terminal açmak için önce bir sunucu kaydedin." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <Card className="self-start">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Sunucular</CardTitle>
              <CardDescription>Yöntemi olan sunucular bağlanabilir.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {items.map((s) => (
                <div key={s.id} className={cn('flex items-center gap-2 rounded-md border px-2 py-1.5', serverId === s.id ? 'border-primary/60 bg-muted/60' : 'border-transparent hover:bg-muted/40')}>
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    disabled={connected}
                    onClick={() => {
                      setServerId(s.id);
                      setProtocol(null);
                    }}
                  >
                    <span className="block truncate text-sm font-medium">{s.name}</span>
                    <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      {OS_FAMILY_LABELS[s.osFamily]}
                      {s.methods.length === 0 ? (
                        <Badge variant="outline" className="text-[10px]">
                          Yöntem yok
                        </Badge>
                      ) : (
                        s.methods.map((m) => (
                          <Badge key={m} variant="secondary" className="text-[10px]">
                            {methodLabel(m)}
                          </Badge>
                        ))
                      )}
                      {s.activeSessions > 0 && <span className="text-status-ok">{s.activeSessions} etkin</span>}
                    </span>
                  </button>
                  {canCredentials && (
                    <Button variant="ghost" size="icon-sm" aria-label={`${s.name} SSH kimlik bilgisi`} title="SSH kimlik bilgisi" onClick={() => setCredentialFor(s)}>
                      <KeyRound />
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="flex min-h-[520px] flex-col">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {selected ? selected.name : 'Sunucu seçilmedi'}
                    {selected && <ServerStatusBadge status={selected.status} />}
                  </CardTitle>
                  <CardDescription>
                    {conn.phase === 'idle' && (selected ? (methods.length === 0 ? 'Bu sunucu için yöntem yok: SSH kimlik bilgisi tanımlayın veya ajanın bağlı olduğundan emin olun.' : 'Bağlanmak için yöntemi seçip Bağlan düğmesine basın.') : 'Soldan bir sunucu seçin.')}
                    {conn.phase === 'connecting' && conn.message}
                    {conn.phase === 'ready' && `Bağlı · ${conn.protocol === 'SSH' ? 'SSH' : 'Ajan kabuğu'} · oturum ${conn.sessionId.slice(0, 8)}`}
                    {conn.phase === 'ended' && <span className={conn.failed ? 'text-status-error' : undefined}>{conn.message}</span>}
                  </CardDescription>
                </div>
                {selected && methods.length > 1 && !connected && (
                  <Select value={effectiveProtocol ?? undefined} onValueChange={(v) => setProtocol(v as Protocol)}>
                    <SelectTrigger aria-label="Bağlantı yöntemi" className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {methods.map((m) => (
                        <SelectItem key={m} value={m}>
                          {methodLabel(m)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {connected ? (
                  <Button variant="destructive" onClick={disconnect}>
                    <PlugZap /> Bağlantıyı kes
                  </Button>
                ) : (
                  <Button onClick={connect} disabled={!selected || !effectiveProtocol}>
                    <Plug /> Bağlan
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex-1">
              <TerminalView target={target} onEvent={onEvent} />
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Oturum geçmişi</CardTitle>
          <CardDescription>{canSeeAll ? 'Tüm kullanıcıların terminal oturumları.' : 'Kendi terminal oturumlarınız.'} Satıra tıklayınca yazılan komutlar görünür.</CardDescription>
        </CardHeader>
        <CardContent>
          {sessions.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : sessions.isError ? (
            <p className="text-sm text-muted-foreground">{errorMessage(sessions.error)}</p>
          ) : sessions.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Henüz terminal oturumu yok.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Başlangıç</TableHead>
                    <TableHead>Sunucu</TableHead>
                    {canSeeAll && <TableHead>Kullanıcı</TableHead>}
                    <TableHead>Yöntem</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead>Süre</TableHead>
                    <TableHead>Komut</TableHead>
                    <TableHead className="text-right">İşlem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.data.items.map((s: TerminalSessionItem) => (
                    <TableRow key={s.id} className="cursor-pointer" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                      <TableCell className="text-sm whitespace-nowrap">{formatDateTime(s.startedAt)}</TableCell>
                      <TableCell className="text-sm">
                        {s.server.name}
                        {expanded === s.id && (
                          <div className="mt-2 max-w-xl rounded bg-muted/40 p-2 text-xs" onClick={(e) => e.stopPropagation()}>
                            {commands.isPending ? (
                              'Yükleniyor…'
                            ) : !commands.data || commands.data.length === 0 ? (
                              <span className="text-muted-foreground">Kayıtlı komut yok.</span>
                            ) : (
                              <ol className="space-y-0.5 font-mono">
                                {commands.data.map((c) => (
                                  <li key={c.id} className="flex gap-2">
                                    <span className="shrink-0 text-muted-foreground">{formatDateTime(c.executedAt).slice(-8)}</span>
                                    <span className="break-all">{c.command}</span>
                                  </li>
                                ))}
                              </ol>
                            )}
                            {s.endReason && <p className="mt-2 text-muted-foreground">Kapanış: {s.endReason}</p>}
                          </div>
                        )}
                      </TableCell>
                      {canSeeAll && (
                        <TableCell className="text-sm">
                          {s.user.fullName}
                          <span className="block text-xs text-muted-foreground">{s.user.email}</span>
                        </TableCell>
                      )}
                      <TableCell className="text-sm">{s.protocolLabel}</TableCell>
                      <TableCell className={cn('text-sm', STATUS_CLASS[s.status])}>{s.statusLabel}</TableCell>
                      <TableCell className="text-sm tabular-nums">{formatDuration(elapsedSeconds(s.startedAt, s.endedAt))}</TableCell>
                      <TableCell className="text-sm tabular-nums">{s.commandCount}</TableCell>
                      <TableCell className="text-right">
                        {s.isLive && (s.user.id === me.data?.id || canCredentials) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={terminate.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              terminate.mutate(s.id);
                            }}
                          >
                            Sonlandır
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {sessions.data.total > PAGE_SIZE && (
                <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    Toplam {sessions.data.total} oturum · Sayfa {page}/{totalPages}
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
            </>
          )}
        </CardContent>
      </Card>

      {credentialFor && !credential.isPending && <CredentialDialog key={`${credentialFor.id}-${credential.data?.updatedAt ?? 'new'}`} server={credentialFor} existing={credential.data ?? null} open onOpenChange={(open) => !open && setCredentialFor(null)} />}
    </div>
  );
}
