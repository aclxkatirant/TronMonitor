'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { IncidentStatusBadge, SeverityBadge } from '@/components/app/severity';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useIncidentCatalog, useIncidents } from '@/hooks/use-operations';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatDuration, formatRelative } from '@/lib/format';

const ALL = '__all__';
const PAGE_SIZE = 25;

export default function IncidentsPage() {
  const router = useRouter();
  const catalog = useIncidentCatalog();
  const [status, setStatus] = useState('active');
  const [severity, setSeverity] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [page, setPage] = useState(1);
  const incidents = useIncidents({ status: status === ALL ? undefined : status, severity: severity === ALL ? undefined : severity, type: type === ALL ? undefined : type, page, pageSize: PAGE_SIZE });
  const totalPages = incidents.data ? Math.max(1, Math.ceil(incidents.data.total / PAGE_SIZE)) : 1;

  const setter = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Olaylar" description="Tespit edilen kesintiler ve eşik aşımları; üstlenme ve çözüm geçmişi." />

      <div className="grid gap-2 sm:grid-cols-3">
        <Select value={status} onValueChange={setter(setStatus)}>
          <SelectTrigger aria-label="Durum filtresi" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Etkin (açık + üstlenilmiş)</SelectItem>
            <SelectItem value="OPEN">Açık</SelectItem>
            <SelectItem value="ACKNOWLEDGED">Üstlenilmiş</SelectItem>
            <SelectItem value="RESOLVED">Çözülmüş</SelectItem>
            <SelectItem value={ALL}>Tümü</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={setter(setSeverity)}>
          <SelectTrigger aria-label="Önem filtresi" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tüm önem dereceleri</SelectItem>
            {catalog.data?.severities.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setter(setType)}>
          <SelectTrigger aria-label="Tür filtresi" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tüm türler</SelectItem>
            {catalog.data?.types.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {incidents.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : incidents.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(incidents.error)}</AlertDescription>
        </Alert>
      ) : incidents.data.items.length === 0 ? (
        <EmptyState icon={TriangleAlert} title={status === 'active' ? 'Etkin olay yok' : 'Olay bulunamadı'} description={status === 'active' ? 'Tüm sunucular ve kontroller normal görünüyor.' : 'Filtreyle eşleşen olay yok.'} />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Olay</TableHead>
                <TableHead>Önem</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>Kaynak</TableHead>
                <TableHead>Başlangıç</TableHead>
                <TableHead>Süre</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {incidents.data.items.map((i) => (
                <TableRow key={i.id} className="cursor-pointer" onClick={() => router.push(`/olaylar/${i.id}`)}>
                  <TableCell>
                    <Link href={`/olaylar/${i.id}`} className="block font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                      {i.title}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{i.typeLabel}</span>
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={i.severity} />
                  </TableCell>
                  <TableCell>
                    <IncidentStatusBadge status={i.status} />
                  </TableCell>
                  <TableCell className="text-sm">{i.server?.name ?? i.check?.name ?? '—'}</TableCell>
                  <TableCell className="text-sm" title={formatDateTime(i.startedAt)}>
                    {formatRelative(i.startedAt)}
                  </TableCell>
                  <TableCell className="text-sm">{formatDuration(i.durationSeconds)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {incidents.data && incidents.data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Toplam {incidents.data.total} olay · Sayfa {page}/{totalPages}
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
    </div>
  );
}
