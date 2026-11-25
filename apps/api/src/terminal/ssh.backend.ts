import { createHash } from 'node:crypto';
import { Client, type ClientChannel } from 'ssh2';
import type { TerminalBackend, TerminalBackendHandlers } from './terminal.types';

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  /** Kayıtlı parmak izi; null ise ilk bağlantıda öğrenilir (TOFU). */
  expectedFingerprint: string | null;
}

export class SshHostKeyMismatchError extends Error {
  constructor(readonly actual: string) {
    super('host key mismatch');
  }
}

const READY_TIMEOUT_MS = 15_000;
const KEEPALIVE_MS = 15_000;

export function fingerprintOf(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

/**
 * ssh2 ile etkileşimli kabuk açar (PTY, xterm-256color). Sunucu anahtarı kayıtlı parmak iziyle
 * karşılaştırılır; ilk bağlantıda parmak izi `onFingerprint` ile bildirilir ve kaydedilir.
 */
export function connectSsh(target: SshTarget, cols: number, rows: number, handlers: TerminalBackendHandlers & { onFingerprint: (fp: string) => void }): Promise<TerminalBackend> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let stream: ClientChannel | null = null;
    let settled = false;
    let rejected = false;
    let learned: string | null = null;

    const fail = (error: Error) => {
      if (!settled) {
        settled = true;
        rejected = true;
        reject(error);
      } else if (!rejected) {
        // Kabuk açıldıktan sonraki hatalar oturumu kapatır; bağlantı aşamasında reddedilen bir
        // bağlantının ardından gelen ikincil 'error'/'end' olayları (ör. anahtar doğrulama sonrası) yok sayılır.
        handlers.onClose(error.message);
      }
      client.end();
    };

    client.on('ready', () => {
      if (learned) handlers.onFingerprint(learned);
      client.shell({ term: 'xterm-256color', cols, rows }, (error, channel) => {
        if (error) return fail(error);
        stream = channel;
        channel.on('data', (data: Buffer) => handlers.onData(data));
        channel.stderr.on('data', (data: Buffer) => handlers.onData(data));
        channel.on('close', () => {
          client.end();
          handlers.onClose(null);
        });
        settled = true;
        resolve({
          write: (data) => {
            if (stream && stream.writable) stream.write(data);
          },
          resize: (c, r) => stream?.setWindow(r, c, 0, 0),
          close: () => {
            stream?.end();
            client.end();
          },
        });
      });
    });
    client.on('error', (error: Error) => fail(error));
    client.on('end', () => {
      if (!settled) fail(new Error('connection closed'));
    });

    client.connect({
      host: target.host,
      port: target.port,
      username: target.username,
      password: target.password,
      privateKey: target.privateKey,
      passphrase: target.passphrase,
      readyTimeout: READY_TIMEOUT_MS,
      keepaliveInterval: KEEPALIVE_MS,
      keepaliveCountMax: 3,
      hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
        const actual = fingerprintOf(key);
        if (target.expectedFingerprint && target.expectedFingerprint !== actual) {
          // Önce özel hata kaydedilir; verify(false) ssh2'nin genel 'error' olayını eşzamanlı tetikler.
          fail(new SshHostKeyMismatchError(actual));
          verify(false);
          return;
        }
        if (!target.expectedFingerprint) learned = actual;
        verify(true);
      },
    });
  });
}
