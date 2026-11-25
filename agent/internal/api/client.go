// Package api merkezi TronMonitor arka ucuyla imzalı HTTP iletişimini sağlar.
package api

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aclxkatirant/TronMonitor/agent/internal/buildinfo"
)

const (
	apiPrefix        = "/api/v1"
	requestTimeout   = 30 * time.Second
	maxResponseBytes = 1 << 20
)

// APIError arka uçtan dönen yapılandırılmış hatayı taşır.
type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("%s (%d): %s", e.Code, e.Status, e.Message)
	}
	return fmt.Sprintf("HTTP %d", e.Status)
}

// IsRevoked kimlik bilgisinin kalıcı olarak iptal edildiğini belirtir.
func (e *APIError) IsRevoked() bool { return e.Code == "AGENT_CREDENTIAL_REVOKED" }

// IsAuthFailure kimlik doğrulama hatalarını (imza, zaman damgası, yeniden oynatma) belirtir.
func (e *APIError) IsAuthFailure() bool { return e.Status == http.StatusUnauthorized }

// Client imzalı istekler gönderen HTTP istemcisidir.
type Client struct {
	baseURL string
	keyID   string
	secret  string
	http    *http.Client
}

// Options istemci seçenekleri.
type Options struct {
	ServerURL string
	KeyID     string
	Secret    string
	CAFile    string
}

// New yeni bir istemci oluşturur. CAFile verilirse yalnızca o CA'ya güvenilir.
func New(opts Options) (*Client, error) {
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12}
	if opts.CAFile != "" {
		pem, err := os.ReadFile(opts.CAFile)
		if err != nil {
			return nil, fmt.Errorf("CA dosyası okunamadı: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return nil, errors.New("CA dosyasında geçerli sertifika bulunamadı")
		}
		tlsConfig.RootCAs = pool
	}
	transport := &http.Transport{
		TLSClientConfig:     tlsConfig,
		Proxy:               http.ProxyFromEnvironment,
		MaxIdleConns:        4,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
	}
	return &Client{
		baseURL: strings.TrimRight(opts.ServerURL, "/"),
		keyID:   opts.KeyID,
		secret:  opts.Secret,
		http:    &http.Client{Transport: transport, Timeout: requestTimeout},
	}, nil
}

// SetCredentials kayıt sonrası kimlik bilgilerini ayarlar.
func (c *Client) SetCredentials(keyID, secret string) {
	c.keyID = keyID
	c.secret = secret
}

// HostInfo arka uca gönderilen sistem bilgisi (HostInfoDto ile aynı alanlar).
type HostInfo struct {
	Hostname         string  `json:"hostname"`
	OSFamily         string  `json:"osFamily"`
	OSName           string  `json:"osName,omitempty"`
	OSVersion        string  `json:"osVersion,omitempty"`
	OSEdition        string  `json:"osEdition,omitempty"`
	KernelVersion    string  `json:"kernelVersion,omitempty"`
	Architecture     string  `json:"architecture,omitempty"`
	CPUModel         string  `json:"cpuModel,omitempty"`
	CPUCores         int     `json:"cpuCores,omitempty"`
	TotalMemoryBytes float64 `json:"totalMemoryBytes,omitempty"`
	BootTime         string  `json:"bootTime,omitempty"`
}

// RegisterRequest / RegisterResponse kayıt takası.
type RegisterRequest struct {
	RegistrationToken string   `json:"registrationToken"`
	AgentVersion      string   `json:"agentVersion"`
	Host              HostInfo `json:"host"`
}

type RegisterResponse struct {
	AgentID               string `json:"agentId"`
	ServerID              string `json:"serverId"`
	ServerName            string `json:"serverName"`
	KeyID                 string `json:"keyId"`
	Secret                string `json:"secret"`
	CollectionIntervalSec int    `json:"collectionIntervalSec"`
	HeartbeatIntervalSec  int    `json:"heartbeatIntervalSec"`
}

// HeartbeatRequest / HeartbeatResponse.
type HeartbeatRequest struct {
	AgentVersion  string   `json:"agentVersion"`
	UptimeSeconds float64  `json:"uptimeSeconds"`
	Host          HostInfo `json:"host"`
}

type HeartbeatResponse struct {
	ServerTime            string         `json:"serverTime"`
	CollectionIntervalSec int            `json:"collectionIntervalSec"`
	HeartbeatIntervalSec  int            `json:"heartbeatIntervalSec"`
	ServerName            string         `json:"serverName"`
	Commands              []AgentCommand `json:"commands,omitempty"`
}

// AgentCommand merkezden gelen, kısıtlı türde ve açıkça yetkilendirilmiş komut.
type AgentCommand struct {
	ID      string            `json:"id"`
	Type    string            `json:"type"`
	Payload map[string]string `json:"payload"`
}

// CommandResultRequest komut sonucunu bildirir.
type CommandResultRequest struct {
	OK      bool   `json:"ok"`
	Message string `json:"message,omitempty"`
}

// ServiceReport hizmet listesi raporu.
type ServiceReport struct {
	Services []ServiceItem `json:"services"`
}

// ServiceItem ServiceReportDto ile aynı alanlar.
type ServiceItem struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName,omitempty"`
	State       string `json:"state"`
	StartupType string `json:"startupType,omitempty"`
	IsEnabled   *bool  `json:"isEnabled,omitempty"`
}

type ServiceReportResponse struct {
	Accepted int `json:"accepted"`
}

// Metrik yapıları (MetricSampleDto ile aynı alanlar).
type CPUMetric struct {
	Percent float64 `json:"percent"`
}

type MemoryMetric struct {
	TotalBytes     float64 `json:"totalBytes"`
	UsedBytes      float64 `json:"usedBytes"`
	AvailableBytes float64 `json:"availableBytes"`
	Percent        float64 `json:"percent"`
}

type LoadAverage struct {
	Load1  float64 `json:"load1"`
	Load5  float64 `json:"load5"`
	Load15 float64 `json:"load15"`
}

type DiskMetric struct {
	Volume           string   `json:"volume"`
	FSType           string   `json:"fsType,omitempty"`
	TotalBytes       float64  `json:"totalBytes"`
	UsedBytes        float64  `json:"usedBytes"`
	FreeBytes        float64  `json:"freeBytes"`
	ReadBytesPerSec  *float64 `json:"readBytesPerSec,omitempty"`
	WriteBytesPerSec *float64 `json:"writeBytesPerSec,omitempty"`
}

type NetworkMetric struct {
	Name          string  `json:"name"`
	RxBytesPerSec float64 `json:"rxBytesPerSec"`
	TxBytesPerSec float64 `json:"txBytesPerSec"`
	IsUp          bool    `json:"isUp"`
}

type MetricSample struct {
	Timestamp     string          `json:"timestamp"`
	CPU           CPUMetric       `json:"cpu"`
	Memory        MemoryMetric    `json:"memory"`
	LoadAverage   *LoadAverage    `json:"loadAverage,omitempty"`
	Disks         []DiskMetric    `json:"disks"`
	Network       []NetworkMetric `json:"network"`
	UptimeSeconds float64         `json:"uptimeSeconds"`
}

type MetricsBatch struct {
	Samples []MetricSample `json:"samples"`
}

type MetricsResponse struct {
	Accepted int `json:"accepted"`
	Rejected int `json:"rejected"`
}

// Register kayıt belirtecini kimlik bilgisiyle takas eder (imzasız istek).
func (c *Client) Register(ctx context.Context, req RegisterRequest) (*RegisterResponse, error) {
	var resp RegisterResponse
	if err := c.do(ctx, "/agents/register", req, &resp, false); err != nil {
		return nil, err
	}
	return &resp, nil
}

// Heartbeat imzalı heartbeat gönderir.
func (c *Client) Heartbeat(ctx context.Context, req HeartbeatRequest) (*HeartbeatResponse, error) {
	var resp HeartbeatResponse
	if err := c.do(ctx, "/agents/heartbeat", req, &resp, true); err != nil {
		return nil, err
	}
	return &resp, nil
}

// ReportServices imzalı hizmet listesi gönderir.
func (c *Client) ReportServices(ctx context.Context, report ServiceReport) (*ServiceReportResponse, error) {
	var resp ServiceReportResponse
	if err := c.do(ctx, "/agents/services", report, &resp, true); err != nil {
		return nil, err
	}
	return &resp, nil
}

// ReportCommandResult komut sonucunu bildirir.
func (c *Client) ReportCommandResult(ctx context.Context, commandID string, result CommandResultRequest) error {
	return c.do(ctx, "/agents/commands/"+commandID+"/result", result, nil, true)
}

// SendMetrics imzalı metrik yığını gönderir.
func (c *Client) SendMetrics(ctx context.Context, batch MetricsBatch) (*MetricsResponse, error) {
	var resp MetricsResponse
	if err := c.do(ctx, "/agents/metrics", batch, &resp, true); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) do(ctx context.Context, path string, body any, out any, signed bool) error {
	return c.doMethod(ctx, http.MethodPost, path, body, out, signed)
}

// SignedHeaders verilen istek için imza başlıklarını üretir (WebSocket el sıkışması gibi
// http.Client dışındaki istekler için). requestURI yol + sorgu dizesidir, ör. "/api/v1/agents/terminal?session=…".
func (c *Client) SignedHeaders(method, requestURI string, body []byte) (http.Header, error) {
	if c.keyID == "" || c.secret == "" {
		return nil, errors.New("ajan kimlik bilgileri ayarlanmamış")
	}
	nonce, err := NewNonce()
	if err != nil {
		return nil, err
	}
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	h := http.Header{}
	h.Set("User-Agent", "TronMonitor-Agent/"+buildinfo.Version)
	h.Set(HeaderKey, c.keyID)
	h.Set(HeaderTimestamp, timestamp)
	h.Set(HeaderNonce, nonce)
	h.Set(HeaderSignature, Sign(c.secret, method, requestURI, timestamp, nonce, body))
	return h, nil
}

// BaseURL yapılandırılmış sunucu adresini (sonda / olmadan) döndürür.
func (c *Client) BaseURL() string { return c.baseURL }

// TLSConfig HTTP istemcisinin TLS ayarlarını döndürür (WebSocket için aynı CA güveni).
func (c *Client) TLSConfig() *tls.Config {
	if t, ok := c.http.Transport.(*http.Transport); ok {
		return t.TLSClientConfig
	}
	return nil
}

func (c *Client) doMethod(ctx context.Context, method, path string, body any, out any, signed bool) error {
	var payload []byte
	if body != nil {
		var err error
		payload, err = json.Marshal(body)
		if err != nil {
			return fmt.Errorf("istek gövdesi oluşturulamadı: %w", err)
		}
	}
	requestURI := apiPrefix + path
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+requestURI, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "TronMonitor-Agent/"+buildinfo.Version)

	if signed {
		headers, err := c.SignedHeaders(method, requestURI, payload)
		if err != nil {
			return err
		}
		for k, v := range headers {
			req.Header[k] = v
		}
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("sunucuya ulaşılamadı: %w", err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return fmt.Errorf("yanıt okunamadı: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		apiErr := &APIError{Status: resp.StatusCode}
		var parsed struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		if json.Unmarshal(data, &parsed) == nil {
			apiErr.Code = parsed.Code
			apiErr.Message = parsed.Message
		}
		return apiErr
	}
	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("yanıt çözümlenemedi: %w", err)
		}
	}
	return nil
}
