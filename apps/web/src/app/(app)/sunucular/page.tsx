'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Plus, Search, Server, Settings2 } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { ColorDot, ServerStatusBadge, UsageMeter } from '@/components/app/status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { hasPermission, useMe } from '@/hooks/use-auth';
import { useGroups, useServers, useTags } from '@/hooks/use-servers';
import { errorMessage } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { OS_FAMILY_LABELS, SERVER_STATUS_LABELS, type OsFamily, type ServerStatus } from '@/lib/types';

const ALL = '__all__';
const PAGE_SIZE = 50;

export default function ServersPage() {
  const router = useRouter();
  const me = useMe();
  const canRegister = hasPermission(me.data, 'servers.register');
  const canManage = hasPermission(me.data, 'servers.manage');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [osFamily, setOsFamily] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [groupId, setGroupId] = useState(ALL);
  const [tagId, setTagId] = useState(ALL);
  const [page, setPage] = useState(1);

  const groups = useGroups();
  const tags = useTags();
  const servers = useServers({
    search: submittedSearch || undefined,
    osFamily: osFamily === ALL ? undefined : osFamily,
    status: status === ALL ? undefined : status,
    groupId: groupId === ALL ? undefined : groupId,
    tagId: tagId === ALL ? undefined : tagId,
    page,
    pageSize: PAGE_SIZE,
  });

  const hasFilter = submittedSearch || osFamily !== ALL || status !== ALL || groupId !== ALL || tagId !== ALL;
  const totalPages = servers.data ? Math.max(1, Math.ceil(servers.data.total / PAGE_SIZE)) : 1;

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSubmittedSearch(search.trim());
  }

  function filterSetter(setter: (value: string) => void) {
    return (value: string) => {
      setter(value);
      setPage(1);
    };
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sunucular"
        description="Kayıtlı tüm sunucular ve anlık durumları."
        actions={
          <>
            {canManage && (
              <Button asChild variant="outline">
                <Link href="/sunucular/gruplar">
                  <Settings2 /> Gruplar ve etiketler
                </Link>
              </Button>
            )}
            {canRegister && (
              <Button asChild>
                <Link href="/sunucular/ekle">
                  <Plus /> Sunucu ekle
                </Link>
              </Button>
            )}
          </>
        }
      />

      <form onSubmit={onSearch} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ad, ana makine veya açıklama ara…" className="pl-8" aria-label="Sunucu ara" />
        </div>
        <Select value={osFamily} onValueChange={filterSetter(setOsFamily)}>
          <SelectTrigger aria-label="İşletim sistemi filtresi" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tüm işletim sistemleri</SelectItem>
            {(Object.keys(OS_FAMILY_LABELS) as OsFamily[]).map((os) => (
              <SelectItem key={os} value={os}>
                {OS_FAMILY_LABELS[os]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={filterSetter(setStatus)}>
          <SelectTrigger aria-label="Durum filtresi" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tüm durumlar</SelectItem>
            {(Object.keys(SERVER_STATUS_LABELS) as ServerStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {SERVER_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={groupId} onValueChange={filterSetter(setGroupId)}>
          <SelectTrigger aria-label="Grup filtresi" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tüm gruplar</SelectItem>
            {groups.data?.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Select value={tagId} onValueChange={filterSetter(setTagId)}>
            <SelectTrigger aria-label="Etiket filtresi" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tüm etiketler</SelectItem>
              {tags.data?.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" variant="outline">
            Ara
          </Button>
        </div>
      </form>

      {servers.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : servers.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(servers.error)}</AlertDescription>
        </Alert>
      ) : servers.data.items.length === 0 ? (
        <EmptyState
          icon={Server}
          title={hasFilter ? 'Filtreyle eşleşen sunucu yok' : 'Henüz sunucu kaydedilmedi'}
          description={hasFilter ? 'Filtreleri değiştirip tekrar deneyin.' : 'İlk sunucunuzu eklemek için bir kayıt belirteci oluşturun ve ajanı kurun.'}
          action={
            !hasFilter && canRegister ? (
              <Button asChild>
                <Link href="/sunucular/ekle">
                  <Plus /> Sunucu ekle
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sunucu</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>İşletim sistemi</TableHead>
                <TableHead>CPU</TableHead>
                <TableHead>Bellek</TableHead>
                <TableHead>Disk</TableHead>
                <TableHead>Son heartbeat</TableHead>
                <TableHead>Grup / etiketler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {servers.data.items.map((s) => {
                const live = s.status === 'ONLINE' || s.status === 'DEGRADED';
                return (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => router.push(`/sunucular/${s.id}`)}>
                    <TableCell>
                      <Link href={`/sunucular/${s.id}`} className="block font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {s.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{s.hostname ?? '—'}</span>
                    </TableCell>
                    <TableCell>
                      <ServerStatusBadge status={s.status} />
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="block">{OS_FAMILY_LABELS[s.osFamily]}</span>
                      <span className="block max-w-56 truncate text-xs text-muted-foreground" title={s.osName ?? undefined}>
                        {s.osName ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <UsageMeter value={live ? s.metrics?.cpuPercent : null} />
                    </TableCell>
                    <TableCell>
                      <UsageMeter value={live ? s.metrics?.memoryPercent : null} />
                    </TableCell>
                    <TableCell>
                      <UsageMeter value={s.metrics?.diskUsedPercent} />
                    </TableCell>
                    <TableCell className="text-sm" title={s.lastHeartbeatAt ?? undefined}>
                      {formatRelative(s.lastHeartbeatAt)}
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1">
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
                        {!s.group && s.tags.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {servers.data && servers.data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Toplam {servers.data.total} sunucu · Sayfa {page}/{totalPages}
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
