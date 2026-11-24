'use client';

import { useMemo } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TimeSeriesChart, type TimePoint } from '@/components/charts/time-series-chart';
import { rangeHours, type RangeSelection } from '@/components/charts/range-picker';
import { useInterfaceHistory, useMetricsHistory, useVolumeHistory } from '@/hooks/use-metrics';
import { errorMessage } from '@/lib/api';
import type { OsFamily } from '@/lib/types';

const SOURCE_LABELS = {
  raw: 'ham örnekler',
  minute5: '5 dakikalık özetler',
  hour1: 'saatlik özetler',
  day1: 'günlük özetler',
};

function mergeSeries<T extends { t: string }>(series: { key: string; points: T[] }[], pick: (p: T) => number | null): TimePoint[] {
  const byTime = new Map<string, TimePoint>();
  for (const s of series) {
    for (const p of s.points) {
      const row = byTime.get(p.t) ?? { t: p.t };
      row[s.key] = pick(p);
      byTime.set(p.t, row);
    }
  }
  return [...byTime.values()].sort((a, b) => a.t.localeCompare(b.t));
}

/** Bir sunucunun tüm metrik grafikleri; aralık seçici bu bileşenin üstünde tek satırda durur. */
export function ServerMetricsPanel({ serverId, osFamily, selection }: { serverId: string; osFamily: OsFamily; selection: RangeSelection }) {
  const history = useMetricsHistory(serverId, selection);
  const volumes = useVolumeHistory(serverId, selection);
  const interfaces = useInterfaceHistory(serverId, selection);
  const hours = rangeHours(selection);

  const points = useMemo<TimePoint[]>(() => history.data?.points ?? [], [history.data]);
  const volumeSeries = useMemo(() => (volumes.data?.series ?? []).slice(0, 8).map((s) => ({ key: `vol:${s.volume}`, label: s.volume })), [volumes.data]);
  const volumePoints = useMemo(() => mergeSeries((volumes.data?.series ?? []).slice(0, 8).map((s) => ({ key: `vol:${s.volume}`, points: s.points })), (p) => p.usedPct), [volumes.data]);
  const ifaceSeries = useMemo(() => {
    const names = (interfaces.data?.series ?? []).slice(0, 4);
    return names.flatMap((s) => [
      { key: `rx:${s.name}`, label: `${s.name} gelen` },
      { key: `tx:${s.name}`, label: `${s.name} giden` },
    ]);
  }, [interfaces.data]);
  const ifacePoints = useMemo(() => {
    const names = (interfaces.data?.series ?? []).slice(0, 4);
    const rx = mergeSeries(names.map((s) => ({ key: `rx:${s.name}`, points: s.points })), (p) => p.rx);
    const tx = mergeSeries(names.map((s) => ({ key: `tx:${s.name}`, points: s.points })), (p) => p.tx);
    const byTime = new Map<string, TimePoint>();
    for (const row of [...rx, ...tx]) byTime.set(row.t, { ...(byTime.get(row.t) ?? { t: row.t }), ...row });
    return [...byTime.values()].sort((a, b) => a.t.localeCompare(b.t));
  }, [interfaces.data]);

  if (history.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(history.error)}</AlertDescription>
      </Alert>
    );
  }

  const source = history.data?.range.source;
  const loading = history.isPending || history.isFetching;
  const aggregated = source && source !== 'raw';

  return (
    <div className="space-y-4">
      {history.data && (
        <p className="text-xs text-muted-foreground">
          Kaynak: {SOURCE_LABELS[history.data.range.source]} · aralık {history.data.range.bucketSeconds >= 3600 ? `${history.data.range.bucketSeconds / 3600} sa` : history.data.range.bucketSeconds >= 60 ? `${history.data.range.bucketSeconds / 60} dk` : `${history.data.range.bucketSeconds} sn`} · {history.data.points.length} nokta
          {aggregated && ' · Bu aralık ham örnek saklama penceresinin dışında; hacim, arayüz, disk G/Ç ve yük ortalaması grafikleri yalnızca ham pencerede gösterilir.'}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <TimeSeriesChart title="CPU kullanımı" description="Ortalama ve en yüksek" points={points} series={[{ key: 'cpuAvg', label: 'Ortalama' }, { key: 'cpuMax', label: 'En yüksek' }]} variant="line" unit="percent" fixedPercent loading={loading} rangeHours={hours} />
        <TimeSeriesChart title="Bellek kullanımı" description="Ortalama ve en yüksek" points={points} series={[{ key: 'memAvg', label: 'Ortalama', color: 'var(--series-3)' }, { key: 'memMax', label: 'En yüksek', color: 'var(--series-4)' }]} variant="line" unit="percent" fixedPercent loading={loading} rangeHours={hours} />
        <TimeSeriesChart title="Ağ trafiği (toplam)" description="Tüm arayüzlerin toplamı" points={points} series={[{ key: 'netRx', label: 'Gelen' }, { key: 'netTx', label: 'Giden', color: 'var(--series-2)' }]} variant="line" unit="bytesPerSec" loading={loading} rangeHours={hours} />
        <TimeSeriesChart title="Disk kullanımı (toplam)" description="Tüm hacimlerin toplam doluluğu" points={points} series={[{ key: 'diskUsedPct', label: 'Doluluk', color: 'var(--series-7)' }]} variant="area" unit="percent" fixedPercent loading={loading} rangeHours={hours} />
        {!aggregated && (
          <TimeSeriesChart title="Disk G/Ç" description="Okuma ve yazma hızı" points={points} series={[{ key: 'diskRead', label: 'Okuma', color: 'var(--series-3)' }, { key: 'diskWrite', label: 'Yazma', color: 'var(--series-5)' }]} variant="line" unit="bytesPerSec" loading={loading} rangeHours={hours} />
        )}
        {!aggregated && osFamily === 'LINUX' && (
          <TimeSeriesChart title="Yük ortalaması" description="1, 5 ve 15 dakika" points={points} series={[{ key: 'load1', label: '1 dk' }, { key: 'load5', label: '5 dk', color: 'var(--series-2)' }, { key: 'load15', label: '15 dk', color: 'var(--series-3)' }]} variant="line" unit="number" loading={loading} rangeHours={hours} />
        )}
        {!aggregated && (
          <TimeSeriesChart title="Hacim bazında disk doluluğu" description={volumeSeries.length > 8 ? 'İlk 8 hacim' : undefined} points={volumePoints} series={volumeSeries} variant="line" unit="percent" fixedPercent loading={volumes.isPending || volumes.isFetching} rangeHours={hours} />
        )}
        {!aggregated && (
          <TimeSeriesChart title="Arayüz bazında ağ trafiği" description="En fazla 4 arayüz" points={ifacePoints} series={ifaceSeries} variant="line" unit="bytesPerSec" loading={interfaces.isPending || interfaces.isFetching} rangeHours={hours} />
        )}
      </div>
    </div>
  );
}
