'use client';

import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { CommandBlock } from '@/components/app/copy-button';
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
import { useApiTokenScopes, useApiTokens } from '@/hooks/use-admin';
import { useInvalidate } from '@/hooks/use-operations';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { ApiTokenItem } from '@/lib/types';

const STATUS_LABELS = { ACTIVE: 'Etkin', EXPIRED: 'Süresi doldu', REVOKED: 'İptal edildi' } as const;

function CreateDialog({ open, onOpenChange, scopes }: { open: boolean; onOpenChange: (o: boolean) => void; scopes: { key: string; description: string }[] }) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [expires, setExpires] = useState('90');
  const [created, setCreated] = useState<string | null>(null);
  const [origin] = useState(() => (typeof window === 'undefined' ? '' : window.location.origin));
  const invalidate = useInvalidate([['api-tokens']]);

  const mutation = useMutation({
    mutationFn: () => api.post<{ token: string; record: ApiTokenItem }>('/api-tokens', { name: name.trim(), scopes: selected, expiresInDays: expires === 'never' ? undefined : Number(expires) }),
    onSuccess: async (r) => {
      setCreated(r.token);
      await invalidate();
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {created ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Belirteç oluşturuldu</DialogTitle>
              <DialogDescription>Bu belirteç yalnızca şimdi gösterilir; kapattıktan sonra bir daha görüntülenemez. Güvenli bir yere kaydedin.</DialogDescription>
            </DialogHeader>
            <CommandBlock command={created} label="API belirteci" />
            <CommandBlock command={`curl -H "Authorization: Bearer ${created}" ${origin}/api/v1/servers`} label="Örnek kullanım" />
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Kapat</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <DialogHeader>
              <DialogTitle>Yeni API belirteci</DialogTitle>
              <DialogDescription>Belirteç, seçtiğiniz izinlerle sınırlıdır ve asla kendi izinlerinizi aşamaz. İstekler `Authorization: Bearer` başlığıyla yapılır.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
              <div className="space-y-1.5">
                <Label htmlFor="t-name">Ad</Label>
                <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="ör. CI/CD okuma" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-exp">Geçerlilik</Label>
                <Select value={expires} onValueChange={setExpires}>
                  <SelectTrigger id="t-exp" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 gün</SelectItem>
                    <SelectItem value="90">90 gün</SelectItem>
                    <SelectItem value="365">1 yıl</SelectItem>
                    <SelectItem value="never">Süresiz</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>İzinler</Label>
              <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
                {scopes.map((s) => (
                  <label key={s.key} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted">
                    <Checkbox checked={selected.includes(s.key)} aria-label={s.key} className="mt-0.5" onCheckedChange={(next) => setSelected(next === true ? [...selected, s.key] : selected.filter((k) => k !== s.key))} />
                    <span>
                      <span className="block font-mono text-[11px]">{s.key}</span>
                      <span className="block text-muted-foreground">{s.description}</span>
                    </span>
                  </label>
                ))}
              </div>
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
              <Button type="submit" disabled={mutation.isPending || !name.trim() || selected.length === 0}>
                {mutation.isPending ? 'Oluşturuluyor…' : 'Oluştur'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function ApiTokensPage() {
  const me = useMe();
  const canAll = hasPermission(me.data, 'apitokens.manage_all');
  const [showAll, setShowAll] = useState(false);
  const tokens = useApiTokens(canAll && showAll);
  const scopes = useApiTokenScopes();
  const invalidate = useInvalidate([['api-tokens']]);
  const [dialog, setDialog] = useState({ open: false, key: 0 });
  const [origin] = useState(() => (typeof window === 'undefined' ? '' : window.location.origin));

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api-tokens/${id}`),
    onSuccess: async () => {
      toast.success('Belirteç iptal edildi.');
      await invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="API Yönetimi"
        description="Programatik erişim için kişisel belirteçler. REST API belgeleri geliştirme ortamında /api/docs adresindedir."
        actions={
          <>
            {canAll && (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={showAll} onCheckedChange={setShowAll} /> Tüm kullanıcılar
              </label>
            )}
            <Button onClick={() => setDialog((d) => ({ open: true, key: d.key + 1 }))} disabled={!scopes.data}>
              <Plus /> Belirteç oluştur
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Kullanım</CardTitle>
          <CardDescription>Belirteçler yalnızca oluşturulurken gösterilir; sunucuda yalnızca karması saklanır.</CardDescription>
        </CardHeader>
        <CardContent>
          <CommandBlock command={`curl -H "Authorization: Bearer tmk_..." ${origin}/api/v1/dashboard/summary`} />
        </CardContent>
      </Card>

      {tokens.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : tokens.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(tokens.error)}</AlertDescription>
        </Alert>
      ) : tokens.data.length === 0 ? (
        <EmptyState icon={KeyRound} title="Henüz belirteç yok" description="Otomasyon ve entegrasyonlar için kapsamı sınırlı bir belirteç oluşturun." action={<Button onClick={() => setDialog((d) => ({ open: true, key: d.key + 1 }))}>Belirteç oluştur</Button>} />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ad</TableHead>
                {showAll && <TableHead>Sahip</TableHead>}
                <TableHead>Önek</TableHead>
                <TableHead>İzinler</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>Son kullanım</TableHead>
                <TableHead>Bitiş</TableHead>
                <TableHead className="text-right">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.data.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-sm font-medium">{t.name}</TableCell>
                  {showAll && <TableCell className="text-sm">{t.owner?.email ?? '—'}</TableCell>}
                  <TableCell className="font-mono text-xs">{t.tokenPrefix}…</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {t.scopes.map((s) => (
                        <Badge key={s} variant="outline" className="font-mono text-[10px]">
                          {s}
                        </Badge>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className={t.status === 'ACTIVE' ? 'text-sm text-status-ok' : 'text-sm text-muted-foreground'}>{STATUS_LABELS[t.status]}</TableCell>
                  <TableCell className="text-sm">{formatRelative(t.lastUsedAt)}</TableCell>
                  <TableCell className="text-sm">{t.expiresAt ? formatDateTime(t.expiresAt) : 'Süresiz'}</TableCell>
                  <TableCell className="text-right">
                    {t.status === 'ACTIVE' && (
                      <Button variant="ghost" size="sm" onClick={() => revoke.mutate(t.id)} disabled={revoke.isPending}>
                        <Trash2 /> İptal et
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {dialog.open && scopes.data && <CreateDialog key={dialog.key} open={dialog.open} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} scopes={scopes.data} />}
    </div>
  );
}
