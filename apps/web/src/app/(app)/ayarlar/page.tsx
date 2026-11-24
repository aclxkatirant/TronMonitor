'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/app/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { hasPermission, useMe } from '@/hooks/use-auth';
import { api, errorMessage } from '@/lib/api';

interface MonitoringSettings {
  thresholds: { cpuPercent: number; memoryPercent: number; diskPercent: number; consecutiveSamples: number };
  retention: { rawDays: number; minute5Days: number; hour1Days: number; day1Days: number };
}

type MonitoringResponse = MonitoringSettings & { defaults: MonitoringSettings };

const FIELDS: { group: keyof MonitoringSettings; key: string; label: string; hint: string; min: number; max: number }[] = [
  { group: 'thresholds', key: 'cpuPercent', label: 'CPU eşiği (%)', hint: 'Ortalama CPU bu değerin üzerindeyse sunucu "sorunlu" sayılır.', min: 50, max: 100 },
  { group: 'thresholds', key: 'memoryPercent', label: 'Bellek eşiği (%)', hint: 'Bellek kullanımı bu değerin üzerindeyse.', min: 50, max: 100 },
  { group: 'thresholds', key: 'diskPercent', label: 'Disk eşiği (%)', hint: 'Herhangi bir hacmin doluluğu bu değerin üzerindeyse.', min: 50, max: 100 },
  { group: 'thresholds', key: 'consecutiveSamples', label: 'Ardışık örnek sayısı', hint: 'Eşik bu kadar ardışık örnekte aşılırsa durum değişir (yanlış alarmları azaltır).', min: 1, max: 20 },
  { group: 'retention', key: 'rawDays', label: 'Ham örnekler (gün)', hint: 'Saniye düzeyindeki ham örnekler bu süre sonunda silinir.', min: 1, max: 90 },
  { group: 'retention', key: 'minute5Days', label: '5 dakikalık özetler (gün)', hint: '', min: 7, max: 365 },
  { group: 'retention', key: 'hour1Days', label: 'Saatlik özetler (gün)', hint: '', min: 30, max: 1825 },
  { group: 'retention', key: 'day1Days', label: 'Günlük özetler (gün)', hint: '', min: 90, max: 3650 },
];

function MonitoringForm({ initial, canManage }: { initial: MonitoringResponse; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<MonitoringSettings>({ thresholds: { ...initial.thresholds }, retention: { ...initial.retention } });

  const mutation = useMutation({
    mutationFn: () => api.put<MonitoringResponse>('/settings/monitoring', values),
    onSuccess: async () => {
      toast.success('İzleme ayarları kaydedildi.');
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  function setField(group: keyof MonitoringSettings, key: string, raw: string) {
    const parsed = Number(raw);
    setValues((v) => ({ ...v, [group]: { ...v[group], [key]: Number.isFinite(parsed) ? parsed : 0 } }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Eşikler</CardTitle>
          <CardDescription>Bu değerler aşıldığında sunucu durumu &quot;sorunlu&quot; olur ve olay/bildirim sistemleri bu durumu kullanır.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {FIELDS.filter((f) => f.group === 'thresholds').map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`f-${f.key}`}>{f.label}</Label>
              <Input id={`f-${f.key}`} type="number" min={f.min} max={f.max} value={values.thresholds[f.key as keyof MonitoringSettings['thresholds']]} onChange={(e) => setField('thresholds', f.key, e.target.value)} disabled={!canManage} />
              <p className="text-xs text-muted-foreground">
                {f.hint} Varsayılan: {initial.defaults.thresholds[f.key as keyof MonitoringSettings['thresholds']]}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Veri saklama</CardTitle>
          <CardDescription>Ham örnekler kısa süre, özetler uzun süre saklanır. Saklama işi her saat çalışır ve süresi dolan verileri siler.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {FIELDS.filter((f) => f.group === 'retention').map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`f-${f.key}`}>{f.label}</Label>
              <Input id={`f-${f.key}`} type="number" min={f.min} max={f.max} value={values.retention[f.key as keyof MonitoringSettings['retention']]} onChange={(e) => setField('retention', f.key, e.target.value)} disabled={!canManage} />
              <p className="text-xs text-muted-foreground">
                {f.hint} Varsayılan: {initial.defaults.retention[f.key as keyof MonitoringSettings['retention']]} gün · {f.min}–{f.max}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      {mutation.isError && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(mutation.error)}</AlertDescription>
        </Alert>
      )}
      {canManage ? (
        <div className="flex gap-2">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
          <Button type="button" variant="outline" onClick={() => setValues({ thresholds: { ...initial.defaults.thresholds }, retention: { ...initial.defaults.retention } })}>
            Varsayılanlara dön
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Ayarları yalnızca süper yönetici değiştirebilir.</p>
      )}
    </form>
  );
}

export default function SettingsPage() {
  const me = useMe();
  const canManage = hasPermission(me.data, 'settings.manage');
  const settings = useQuery({ queryKey: ['settings', 'monitoring'], queryFn: () => api.get<MonitoringResponse>('/settings/monitoring') });

  return (
    <div className="space-y-6">
      <PageHeader title="Ayarlar" description="Sistem genelindeki izleme eşikleri ve veri saklama politikası." />
      {settings.isPending ? (
        <Skeleton className="h-80 w-full" />
      ) : settings.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(settings.error)}</AlertDescription>
        </Alert>
      ) : (
        <MonitoringForm key={settings.dataUpdatedAt} initial={settings.data} canManage={canManage} />
      )}
    </div>
  );
}
