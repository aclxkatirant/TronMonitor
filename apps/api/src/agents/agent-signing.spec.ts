import { canonicalString, isNonceWellFormed, isTimestampFresh, signRequest, verifySignature } from './agent-signing';

// Bu vektörler Go ajanındaki testlerle (agent/internal/api/signing_test.go) birebir aynıdır.
const SECRET = 'test-secret-0123456789abcdef';
const INPUT = {
  method: 'post',
  requestUri: '/api/v1/agents/heartbeat',
  timestamp: '1700000000',
  nonce: '00112233445566778899aabbccddeeff',
  body: '{"agentVersion":"0.1.0"}',
};
const BODY_SHA256 = '823338520cbfd5119f23c8b64ce5539dd787a11922d6ce6f8c8381108f467749';
const EXPECTED_SIGNATURE = '81a948ff3d96d5f06c43f0b8ac4f79eecf27057b850ed31754836d71dadf65aa';

describe('ajan imzalama', () => {
  it('kanonik dizeyi sabit biçimde üretir', () => {
    expect(canonicalString(INPUT)).toBe(`POST\n/api/v1/agents/heartbeat\n1700000000\n00112233445566778899aabbccddeeff\n${BODY_SHA256}`);
  });

  it('bilinen vektörle eşleşir ve sırra bağlıdır', () => {
    expect(signRequest(SECRET, INPUT)).toBe(EXPECTED_SIGNATURE);
    expect(signRequest('baska-sir', INPUT)).not.toBe(EXPECTED_SIGNATURE);
    expect(verifySignature(SECRET, INPUT, EXPECTED_SIGNATURE)).toBe(true);
    expect(verifySignature(SECRET, INPUT, EXPECTED_SIGNATURE.toUpperCase())).toBe(true);
  });

  it('gövde, yol veya nonce değişirse imza geçersiz olur', () => {
    expect(verifySignature(SECRET, { ...INPUT, body: '{"agentVersion":"0.1.1"}' }, EXPECTED_SIGNATURE)).toBe(false);
    expect(verifySignature(SECRET, { ...INPUT, requestUri: '/api/v1/agents/metrics' }, EXPECTED_SIGNATURE)).toBe(false);
    expect(verifySignature(SECRET, { ...INPUT, nonce: 'ffffffffffffffffffffffffffffffff' }, EXPECTED_SIGNATURE)).toBe(false);
    expect(verifySignature(SECRET, INPUT, 'gecersiz')).toBe(false);
  });

  it('zaman damgası tazeliğini denetler (±300 sn)', () => {
    const now = 1_700_000_000_000;
    expect(isTimestampFresh('1700000000', now)).toBe(true);
    expect(isTimestampFresh('1699999700', now)).toBe(true);
    expect(isTimestampFresh('1699999600', now)).toBe(false);
    expect(isTimestampFresh('1700000400', now)).toBe(false);
    expect(isTimestampFresh('abc', now)).toBe(false);
    expect(isTimestampFresh('', now)).toBe(false);
  });

  it('nonce biçimini denetler', () => {
    expect(isNonceWellFormed('00112233445566778899aabbccddeeff')).toBe(true);
    expect(isNonceWellFormed('0011')).toBe(false);
    expect(isNonceWellFormed('zz112233445566778899aabbccddeeff')).toBe(false);
  });
});
