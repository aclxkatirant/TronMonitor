import { createHmac } from 'node:crypto';
import { constantTimeEquals, sha256 } from '../common/crypto';

/**
 * Ajan isteklerinin imzalanma protokolü. Go ajanındaki uygulama ile birebir aynı olmalıdır.
 *
 * Başlıklar:
 *   X-Agent-Key        keyId
 *   X-Agent-Timestamp  Unix saniye
 *   X-Agent-Nonce      en az 16 bayt rastgele değer (hex)
 *   X-Agent-Signature  hex(HMAC-SHA256(secret, canonical))
 *
 * canonical = METHOD + "\n" + requestUri + "\n" + timestamp + "\n" + nonce + "\n" + sha256hex(body)
 */
export const AGENT_HEADERS = {
  KEY: 'x-agent-key',
  TIMESTAMP: 'x-agent-timestamp',
  NONCE: 'x-agent-nonce',
  SIGNATURE: 'x-agent-signature',
} as const;

export const AGENT_TIMESTAMP_SKEW_SECONDS = 300;
export const AGENT_NONCE_TTL_SECONDS = 600;

export interface SignatureInput {
  method: string;
  requestUri: string;
  timestamp: string;
  nonce: string;
  body: Buffer | string;
}

export function canonicalString(input: SignatureInput): string {
  const bodyHash = sha256(typeof input.body === 'string' ? input.body : input.body.toString('utf8'));
  return [input.method.toUpperCase(), input.requestUri, input.timestamp, input.nonce, bodyHash].join('\n');
}

export function signRequest(secret: string, input: SignatureInput): string {
  return createHmac('sha256', secret).update(canonicalString(input)).digest('hex');
}

export function verifySignature(secret: string, input: SignatureInput, signature: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  return constantTimeEquals(signRequest(secret, input), signature.toLowerCase());
}

export function isTimestampFresh(timestamp: string, now = Date.now()): boolean {
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const seconds = Number(timestamp);
  return Math.abs(now / 1000 - seconds) <= AGENT_TIMESTAMP_SKEW_SECONDS;
}

export function isNonceWellFormed(nonce: string): boolean {
  return /^[0-9a-f]{32,64}$/i.test(nonce);
}
