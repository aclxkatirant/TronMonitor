'use client';

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { terminalSocketUrl } from '@/hooks/use-terminal';

export interface TerminalTarget {
  /** Her yeni bağlantı denemesi için artan anahtar. */
  key: number;
  serverId: string;
  protocol?: 'SSH' | 'AGENT';
}

export type TerminalEvent =
  | { type: 'connecting'; message: string }
  | { type: 'ready'; sessionId: string; protocol: string }
  | { type: 'error'; code: string | null; message: string }
  | { type: 'exit'; status: string; statusLabel: string; reason: string | null; code: string | null }
  | { type: 'disconnected' };

const THEME = {
  background: '#0b0f14',
  foreground: '#e6edf3',
  cursor: '#e6edf3',
  cursorAccent: '#0b0f14',
  selectionBackground: 'rgba(96, 165, 250, 0.35)',
  black: '#1f2937',
  brightBlack: '#6b7280',
  red: '#f87171',
  brightRed: '#fca5a5',
  green: '#4ade80',
  brightGreen: '#86efac',
  yellow: '#facc15',
  brightYellow: '#fde047',
  blue: '#60a5fa',
  brightBlue: '#93c5fd',
  magenta: '#c084fc',
  brightMagenta: '#d8b4fe',
  cyan: '#22d3ee',
  brightCyan: '#67e8f9',
  white: '#e5e7eb',
  brightWhite: '#f9fafb',
};

/**
 * xterm.js tabanlı terminal. `target` değiştiğinde WebSocket açılır, `open` mesajı gönderilir; kabuk
 * çıktısı ikili çerçevelerle gelir, klavye girdisi JSON `input` mesajıyla gider. Bileşen yalnızca
 * istemcide yüklenmelidir (next/dynamic, ssr: false).
 */
export function TerminalView({ target, onEvent }: { target: TerminalTarget | null; onEvent: (event: TerminalEvent) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  // Terminal örneği bir kez oluşturulur.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const term = new Terminal({ cursorBlink: true, fontFamily: 'ui-monospace, "Cascadia Mono", "JetBrains Mono", Menlo, Consolas, monospace', fontSize: 13, lineHeight: 1.2, theme: THEME, scrollback: 5000, allowProposedApi: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.writeln('\x1b[90mBir sunucu seçip "Bağlan" düğmesine basın.\x1b[0m');
    termRef.current = term;
    fitRef.current = fit;
    // open() bir sonraki karede yapılır: React geliştirme modunda efektler iki kez koşar ve hemen
    // dispose edilen bir terminalin bekleyen çizim karesi xterm içinde hata üretir.
    const frame = requestAnimationFrame(() => {
      term.open(container);
      fit.fit();
    });

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // kapsayıcı görünür değilken ölçüm başarısız olabilir
      }
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    });
    observer.observe(container);
    const disposable = term.onData((data) => {
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }));
    });
    return () => {
      cancelAnimationFrame(frame);
      disposable.dispose();
      observer.disconnect();
      socketRef.current?.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Hedef değiştiğinde bağlantı kurulur.
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!target || !term || !fit) return;
    const url = terminalSocketUrl();
    if (!url) return;
    socketRef.current?.close();
    term.reset();
    fit.fit();
    term.writeln(`\x1b[90mBağlanılıyor…\x1b[0m`);
    onEventRef.current({ type: 'connecting', message: 'Bağlanılıyor…' });

    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;
    let ended = false;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'open', serverId: target.serverId, protocol: target.protocol, cols: term.cols, rows: term.rows }));
    };
    socket.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
        return;
      }
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'status':
          term.writeln(`\x1b[90m${String(msg.message ?? '')}\x1b[0m`);
          onEventRef.current({ type: 'connecting', message: String(msg.message ?? '') });
          break;
        case 'ready':
          term.focus();
          onEventRef.current({ type: 'ready', sessionId: String(msg.sessionId), protocol: String(msg.protocol) });
          break;
        case 'error':
          ended = true;
          term.writeln(`\r\n\x1b[31m${String(msg.message ?? 'Hata')}\x1b[0m`);
          onEventRef.current({ type: 'error', code: (msg.code as string | null) ?? null, message: String(msg.message ?? 'Hata') });
          break;
        case 'exit':
          ended = true;
          term.writeln(`\r\n\x1b[33m[Oturum sona erdi: ${String(msg.statusLabel ?? msg.status)}${msg.reason ? ` — ${String(msg.reason)}` : ''}]\x1b[0m`);
          onEventRef.current({ type: 'exit', status: String(msg.status), statusLabel: String(msg.statusLabel ?? ''), reason: (msg.reason as string | null) ?? null, code: (msg.code as string | null) ?? null });
          break;
      }
    };
    socket.onclose = () => {
      if (socketRef.current === socket) socketRef.current = null;
      if (!ended) {
        term.writeln('\r\n\x1b[33m[Bağlantı kapandı]\x1b[0m');
        onEventRef.current({ type: 'disconnected' });
      }
    };
    socket.onerror = () => undefined;

    return () => {
      socket.close();
    };
  }, [target]);

  return <div ref={containerRef} className="h-full min-h-[360px] w-full overflow-hidden rounded-md bg-[#0b0f14] p-2" />;
}
