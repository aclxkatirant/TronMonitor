package api

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// Başlık adları; arka uçtaki agent-signing.ts ile aynıdır.
const (
	HeaderKey       = "X-Agent-Key"
	HeaderTimestamp = "X-Agent-Timestamp"
	HeaderNonce     = "X-Agent-Nonce"
	HeaderSignature = "X-Agent-Signature"
)

// CanonicalString imzalanacak kanonik dizeyi üretir:
// METHOD \n requestUri \n timestamp \n nonce \n sha256hex(body)
func CanonicalString(method, requestURI, timestamp, nonce string, body []byte) string {
	bodyHash := sha256.Sum256(body)
	return strings.Join([]string{
		strings.ToUpper(method),
		requestURI,
		timestamp,
		nonce,
		hex.EncodeToString(bodyHash[:]),
	}, "\n")
}

// Sign kanonik dizeyi HMAC-SHA256 ile imzalar ve hex döndürür.
func Sign(secret, method, requestURI, timestamp, nonce string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(CanonicalString(method, requestURI, timestamp, nonce, body)))
	return hex.EncodeToString(mac.Sum(nil))
}

// NewNonce 16 baytlık rastgele nonce üretir (hex).
func NewNonce() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
