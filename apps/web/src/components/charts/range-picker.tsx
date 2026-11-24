'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type RangeKey = '1h' | '6h' | '24h' | '7d' | '30d' | 'custom';

export interface RangeSelection {
  range: RangeKey;
  from?: string;
  to?: string;
}

export const RANGE_PRESETS: { key: RangeKey; label: string; hours: number }[] = [
  { key: '1h', label: 'Son 1 saat', hours: 1 },
  { key: '6h', label: 'Son 6 saat', hours: 6 },
  { key: '24h', label: 'Son 24 saat', hours: 24 },
  { key: '7d', label: 'Son 7 gün', hours: 24 * 7 },
  { key: '30d', label: 'Son 30 gün', hours: 24 * 30 },
];

export function rangeHours(selection: RangeSelection): number {
  if (selection.range !== 'custom') return RANGE_PRESETS.find((p) => p.key === selection.range)?.hours ?? 1;
  if (selection.from && selection.to) return Math.max(1, (new Date(selection.to).getTime() - new Date(selection.from).getTime()) / 3_600_000);
  return 24;
}

export function toQuery(selection: RangeSelection): string {
  const params = new URLSearchParams({ range: selection.range });
  if (selection.range === 'custom' && selection.from && selection.to) {
    params.set('from', new Date(selection.from).toISOString());
    params.set('to', new Date(selection.to).toISOString());
  }
  return params.toString();
}

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Tek satırda ön ayarlı zaman aralığı seçici; özel aralık ince bir çizginin altında açılır. */
export function RangePicker({ value, onChange }: { value: RangeSelection; onChange: (next: RangeSelection) => void }) {
  const [customOpen, setCustomOpen] = useState(value.range === 'custom');
  const [from, setFrom] = useState(() => (value.from ? toLocalInput(new Date(value.from)) : toLocalInput(new Date(new Date().getTime() - 24 * 3_600_000))));
  const [to, setTo] = useState(() => (value.to ? toLocalInput(new Date(value.to)) : toLocalInput(new Date())));
  const invalid = new Date(from) >= new Date(to);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Zaman aralığı">
        {RANGE_PRESETS.map((preset) => {
          const selected = value.range === preset.key;
          return (
            <button
              key={preset.key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                setCustomOpen(false);
                onChange({ range: preset.key });
              }}
              className={cn('inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors hover:bg-muted', selected ? 'border-brand/50 bg-brand/10 font-medium' : 'border-border text-muted-foreground')}
            >
              {selected && <Check className="size-4" strokeWidth={3} aria-hidden />}
              {preset.label}
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={value.range === 'custom'}
          onClick={() => setCustomOpen((open) => !open)}
          className={cn('inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors hover:bg-muted', value.range === 'custom' ? 'border-brand/50 bg-brand/10 font-medium' : 'border-border text-muted-foreground')}
        >
          {value.range === 'custom' && <Check className="size-4" strokeWidth={3} aria-hidden />}
          Özel aralık
        </button>
      </div>
      {customOpen && (
        <form
          className="flex flex-wrap items-end gap-2 border-t border-border pt-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (invalid) return;
            onChange({ range: 'custom', from: new Date(from).toISOString(), to: new Date(to).toISOString() });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="range-from" className="text-xs">
              Başlangıç
            </Label>
            <Input id="range-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-52" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="range-to" className="text-xs">
              Bitiş
            </Label>
            <Input id="range-to" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-52" aria-invalid={invalid} />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={invalid}>
            Uygula
          </Button>
          {invalid && <span className="text-xs text-destructive">Bitiş, başlangıçtan sonra olmalı.</span>}
        </form>
      )}
    </div>
  );
}
