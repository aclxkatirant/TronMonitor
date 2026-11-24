'use client';

import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useInvalidate } from '@/hooks/use-operations';
import { useServers } from '@/hooks/use-servers';
import { api, errorMessage } from '@/lib/api';
import type { CheckType, UptimeCheck } from '@/lib/types';

const NO_SERVER = '__none__';
const TYPES: { value: CheckType; label: string }[] = [
  { value: 'HTTPS', label: 'HTTPS' },
  { value: 'HTTP', label: 'HTTP' },
  { value: 'TCP', label: 'TCP portu' },
  { value: 'ICMP', label: 'ICMP (ping)' },
];

interface FormState {
  name: string;
  type: CheckType;
  target: string;
  port: string;
  method: string;
  expectedStatusCode: string;
  intervalSec: string;
  timeoutSec: string;
  retryCount: string;
  failureThreshold: string;
  recoveryThreshold: string;
  sslExpiryWarnDays: string;
  notifyOnFailure: boolean;
  isEnabled: boolean;
  serverId: string;
}

function initial(check: UptimeCheck | null): FormState {
  return {
    name: check?.name ?? '',
    type: check?.type ?? 'HTTPS',
    target: check?.target ?? '',
    port: check?.port ? String(check.port) : '',
    method: check?.method ?? 'GET',
    expectedStatusCode: check?.expectedStatusCode ? String(check.expectedStatusCode) : '',
    intervalSec: String(check?.intervalSec ?? 60),
    timeoutSec: String(check?.timeoutSec ?? 10),
    retryCount: String(check?.retryCount ?? 2),
    failureThreshold: String(check?.failureThreshold ?? 3),
    recoveryThreshold: String(check?.recoveryThreshold ?? 2),
    sslExpiryWarnDays: String(check?.sslExpiryWarnDays ?? 14),
    notifyOnFailure: check?.notifyOnFailure ?? true,
    isEnabled: check?.isEnabled ?? true,
    serverId: check?.server?.id ?? NO_SERVER,
  };
}

export function CheckDialog({ open, onOpenChange, check }: { open: boolean; onOpenChange: (open: boolean) => void; check: UptimeCheck | null }) {
  const isEdit = check !== null;
  const [form, setForm] = useState<FormState>(() => initial(check));
  const servers = useServers({ pageSize: 200, sort: 'name' }, { refetchInterval: 0 });
  const invalidate = useInvalidate([['checks'], ['dashboard']]);
  const isHttp = form.type === 'HTTP' || form.type === 'HTTPS';

  const mutation = useMutation({
    mutationFn: () => {
      const num = (v: string) => (v === '' ? undefined : Number(v));
      const payload = {
        name: form.name.trim(),
        type: form.type,
        target: form.target.trim(),
        port: form.type === 'TCP' ? num(form.port) : undefined,
        method: isHttp ? form.method : undefined,
        expectedStatusCode: isHttp ? num(form.expectedStatusCode) : undefined,
        intervalSec: num(form.intervalSec),
        timeoutSec: num(form.timeoutSec),
        retryCount: num(form.retryCount),
        failureThreshold: num(form.failureThreshold),
        recoveryThreshold: num(form.recoveryThreshold),
        sslExpiryWarnDays: form.type === 'HTTPS' ? num(form.sslExpiryWarnDays) : undefined,
        notifyOnFailure: form.notifyOnFailure,
        isEnabled: form.isEnabled,
        serverId: form.serverId === NO_SERVER ? null : form.serverId,
      };
      return isEdit ? api.patch<UptimeCheck>(`/checks/${check.id}`, payload) : api.post<UptimeCheck>('/checks', payload);
    },
    onSuccess: async () => {
      toast.success(isEdit ? 'Kontrol güncellendi.' : 'Kontrol oluşturuldu; ilk çalıştırma birkaç saniye içinde yapılır.');
      await invalidate();
      onOpenChange(false);
    },
  });

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  const placeholder = form.type === 'HTTP' ? 'http://ornek.com/saglik' : form.type === 'HTTPS' ? 'https://ornek.com/saglik' : 'ornek.com veya 10.0.0.5';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Kontrolü düzenle' : 'Yeni erişilebilirlik kontrolü'}</DialogTitle>
            <DialogDescription>Hedef düzenli aralıklarla denetlenir; ardışık başarısızlıklar olay açar, toparlanma olayı kapatır.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <div className="space-y-1.5">
              <Label htmlFor="c-name">Ad</Label>
              <Input id="c-name" value={form.name} onChange={(e) => set('name', e.target.value)} required maxLength={120} autoFocus placeholder="ör. Müşteri portalı" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-type">Tür</Label>
              <Select value={form.type} onValueChange={(v) => set('type', v as CheckType)}>
                <SelectTrigger id="c-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className={isHttp ? 'grid gap-4 sm:grid-cols-[1fr_120px_140px]' : form.type === 'TCP' ? 'grid gap-4 sm:grid-cols-[1fr_120px]' : 'grid gap-4'}>
            <div className="space-y-1.5">
              <Label htmlFor="c-target">{isHttp ? 'Adres' : 'Ana makine / IP'}</Label>
              <Input id="c-target" value={form.target} onChange={(e) => set('target', e.target.value)} required placeholder={placeholder} />
            </div>
            {form.type === 'TCP' && (
              <div className="space-y-1.5">
                <Label htmlFor="c-port">Port</Label>
                <Input id="c-port" type="number" min={1} max={65535} value={form.port} onChange={(e) => set('port', e.target.value)} required />
              </div>
            )}
            {isHttp && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="c-method">Yöntem</Label>
                  <Select value={form.method} onValueChange={(v) => set('method', v)}>
                    <SelectTrigger id="c-method" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {['GET', 'HEAD', 'POST'].map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-status">Beklenen durum</Label>
                  <Input id="c-status" type="number" min={100} max={599} value={form.expectedStatusCode} onChange={(e) => set('expectedStatusCode', e.target.value)} placeholder="2xx/3xx" />
                </div>
              </>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-interval">Aralık (sn)</Label>
              <Input id="c-interval" type="number" min={10} max={86400} value={form.intervalSec} onChange={(e) => set('intervalSec', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-timeout">Zaman aşımı (sn)</Label>
              <Input id="c-timeout" type="number" min={1} max={120} value={form.timeoutSec} onChange={(e) => set('timeoutSec', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-retry">Yeniden deneme</Label>
              <Input id="c-retry" type="number" min={0} max={5} value={form.retryCount} onChange={(e) => set('retryCount', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-fail">Hata eşiği (ardışık)</Label>
              <Input id="c-fail" type="number" min={1} max={20} value={form.failureThreshold} onChange={(e) => set('failureThreshold', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-recover">Toparlanma eşiği</Label>
              <Input id="c-recover" type="number" min={1} max={20} value={form.recoveryThreshold} onChange={(e) => set('recoveryThreshold', e.target.value)} />
            </div>
            {form.type === 'HTTPS' && (
              <div className="space-y-1.5">
                <Label htmlFor="c-ssl">SSL uyarısı (gün)</Label>
                <Input id="c-ssl" type="number" min={1} max={365} value={form.sslExpiryWarnDays} onChange={(e) => set('sslExpiryWarnDays', e.target.value)} />
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="c-server">İlişkili sunucu (isteğe bağlı)</Label>
              <Select value={form.serverId} onValueChange={(v) => set('serverId', v)}>
                <SelectTrigger id="c-server" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SERVER}>Sunucu yok</SelectItem>
                  {servers.data?.items.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.notifyOnFailure} onCheckedChange={(v) => set('notifyOnFailure', v)} /> Olay aç
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.isEnabled} onCheckedChange={(v) => set('isEnabled', v)} /> Etkin
            </label>
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
            <Button type="submit" disabled={mutation.isPending || !form.name.trim() || !form.target.trim()}>
              {mutation.isPending ? 'Kaydediliyor…' : isEdit ? 'Kaydet' : 'Oluştur'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
