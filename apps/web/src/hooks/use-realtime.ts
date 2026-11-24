'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { RealtimeEvent } from '@/lib/types';

const MIN_RETRY_MS = 2_000;
const MAX_RETRY_MS = 30_000;

/** WebSocket adresi: aynı köken (/api/v1/ws); geliştirmede NEXT_PUBLIC_WS_URL ile değiştirilebilir. */
function resolveUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const override = process.env.NEXT_PUBLIC_WS_URL;
  if (override) return override;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/v1/ws`;
}

/**
 * Panoya gerçek zamanlı olayları bağlar. Olay geldiğinde ilgili sorgular geçersiz kılınır; böylece
 * ekranlar WebSocket olmadan da (yoklama ile) çalışmaya devam eder, bağlantı varken anında güncellenir.
 */
export function useRealtime(enabled = true): { connected: boolean } {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const retryRef = useRef(MIN_RETRY_MS);

  useEffect(() => {
    if (!enabled) return;
    const url = resolveUrl();
    if (!url) return;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(url);
      socket.onopen = () => {
        retryRef.current = MIN_RETRY_MS;
        setConnected(true);
      };
      socket.onmessage = (message) => {
        let event: RealtimeEvent;
        try {
          event = JSON.parse(String(message.data)) as RealtimeEvent;
        } catch {
          return;
        }
        void handleEvent(event);
      };
      socket.onclose = (closeEvent) => {
        setConnected(false);
        socket = null;
        // 4001/4003: yetki yok; yeniden denemek anlamsız.
        if (disposed || closeEvent.code === 4001 || closeEvent.code === 4003) return;
        timer = setTimeout(connect, retryRef.current);
        retryRef.current = Math.min(retryRef.current * 2, MAX_RETRY_MS);
      };
      socket.onerror = () => socket?.close();
    };

    const handleEvent = async (event: RealtimeEvent) => {
      const serverId = typeof event.payload.serverId === 'string' ? event.payload.serverId : null;
      switch (event.type) {
        case 'server.registered':
        case 'server.deleted':
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['servers'] }),
            queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
            queryClient.invalidateQueries({ queryKey: ['registration-tokens'] }),
          ]);
          break;
        case 'server.status':
        case 'server.updated':
        case 'agent.revoked':
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['servers'] }),
            queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
            serverId ? queryClient.invalidateQueries({ queryKey: ['server', serverId] }) : Promise.resolve(),
          ]);
          break;
        case 'server.metrics':
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['servers', 'list'] }),
            queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
            serverId ? queryClient.invalidateQueries({ queryKey: ['server', serverId] }) : Promise.resolve(),
          ]);
          break;
        default:
          break;
      }
    };

    connect();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, [enabled, queryClient]);

  return { connected };
}
