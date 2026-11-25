export interface TerminalBackend {
  write(data: Buffer | string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

export interface TerminalBackendHandlers {
  onData: (data: Buffer) => void;
  /** reason null ise kabuk normal kapandı. */
  onClose: (reason: string | null) => void;
}

/** Tarayıcıdan gelen denetim mesajları (JSON metin çerçeveleri). */
export type BrowserMessage =
  | { type: 'open'; serverId: string; protocol?: 'SSH' | 'AGENT'; cols?: number; rows?: number }
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'close' };

/** Ajandan gelen denetim mesajları; terminal verisi ikili çerçevelerle taşınır. */
export type AgentMessage = { type: 'ready' } | { type: 'exit'; code?: number; message?: string } | { type: 'error'; message: string };

export const TERMINAL_LIMITS = {
  maxSessionsPerUser: 3,
  idleTimeoutMs: 15 * 60_000,
  maxDurationMs: 4 * 60 * 60_000,
  agentAttachTimeoutMs: 40_000,
  minCols: 20,
  maxCols: 500,
  minRows: 5,
  maxRows: 200,
} as const;

export function clampSize(cols: number | undefined, rows: number | undefined): { cols: number; rows: number } {
  const c = Number.isFinite(cols) ? Math.min(TERMINAL_LIMITS.maxCols, Math.max(TERMINAL_LIMITS.minCols, Math.floor(cols!))) : 120;
  const r = Number.isFinite(rows) ? Math.min(TERMINAL_LIMITS.maxRows, Math.max(TERMINAL_LIMITS.minRows, Math.floor(rows!))) : 32;
  return { cols: c, rows: r };
}
