const dateTimeFormatter = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const relativeFormatter = new Intl.RelativeTimeFormat('tr-TR', { numeric: 'auto' });

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormatter.format(date);
}

export function formatRelative(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return relativeFormatter.format(diffSeconds, 'second');
  if (abs < 3600) return relativeFormatter.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86400) return relativeFormatter.format(Math.round(diffSeconds / 3600), 'hour');
  return relativeFormatter.format(Math.round(diffSeconds / 86400), 'day');
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** Bayt değerini okunabilir biçime çevirir (ikili çarpan, 1 ondalık). */
export function formatBytes(value: number | string | bigint | null | undefined, decimals = 1): string {
  if (value === null || value === undefined) return '—';
  let bytes = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let unit = 0;
  while (bytes >= 1024 && unit < BYTE_UNITS.length - 1) {
    bytes /= 1024;
    unit += 1;
  }
  return `${bytes.toLocaleString('tr-TR', { maximumFractionDigits: unit === 0 ? 0 : decimals })} ${BYTE_UNITS[unit]}`;
}

/** Bayt/sn değerini okunabilir hıza çevirir. */
export function formatRate(bytesPerSec: number | null | undefined): string {
  if (bytesPerSec === null || bytesPerSec === undefined) return '—';
  return `${formatBytes(bytesPerSec)}/sn`;
}

export function formatPercent(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `%${value.toLocaleString('tr-TR', { maximumFractionDigits: decimals, minimumFractionDigits: 0 })}`;
}

/** Saniye cinsinden süreyi "3 gün 4 sa 12 dk" biçimine çevirir. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} gün`);
  if (hours > 0 || days > 0) parts.push(`${hours} sa`);
  parts.push(`${minutes} dk`);
  return parts.join(' ');
}

/** Tarayıcı kimliği dizesinden kısa, okunabilir bir ad üretir. */
export function describeUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Bilinmeyen istemci';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Firefox\//.test(userAgent)
          ? 'Firefox'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : 'Tarayıcı';
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Mac OS/.test(userAgent)
      ? 'macOS'
      : /Linux/.test(userAgent)
        ? 'Linux'
        : /Android/.test(userAgent)
          ? 'Android'
          : /iPhone|iPad/.test(userAgent)
            ? 'iOS'
            : '';
  return os ? `${browser} · ${os}` : browser;
}
