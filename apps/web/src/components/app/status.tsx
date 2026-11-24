import { cn } from '@/lib/utils';
import { AGENT_STATUS_LABELS, SERVER_STATUS_LABELS, type AgentStatus, type ServerStatus } from '@/lib/types';

const SERVER_STATUS_COLOR: Record<ServerStatus, string> = {
  ONLINE: 'bg-status-ok',
  OFFLINE: 'bg-status-error',
  DEGRADED: 'bg-status-warn',
  PENDING: 'bg-status-neutral',
};

const AGENT_STATUS_COLOR: Record<AgentStatus, string> = {
  CONNECTED: 'bg-status-ok',
  DISCONNECTED: 'bg-status-error',
  REVOKED: 'bg-status-error',
  NEVER_CONNECTED: 'bg-status-neutral',
};

export function ServerStatusBadge({ status, className }: { status: ServerStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', className)}>
      <span className={cn('size-2 shrink-0 rounded-full', SERVER_STATUS_COLOR[status])} aria-hidden />
      {SERVER_STATUS_LABELS[status]}
    </span>
  );
}

export function AgentStatusBadge({ status, className }: { status: AgentStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', className)}>
      <span className={cn('size-2 shrink-0 rounded-full', AGENT_STATUS_COLOR[status])} aria-hidden />
      {AGENT_STATUS_LABELS[status]}
    </span>
  );
}

/** Yüzde kullanım çubuğu; eşiklere göre renk değiştirir (70 uyarı, 90 kritik). */
export function UsageMeter({ value, label, className }: { value: number | null | undefined; label?: string; className?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className={cn('text-sm text-muted-foreground', className)}>—</span>;
  }
  const clamped = Math.max(0, Math.min(100, value));
  const color = clamped >= 90 ? 'bg-status-error' : clamped >= 70 ? 'bg-status-warn' : 'bg-brand';
  return (
    <span className={cn('inline-flex items-center gap-2', className)} title={label}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={cn('block h-full rounded-full', color)} style={{ width: `${clamped}%` }} />
      </span>
      <span className="w-10 text-right text-sm tabular-nums">%{Math.round(clamped)}</span>
    </span>
  );
}

export function ColorDot({ color, className }: { color: string | null | undefined; className?: string }) {
  return <span className={cn('inline-block size-2 rounded-full', className)} style={{ backgroundColor: color ?? 'var(--status-neutral)' }} aria-hidden />;
}
