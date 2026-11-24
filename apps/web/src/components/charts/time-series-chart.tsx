'use client';

import { useId, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import { Table as TableIcon, LineChart as LineChartIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/** Seri renkleri sabit sırayla atanır; sekizden fazla seri "Diğer" altında toplanmalıdır. */
export const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'];

export interface SeriesDef {
  key: string;
  label: string;
  color?: string;
}

export interface TimePoint {
  t: string;
  [key: string]: number | string | null | undefined;
}

export interface TimeSeriesChartProps {
  title: string;
  description?: string;
  points: TimePoint[];
  series: SeriesDef[];
  /** 'area' tek seriye uygun yüzde grafikleri için; 'line' çoklu seriler için. */
  variant?: 'area' | 'line';
  unit?: 'percent' | 'bytesPerSec' | 'number';
  /** Yüzde grafiklerinde 0-100 sabit eksen. */
  fixedPercent?: boolean;
  height?: number;
  loading?: boolean;
  emptyText?: string;
  rangeHours?: number;
  className?: string;
}

const timeFormatterShort = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });
const timeFormatterDay = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const timeFormatterDate = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short' });
const fullFormatter = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

function formatTick(iso: string, rangeHours: number): string {
  const date = new Date(iso);
  if (rangeHours <= 24) return timeFormatterShort.format(date);
  if (rangeHours <= 24 * 7) return timeFormatterDay.format(date);
  return timeFormatterDate.format(date);
}

function formatRateCompact(value: number): string {
  const units = ['B/sn', 'KB/sn', 'MB/sn', 'GB/sn'];
  let v = value;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v.toLocaleString('tr-TR', { maximumFractionDigits: u === 0 ? 0 : 1 })} ${units[u]}`;
}

export function formatUnit(value: number | null | undefined, unit: TimeSeriesChartProps['unit']): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (unit === 'percent') return `%${value.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`;
  if (unit === 'bytesPerSec') return formatRateCompact(value);
  return value.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
}

function ChartTooltip({ active, payload, label, series, unit }: Partial<TooltipContentProps<number, string>> & { series: SeriesDef[]; unit: TimeSeriesChartProps['unit'] }) {
  if (!active || !payload || payload.length === 0) return null;
  const byKey = new Map(payload.map((p) => [String(p.dataKey), p.value as number | undefined]));
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-2 text-xs shadow-md">
      <p className="mb-1 text-muted-foreground">{fullFormatter.format(new Date(String(label)))}</p>
      <ul className="space-y-0.5">
        {series.map((s, i) => (
          <li key={s.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: s.color ?? SERIES_COLORS[i] }} aria-hidden />
              {s.label}
            </span>
            <span className="font-semibold tabular-nums text-foreground">{formatUnit(byKey.get(s.key) as number | undefined, unit)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TimeSeriesChart({ title, description, points, series, variant = 'line', unit = 'number', fixedPercent = false, height = 220, loading = false, emptyText = 'Bu aralıkta veri yok.', rangeHours = 1, className }: TimeSeriesChartProps) {
  const gradientId = useId();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const hasData = useMemo(() => points.some((p) => series.some((s) => p[s.key] !== null && p[s.key] !== undefined)), [points, series]);
  const yFormatter = (value: number) => (unit === 'percent' ? `%${value}` : unit === 'bytesPerSec' ? formatRateCompact(value) : String(value));

  const axisProps = {
    tick: { fill: 'var(--chart-muted)', fontSize: 11 },
    axisLine: { stroke: 'var(--chart-axis)' },
    tickLine: false as const,
  };

  return (
    <section className={cn('rounded-lg border border-border bg-card', className)} aria-label={title}>
      <header className="flex items-start justify-between gap-2 px-4 pt-3 pb-1">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        <Button variant="ghost" size="icon-xs" aria-label={view === 'chart' ? 'Tablo görünümü' : 'Grafik görünümü'} onClick={() => setView(view === 'chart' ? 'table' : 'chart')}>
          {view === 'chart' ? <TableIcon /> : <LineChartIcon />}
        </Button>
      </header>

      {series.length > 1 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 px-4 pb-1 text-xs text-muted-foreground" aria-label="Gösterge">
          {series.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: s.color ?? SERIES_COLORS[i] }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
      )}

      <div className={cn('px-2 pb-2 transition-opacity', loading && 'opacity-60')} style={{ height }}>
        {!hasData ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{loading ? 'Yükleniyor…' : emptyText}</div>
        ) : view === 'table' ? (
          <div className="h-full overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zaman</TableHead>
                  {series.map((s) => (
                    <TableHead key={s.key} className="text-right">
                      {s.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {points.map((p) => (
                  <TableRow key={p.t}>
                    <TableCell className="text-xs">{fullFormatter.format(new Date(p.t))}</TableCell>
                    {series.map((s) => (
                      <TableCell key={s.key} className="text-right text-xs tabular-nums">
                        {formatUnit(p[s.key] as number | null, unit)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {variant === 'area' ? (
              <AreaChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  {series.map((s, i) => (
                    <linearGradient key={s.key} id={`${gradientId}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.color ?? SERIES_COLORS[i]} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={s.color ?? SERIES_COLORS[i]} stopOpacity={0.02} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid stroke="var(--chart-grid)" strokeWidth={1} vertical={false} />
                <XAxis dataKey="t" tickFormatter={(v: string) => formatTick(v, rangeHours)} minTickGap={48} {...axisProps} />
                <YAxis width={unit === 'bytesPerSec' ? 72 : 44} tickFormatter={yFormatter} domain={fixedPercent ? [0, 100] : [0, 'auto']} {...axisProps} />
                <Tooltip content={<ChartTooltip series={series} unit={unit} />} cursor={{ stroke: 'var(--chart-muted)', strokeWidth: 1 }} isAnimationActive={false} />
                {series.map((s, i) => (
                  <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color ?? SERIES_COLORS[i]} strokeWidth={2} fill={`url(#${gradientId}-${s.key})`} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }} isAnimationActive={false} connectNulls={false} />
                ))}
              </AreaChart>
            ) : (
              <LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--chart-grid)" strokeWidth={1} vertical={false} />
                <XAxis dataKey="t" tickFormatter={(v: string) => formatTick(v, rangeHours)} minTickGap={48} {...axisProps} />
                <YAxis width={unit === 'bytesPerSec' ? 72 : 44} tickFormatter={yFormatter} domain={fixedPercent ? [0, 100] : [0, 'auto']} {...axisProps} />
                <Tooltip content={<ChartTooltip series={series} unit={unit} />} cursor={{ stroke: 'var(--chart-muted)', strokeWidth: 1 }} isAnimationActive={false} />
                {series.map((s, i) => (
                  <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color ?? SERIES_COLORS[i]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }} isAnimationActive={false} connectNulls={false} />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
