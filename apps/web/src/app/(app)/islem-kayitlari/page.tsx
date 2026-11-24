'use client';

import { useState, type FormEvent } from 'react';
import { ClipboardList, Search } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuditLogs, useAuditMeta } from '@/hooks/use-admin';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { AuditResult } from '@/lib/types';
import { cn } from '@/lib/utils';

const ALL = '__all__';
const PAGE_SIZE = 50;
const RESULT_CLASS: Record<AuditResult, string> = { SUCCESS: 'text-status-ok', FAILURE: 'text-status-error', DENIED: 'text-status-warn' };

export default function AuditLogsPage() {
  const meta = useAuditMeta();
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [action, setAction] = useState(ALL);
  const [resourceType, setResourceType] = useState(ALL);
  const [result, setResult] = useState(ALL);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const logs = useAuditLogs({ search: submitted || undefined, action: action === ALL ? undefined : action, resourceType: resourceType === ALL ? undefined : resourceType, result: result === ALL ? undefined : result, page, pageSize: PAGE_SIZE });
  const totalPages = logs.data ? Math.max(1, Math.ceil(logs.data.total / PAGE_SIZE)) : 1;

  const setter = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setPage(1);
  };

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPage(1);
    setSubmitted(search.trim());
  }

  return (
    <div className="space-y-6">
      <PageHeader title="İşlem Kayıtları" description="Kim, ne zaman, neyi yaptı. Kayıtlar değiştirilemez ve silinemez." />

      <form onSubmit={onSearch} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Eylem, kullanıcı, kaynak veya IP ara…" className="pl-8" aria-label="Kayıt ara" />
        </div>
        <Select value={action} onValueChange={setter(setAction)}>
          <SelectTrigger aria-label="Eylem filtresi" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tüm eylemler</SelectItem>
            {meta.data?.actions.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={result} onValueChange={setter(setResult)}>
          <SelectTrigger aria-label="Sonuç filtresi" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tüm sonuçlar</SelectItem>
            {meta.data?.results.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Select value={resourceType} onValueChange={setter(setResourceType)}>
            <SelectTrigger aria-label="Kaynak türü filtresi" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tüm kaynaklar</SelectItem>
              {meta.data?.resourceTypes.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" variant="outline">
            Ara
          </Button>
        </div>
      </form>

      {logs.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : logs.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(logs.error)}</AlertDescription>
        </Alert>
      ) : logs.data.items.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Kayıt bulunamadı" description="Filtreyle eşleşen işlem kaydı yok." />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Zaman</TableHead>
                <TableHead>Eylem</TableHead>
                <TableHead>Aktör</TableHead>
                <TableHead>Kaynak</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Sonuç</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.data.items.map((l) => (
                <TableRow key={l.id} className="cursor-pointer" onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                  <TableCell className="text-sm whitespace-nowrap">{formatDateTime(l.createdAt)}</TableCell>
                  <TableCell>
                    <span className="block font-mono text-xs">{l.action}</span>
                    {expanded === l.id && l.metadata && <pre className="mt-1 max-w-xl overflow-x-auto rounded bg-muted/40 p-2 text-[11px] whitespace-pre-wrap text-muted-foreground">{JSON.stringify(l.metadata, null, 2)}</pre>}
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="block">{l.user?.fullName ?? l.actorLabel}</span>
                    {l.user && <span className="block text-xs text-muted-foreground">{l.user.email}</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {l.resourceType ?? '—'}
                    {l.resourceId && <span className="block max-w-40 truncate font-mono" title={l.resourceId}>{l.resourceId}</span>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{l.ipAddress ?? '—'}</TableCell>
                  <TableCell className={cn('text-sm', RESULT_CLASS[l.result])}>{l.resultLabel}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {logs.data && logs.data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Toplam {logs.data.total} kayıt · Sayfa {page}/{totalPages}
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
