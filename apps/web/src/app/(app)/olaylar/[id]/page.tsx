'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Check, MessageSquarePlus, UserCheck } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { IncidentStatusBadge, SeverityBadge } from '@/components/app/severity';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { hasPermission, useMe } from '@/hooks/use-auth';
import { useIncident, useInvalidate } from '@/hooks/use-operations';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatDuration } from '@/lib/format';
import type { IncidentDetail } from '@/lib/types';

const KIND_LABELS: Record<string, string> = { CREATED: 'Açıldı', ACKNOWLEDGED: 'Üstlenildi', RESOLVED: 'Çözüldü', NOTE: 'Not', NOTIFIED: 'Bildirim' };
const DELIVERY_LABELS = { PENDING: 'Bekliyor', SENT: 'Gönderildi', FAILED: 'Başarısız' } as const;

export default function IncidentDetailPage() {
  const params = useParams<{ id: string }>();
  const me = useMe();
  const canManage = hasPermission(me.data, 'incidents.manage');
  const incident = useIncident(params.id);
  const invalidate = useInvalidate([['incidents'], ['dashboard']]);
  const [note, setNote] = useState('');

  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body: { note?: string } }) => api.post<IncidentDetail>(`/incidents/${params.id}/${path}`, body),
    onSuccess: async (_data, variables) => {
      toast.success(variables.path === 'acknowledge' ? 'Olay üstlenildi.' : variables.path === 'resolve' ? 'Olay çözüldü.' : 'Not eklendi.');
      setNote('');
      await invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (incident.isPending) return <Skeleton className="h-96 w-full" />;
  if (incident.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(incident.error)}</AlertDescription>
      </Alert>
    );
  }
  const i = incident.data;
  const active = i.status !== 'RESOLVED';

  function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!note.trim()) return;
    action.mutate({ path: 'notes', body: { note: note.trim() } });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={i.title}
        description={i.typeLabel}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/olaylar">
                <ArrowLeft /> Olaylar
              </Link>
            </Button>
            {canManage && active && i.status === 'OPEN' && (
              <Button variant="outline" size="sm" onClick={() => action.mutate({ path: 'acknowledge', body: { note: note.trim() || undefined } })} disabled={action.isPending}>
                <UserCheck /> Üstlen
              </Button>
            )}
            {canManage && active && (
              <Button size="sm" onClick={() => action.mutate({ path: 'resolve', body: { note: note.trim() || undefined } })} disabled={action.isPending}>
                <Check /> Çözüldü olarak işaretle
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <SeverityBadge severity={i.severity} />
        <IncidentStatusBadge status={i.status} />
        {i.server && (
          <Link href={`/sunucular/${i.server.id}`} className="hover:underline">
            <Badge variant="secondary">Sunucu: {i.server.name}</Badge>
          </Link>
        )}
        {i.check && (
          <Link href={`/erisilebilirlik/${i.check.id}`} className="hover:underline">
            <Badge variant="secondary">Kontrol: {i.check.name}</Badge>
          </Link>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Açıklama</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>{i.description ?? '—'}</p>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Başlangıç</dt>
                <dd>{formatDateTime(i.startedAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Süre</dt>
                <dd>{formatDuration(i.durationSeconds)}{active ? ' (devam ediyor)' : ''}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Üstlenen</dt>
                <dd>{i.acknowledgedBy ? `${i.acknowledgedBy} · ${formatDateTime(i.acknowledgedAt)}` : '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Çözüm</dt>
                <dd>{i.resolvedAt ? `${i.resolvedBy ?? 'Sistem'} · ${formatDateTime(i.resolvedAt)}` : '—'}</dd>
              </div>
              {i.resolutionNote && (
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Çözüm notu</dt>
                  <dd>{i.resolutionNote}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bildirimler</CardTitle>
            <CardDescription>Bu olay için kanal gönderimleri</CardDescription>
          </CardHeader>
          <CardContent>
            {i.notifications.length === 0 ? (
              <p className="text-sm text-muted-foreground">Bildirim gönderilmedi (eşleşen etkin kanal yok).</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {i.notifications.map((n) => (
                  <li key={n.id} className="flex items-start justify-between gap-2">
                    <span>
                      <span className="block font-medium">{n.channelName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {n.eventType} · {n.attempts} deneme{n.lastError ? ` · ${n.lastError}` : ''}
                      </span>
                    </span>
                    <span className={n.status === 'SENT' ? 'text-status-ok' : n.status === 'FAILED' ? 'text-status-error' : 'text-muted-foreground'}>{DELIVERY_LABELS[n.status]}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Zaman çizelgesi</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="space-y-3 border-l border-border pl-4">
            {i.events.map((e) => (
              <li key={e.id} className="relative text-sm">
                <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card bg-muted-foreground" aria-hidden />
                <span className="block text-xs text-muted-foreground">
                  {formatDateTime(e.createdAt)} · {KIND_LABELS[e.kind] ?? e.kind}
                  {e.userName ? ` · ${e.userName}` : ''}
                </span>
                <span className="block">{e.message}</span>
              </li>
            ))}
          </ol>
          {canManage && (
            <form onSubmit={submitNote} className="flex gap-2">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Not ekleyin (üstlenme/çözme sırasında da kullanılır)" maxLength={2000} />
              <Button type="submit" variant="outline" disabled={!note.trim() || action.isPending}>
                <MessageSquarePlus /> Not ekle
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
