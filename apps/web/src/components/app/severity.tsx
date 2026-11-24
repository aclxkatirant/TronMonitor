import { CircleAlert, Info, OctagonAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CHECK_STATUS_LABELS, INCIDENT_STATUS_LABELS, type CheckStatus, type IncidentSeverity, type IncidentStatus } from '@/lib/types';

const SEVERITY: Record<IncidentSeverity, { label: string; className: string; Icon: typeof Info }> = {
  INFO: { label: 'Bilgi', className: 'text-brand', Icon: Info },
  WARNING: { label: 'Uyarı', className: 'text-status-warn', Icon: CircleAlert },
  CRITICAL: { label: 'Kritik', className: 'text-status-error', Icon: OctagonAlert },
};

/** Önem derecesi: simge + etiket (renk tek başına anlam taşımaz). */
export function SeverityBadge({ severity, className }: { severity: IncidentSeverity; className?: string }) {
  const s = SEVERITY[severity];
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm', s.className, className)}>
      <s.Icon className="size-3.5" aria-hidden /> {s.label}
    </span>
  );
}

const INCIDENT_STATUS_COLOR: Record<IncidentStatus, string> = { OPEN: 'bg-status-error', ACKNOWLEDGED: 'bg-status-warn', RESOLVED: 'bg-status-ok' };

export function IncidentStatusBadge({ status, className }: { status: IncidentStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', className)}>
      <span className={cn('size-2 shrink-0 rounded-full', INCIDENT_STATUS_COLOR[status])} aria-hidden />
      {INCIDENT_STATUS_LABELS[status]}
    </span>
  );
}

const CHECK_STATUS_COLOR: Record<CheckStatus, string> = { UP: 'bg-status-ok', DOWN: 'bg-status-error', PENDING: 'bg-status-neutral' };

export function CheckStatusBadge({ status, className }: { status: CheckStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', className)}>
      <span className={cn('size-2 shrink-0 rounded-full', CHECK_STATUS_COLOR[status])} aria-hidden />
      {CHECK_STATUS_LABELS[status]}
    </span>
  );
}
