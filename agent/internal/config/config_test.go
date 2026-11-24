package config

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func sample() *Config {
	return &Config{
		ServerURL: "https://tron.example.com",
		AgentID:   "a1",
		ServerID:  "s1",
		KeyID:     "tma_00112233445566778899aabbccddeeff",
		Secret:    "gizli",
	}
}

func TestSaveAndLoad(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "agent.json")
	cfg := sample()
	if err := Save(path, cfg); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("dosya izni 0600 olmalı, %o", info.Mode().Perm())
		}
	}
	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded.KeyID != cfg.KeyID || loaded.Secret != cfg.Secret {
		t.Fatalf("yüklenen yapılandırma eşleşmiyor: %+v", loaded)
	}
	if loaded.CollectionIntervalSec != 15 || loaded.HeartbeatIntervalSec != 30 {
		t.Fatalf("varsayılan aralıklar uygulanmadı: %+v", loaded)
	}
}

func TestLoadMissing(t *testing.T) {
	_, err := Load(filepath.Join(t.TempDir(), "yok.json"))
	if !errors.Is(err, ErrNotRegistered) {
		t.Fatalf("ErrNotRegistered bekleniyordu, %v", err)
	}
}

func TestValidateServerURL(t *testing.T) {
	cases := []struct {
		url   string
		allow bool
		ok    bool
	}{
		{"https://tron.example.com", false, true},
		{"http://127.0.0.1:4000", false, false},
		{"http://127.0.0.1:4000", true, true},
		{"ftp://x", true, false},
		{"", true, false},
		{"tron.example.com", false, false},
	}
	for _, c := range cases {
		err := ValidateServerURL(c.url, c.allow)
		if (err == nil) != c.ok {
			t.Errorf("%q allow=%v: beklenen ok=%v, hata=%v", c.url, c.allow, c.ok, err)
		}
	}
}

func TestRedactedHidesSecret(t *testing.T) {
	r := sample().Redacted()
	if _, found := r["secret"]; found {
		t.Fatal("Redacted sırrı içermemeli")
	}
}
