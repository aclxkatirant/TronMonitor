import { spawn } from 'node:child_process';
import net from 'node:net';
import tls from 'node:tls';
import { CheckType } from '../generated/prisma/client';

export interface RunnableCheck {
  type: CheckType;
  target: string;
  port: number | null;
  method: string | null;
  expectedStatusCode: number | null;
  timeoutSec: number;
  retryCount: number;
  sslExpiryWarnDays: number | null;
}

export interface CheckOutcome {
  isUp: boolean;
  responseTimeMs: number | null;
  statusCode: number | null;
  errorMessage: string | null;
  sslExpiresAt: Date | null;
  attempts: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Hedef adresin yerel/özel ağa işaret edip etmediğine bakılmaz; kontroller yöneticinin kendi altyapısı içindir. */
export function validateTarget(type: CheckType, target: string, port: number | null): string | null {
  if (type === CheckType.HTTP || type === CheckType.HTTPS) {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      return 'Hedef geçerli bir adres olmalıdır (ör. https://ornek.com/saglik).';
    }
    if (type === CheckType.HTTP && url.protocol !== 'http:') return 'HTTP kontrolü için adres http:// ile başlamalıdır.';
    if (type === CheckType.HTTPS && url.protocol !== 'https:') return 'HTTPS kontrolü için adres https:// ile başlamalıdır.';
    return null;
  }
  if (!/^[A-Za-z0-9.\-:[\]]+$/.test(target) || target.length > 253) return 'Hedef bir ana makine adı veya IP adresi olmalıdır.';
  if (type === CheckType.TCP && !port) return 'TCP kontrolü için port gereklidir.';
  return null;
}

async function runHttp(check: RunnableCheck): Promise<CheckOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), check.timeoutSec * 1000);
  const started = process.hrtime.bigint();
  try {
    const response = await fetch(check.target, {
      method: check.method ?? 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'TronMonitor-UptimeCheck/1.0' },
    });
    // Gövde okunmaz; bağlantı serbest bırakılır.
    await response.body?.cancel();
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    const ok = check.expectedStatusCode ? response.status === check.expectedStatusCode : response.status >= 200 && response.status < 400;
    return {
      isUp: ok,
      responseTimeMs: Math.round(elapsed),
      statusCode: response.status,
      errorMessage: ok ? null : `Beklenmeyen HTTP durumu: ${response.status}${check.expectedStatusCode ? ` (beklenen ${check.expectedStatusCode})` : ''}`,
      sslExpiresAt: null,
      attempts: 1,
    };
  } catch (error) {
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    const message = error instanceof Error ? (error.name === 'AbortError' ? `Zaman aşımı (${check.timeoutSec} sn)` : describeFetchError(error)) : String(error);
    return { isUp: false, responseTimeMs: Math.round(elapsed), statusCode: null, errorMessage: message, sslExpiresAt: null, attempts: 1 };
  } finally {
    clearTimeout(timer);
  }
}

function describeFetchError(error: Error): string {
  const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
  if (cause?.code) {
    const map: Record<string, string> = {
      ENOTFOUND: 'Ana makine adı çözümlenemedi',
      ECONNREFUSED: 'Bağlantı reddedildi',
      ECONNRESET: 'Bağlantı sıfırlandı',
      ETIMEDOUT: 'Bağlantı zaman aşımına uğradı',
      CERT_HAS_EXPIRED: 'SSL sertifikasının süresi dolmuş',
      DEPTH_ZERO_SELF_SIGNED_CERT: 'Kendinden imzalı SSL sertifikası',
      UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'SSL sertifikası doğrulanamadı',
      ERR_TLS_CERT_ALTNAME_INVALID: 'SSL sertifikası bu ana makine adı için geçerli değil',
    };
    return map[cause.code] ?? `${cause.code}: ${cause.message ?? error.message}`;
  }
  return error.message;
}

function runTcp(host: string, port: number, timeoutSec: number): Promise<CheckOutcome> {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const socket = net.connect({ host, port });
    const finish = (isUp: boolean, errorMessage: string | null) => {
      const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
      socket.destroy();
      resolve({ isUp, responseTimeMs: Math.round(elapsed), statusCode: null, errorMessage, sslExpiresAt: null, attempts: 1 });
    };
    socket.setTimeout(timeoutSec * 1000);
    socket.once('connect', () => finish(true, null));
    socket.once('timeout', () => finish(false, `Zaman aşımı (${timeoutSec} sn)`));
    socket.once('error', (error: NodeJS.ErrnoException) => finish(false, error.code === 'ECONNREFUSED' ? 'Bağlantı reddedildi' : error.code === 'ENOTFOUND' ? 'Ana makine adı çözümlenemedi' : error.message));
  });
}

function runIcmp(host: string, timeoutSec: number): Promise<CheckOutcome> {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const args = isWindows ? ['-n', '1', '-w', String(timeoutSec * 1000), host] : ['-c', '1', '-W', String(timeoutSec), host];
    const started = process.hrtime.bigint();
    let output = '';
    let settled = false;
    const child = spawn('ping', args, { windowsHide: true });
    const killer = setTimeout(() => {
      if (!settled) child.kill();
    }, (timeoutSec + 2) * 1000);
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', (error) => {
      settled = true;
      clearTimeout(killer);
      resolve({ isUp: false, responseTimeMs: null, statusCode: null, errorMessage: `ping çalıştırılamadı: ${error.message}`, sslExpiresAt: null, attempts: 1 });
    });
    child.on('close', (code) => {
      settled = true;
      clearTimeout(killer);
      const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
      // Windows'ta "Destination host unreachable" çıkış kodu 0 döndürebilir; yanıt satırı aranır.
      const replied = /(?:time|süre|zaman|tiempo|temps)\s*[=<]\s*(\d+(?:[.,]\d+)?)\s*ms/i.exec(output);
      const unreachable = /unreachable|erişilemiyor|ula[şs]ılam/i.test(output);
      const isUp = code === 0 && !!replied && !unreachable;
      const rtt = replied ? Math.round(parseFloat(replied[1].replace(',', '.'))) : Math.round(elapsed);
      resolve({
        isUp,
        responseTimeMs: isUp ? rtt : null,
        statusCode: null,
        errorMessage: isUp ? null : code === 0 ? 'Hedef yanıt vermedi' : `ping başarısız (çıkış kodu ${code})`,
        sslExpiresAt: null,
        attempts: 1,
      });
    });
  });
}

/** HTTPS hedefinin sertifika bitiş tarihini okur. Hata durumunda null döner; erişilebilirlik sonucunu etkilemez. */
export function readCertificateExpiry(target: string, timeoutSec: number): Promise<Date | null> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      resolve(null);
      return;
    }
    const port = url.port ? Number(url.port) : 443;
    const socket = tls.connect({ host: url.hostname, port, servername: url.hostname, rejectUnauthorized: false, timeout: timeoutSec * 1000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      const validTo = cert && typeof cert.valid_to === 'string' ? new Date(cert.valid_to) : null;
      resolve(validTo && !Number.isNaN(validTo.getTime()) ? validTo : null);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(null);
    });
    socket.once('error', () => resolve(null));
  });
}

async function runOnce(check: RunnableCheck): Promise<CheckOutcome> {
  switch (check.type) {
    case CheckType.HTTP:
    case CheckType.HTTPS:
      return runHttp(check);
    case CheckType.TCP:
      return runTcp(check.target, check.port ?? 0, check.timeoutSec);
    case CheckType.ICMP:
      return runIcmp(check.target, check.timeoutSec);
    default:
      return { isUp: false, responseTimeMs: null, statusCode: null, errorMessage: 'Desteklenmeyen kontrol türü', sslExpiresAt: null, attempts: 1 };
  }
}

/**
 * Kontrolü çalıştırır; başarısızlıkta retryCount kadar yeniden dener (yanlış pozitifleri azaltmak için).
 * HTTPS kontrollerinde sertifika bitiş tarihi ayrıca okunur.
 */
export async function runCheck(check: RunnableCheck): Promise<CheckOutcome> {
  let outcome = await runOnce(check);
  let attempts = 1;
  while (!outcome.isUp && attempts <= check.retryCount) {
    await sleep(1000);
    outcome = await runOnce(check);
    attempts += 1;
  }
  outcome.attempts = attempts;
  if (check.type === CheckType.HTTPS && check.sslExpiryWarnDays) {
    outcome.sslExpiresAt = await readCertificateExpiry(check.target, check.timeoutSec);
  }
  return outcome;
}
