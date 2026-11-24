import { Radar } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Brand({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className="flex size-7 items-center justify-center rounded-md bg-brand/15 text-brand ring-1 ring-brand/30">
        <Radar className="size-4" aria-hidden />
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className="block text-sm font-semibold tracking-tight">TronMonitor</span>
          <span className="block text-[11px] text-muted-foreground">Tüm altyapınız, tek merkezde.</span>
        </span>
      )}
    </div>
  );
}
