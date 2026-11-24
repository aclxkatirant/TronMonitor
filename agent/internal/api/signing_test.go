package api

import "testing"

// Bu vektör apps/api/src/agents/agent-signing.spec.ts ile birebir aynıdır.
const (
	vectorSecret    = "test-secret-0123456789abcdef"
	vectorURI       = "/api/v1/agents/heartbeat"
	vectorTimestamp = "1700000000"
	vectorNonce     = "00112233445566778899aabbccddeeff"
	vectorBody      = `{"agentVersion":"0.1.0"}`
	vectorBodyHash  = "823338520cbfd5119f23c8b64ce5539dd787a11922d6ce6f8c8381108f467749"
	vectorSignature = "81a948ff3d96d5f06c43f0b8ac4f79eecf27057b850ed31754836d71dadf65aa"
)

func TestCanonicalString(t *testing.T) {
	got := CanonicalString("post", vectorURI, vectorTimestamp, vectorNonce, []byte(vectorBody))
	want := "POST\n" + vectorURI + "\n" + vectorTimestamp + "\n" + vectorNonce + "\n" + vectorBodyHash
	if got != want {
		t.Fatalf("kanonik dize eşleşmiyor:\n%q\n%q", got, want)
	}
}

func TestSignVector(t *testing.T) {
	got := Sign(vectorSecret, "POST", vectorURI, vectorTimestamp, vectorNonce, []byte(vectorBody))
	if got != vectorSignature {
		t.Fatalf("imza eşleşmiyor: %s", got)
	}
	if Sign("baska-sir", "POST", vectorURI, vectorTimestamp, vectorNonce, []byte(vectorBody)) == vectorSignature {
		t.Fatal("farklı sır aynı imzayı üretmemeli")
	}
	if Sign(vectorSecret, "POST", "/api/v1/agents/metrics", vectorTimestamp, vectorNonce, []byte(vectorBody)) == vectorSignature {
		t.Fatal("farklı yol aynı imzayı üretmemeli")
	}
}

func TestNewNonce(t *testing.T) {
	a, err := NewNonce()
	if err != nil {
		t.Fatal(err)
	}
	b, _ := NewNonce()
	if len(a) != 32 || a == b {
		t.Fatalf("nonce beklenen biçimde değil: %s %s", a, b)
	}
}
