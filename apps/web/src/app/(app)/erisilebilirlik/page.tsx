'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Activity, Plus } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { CheckStatusBadge } from '@/components/app/severity';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { hasPermission, useMe } from '@/hooks/use-auth';
import { useChecks } from '@/hooks/use-operations';
import { errorMessage } from '@/lib/api';
import { daysUntil, formatPercent, formatRelative } from '@/lib/format';
import { CheckDialog } from './check-dialog';

export default function UptimePage() {
  const router = useRouter();
  const me = useMe();
  const canManage = hasPermission(me.data, 'uptime.manage');
  const checks = useChecks();
  const [dialog, setDialog] = useState<{ open: boolean; key: number }>({ open: false, key: 0 });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Erişilebilirlik"
        description="HTTP, HTTPS, TCP ve ICMP kontrolleri; SSL sertifika takibi."
        actions={
          canManage ? (
            <Button onClick={() => setDialog((d) => ({ open: true, key: d.key + 1 }))}>
              <Plus /> Kontrol ekle
            </Button>
          ) : undefined
        }
      />

      {checks.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : checks.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(checks.error)}</AlertDescription>
        </Alert>
      ) : checks.data.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="Henüz kontrol yok"
          description="Bir web adresi, port veya ana makine ekleyin; TronMonitor düzenli aralıklarla denetleyip kesintide olay açsın."
          action={canManage ? <Button onClick={() => setDialog((d) => ({ open: true, key: d.key + 1 }))}>Kontrol ekle</Button> : undefined}
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kontrol</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>Erişilebilirlik (24 sa)</TableHead>
                <TableHead>Yanıt</TableHead>
                <TableHead>Aralık</TableHead>
                <TableHead>Son denetim</TableHead>
                <TableHead>SSL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checks.data.map((c) => {
                const sslDays = daysUntil(c.sslExpiresAt);
                return (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/erisilebilirlik/${c.id}`)}>
                    <TableCell>
                      <Link href={`/erisilebilirlik/${c.id}`} className="block font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {c.name}
                      </Link>
                      <span className="block max-w-72 truncate font-mono text-xs text-muted-foreground" title={c.target}>
                        {c.typeLabel} · {c.target}
                        {c.port ? `:${c.port}` : ''}
                      </span>
                    </TableCell>
                    <TableCell>
                      {c.isEnabled ? <CheckStatusBadge status={c.status} /> : <Badge variant="outline">Devre dışı</Badge>}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">{formatPercent(c.uptime24h, 1)}</TableCell>
                    <TableCell className="text-sm tabular-nums">{c.lastResponseMs !== null ? `${c.lastResponseMs} ms` : '—'}</TableCell>
                    <TableCell className="text-sm">{c.intervalSec} sn</TableCell>
                    <TableCell className="text-sm" title={c.lastCheckedAt ?? undefined}>
                      {formatRelative(c.lastCheckedAt)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {sslDays === null ? '—' : sslDays < 0 ? <span className="text-status-error">Süresi doldu</span> : sslDays <= (c.sslExpiryWarnDays ?? 14) ? <span className="text-status-warn">{sslDays} gün</span> : `${sslDays} gün`}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {dialog.open && <CheckDialog key={dialog.key} open={dialog.open} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} check={null} />}
    </div>
  );
}
