// Package config ajan yapılandırmasını (sunucu adresi, kimlik bilgileri, aralıklar) diskte saklar.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Config ajanın kalıcı yapılandırmasıdır. Secret alanı yalnızca bu dosyada bulunur; dosya 0600 izinlidir.
type Config struct {
	ServerURL             string `json:"serverUrl"`
	AgentID               string `json:"agentId"`
	ServerID              string `json:"serverId"`
	ServerName            string `json:"serverName"`
	KeyID                 string `json:"keyId"`
	Secret                string `json:"secret"`
	CollectionIntervalSec int    `json:"collectionIntervalSec"`
	HeartbeatIntervalSec  int    `json:"heartbeatIntervalSec"`
	CAFile                string `json:"caFile,omitempty"`
	AllowHTTP             bool   `json:"allowHttp,omitempty"`
	LogLevel              string `json:"logLevel,omitempty"`
	// DisableTerminal true ise merkezden gelen web terminali istekleri reddedilir.
	DisableTerminal bool `json:"disableTerminal,omitempty"`
}

// ErrNotRegistered yapılandırma dosyası bulunmadığında döner.
var ErrNotRegistered = errors.New("ajan henüz kaydedilmemiş; önce 'register' komutunu çalıştırın")

// DefaultDir platforma göre yapılandırma dizinini döndürür.
func DefaultDir() string {
	if runtime.GOOS == "windows" {
		base := os.Getenv("ProgramData")
		if base == "" {
			base = `C:\ProgramData`
		}
		return filepath.Join(base, "TronMonitor", "Agent")
	}
	return "/etc/tronmonitor"
}

// DefaultPath varsayılan yapılandırma dosyası yolunu döndürür.
func DefaultPath() string {
	return filepath.Join(DefaultDir(), "agent.json")
}

// DefaultLogDir platforma göre günlük dizinini döndürür.
func DefaultLogDir() string {
	if runtime.GOOS == "windows" {
		return filepath.Join(DefaultDir(), "logs")
	}
	return "/var/log/tronmonitor"
}

// Load yapılandırmayı okur ve doğrular.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrNotRegistered
		}
		return nil, fmt.Errorf("yapılandırma okunamadı (%s): %w", path, err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("yapılandırma çözümlenemedi (%s): %w", path, err)
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	cfg.applyDefaults()
	return &cfg, nil
}

// Save yapılandırmayı 0600 izinle yazar; dizin yoksa oluşturur. Yazma atomik yapılır (geçici dosya + rename).
func Save(path string, cfg *Config) error {
	if err := cfg.Validate(); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("yapılandırma dizini oluşturulamadı: %w", err)
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("yapılandırma yazılamadı: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("yapılandırma yazılamadı: %w", err)
	}
	return nil
}

// Validate temel tutarlılık denetimleri yapar.
func (c *Config) Validate() error {
	if err := ValidateServerURL(c.ServerURL, c.AllowHTTP); err != nil {
		return err
	}
	if c.KeyID == "" || c.Secret == "" {
		return errors.New("ajan kimlik bilgileri eksik")
	}
	if c.AgentID == "" || c.ServerID == "" {
		return errors.New("ajan veya sunucu kimliği eksik")
	}
	return nil
}

func (c *Config) applyDefaults() {
	if c.CollectionIntervalSec <= 0 {
		c.CollectionIntervalSec = 15
	}
	if c.HeartbeatIntervalSec <= 0 {
		c.HeartbeatIntervalSec = 30
	}
	if c.LogLevel == "" {
		c.LogLevel = "info"
	}
}

// ValidateServerURL sunucu adresinin biçimini ve şema politikasını denetler.
// HTTPS zorunludur; düz HTTP yalnızca açıkça izin verildiğinde kabul edilir.
func ValidateServerURL(raw string, allowHTTP bool) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return fmt.Errorf("sunucu adresi geçersiz: %q", raw)
	}
	switch u.Scheme {
	case "https":
		return nil
	case "http":
		if allowHTTP {
			return nil
		}
		return errors.New("sunucu adresi HTTPS olmalıdır; yalnızca test ortamında --allow-http ile düz HTTP kullanılabilir")
	default:
		return fmt.Errorf("desteklenmeyen şema: %q", u.Scheme)
	}
}

// Redacted sır olmadan yapılandırma özetini döndürür.
func (c *Config) Redacted() map[string]any {
	return map[string]any{
		"serverUrl":             c.ServerURL,
		"agentId":               c.AgentID,
		"serverId":              c.ServerID,
		"serverName":            c.ServerName,
		"keyId":                 c.KeyID,
		"collectionIntervalSec": c.CollectionIntervalSec,
		"heartbeatIntervalSec":  c.HeartbeatIntervalSec,
		"caFile":                c.CAFile,
		"allowHttp":             c.AllowHTTP,
	}
}
