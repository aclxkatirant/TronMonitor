// Package agent heartbeat ve metrik döngüsünü yürütür; ağ kesintilerinde örnekleri tamponlar ve
// üstel geri çekilme ile yeniden dener.
package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aclxkatirant/TronMonitor/agent/internal/api"
	"github.com/aclxkatirant/TronMonitor/agent/internal/buildinfo"
	"github.com/aclxkatirant/TronMonitor/agent/internal/collect"
	"github.com/aclxkatirant/TronMonitor/agent/internal/config"
	"github.com/aclxkatirant/TronMonitor/agent/internal/services"
	"github.com/aclxkatirant/TronMonitor/agent/internal/sysinfo"
)

const (
	maxBufferedSamples = 240
	maxBatchSize       = 60
	minBackoff         = 5 * time.Second
	maxBackoff         = 5 * time.Minute
	revokedRetry       = 10 * time.Minute
	servicesInterval   = 60 * time.Second
)

// Agent çalışma zamanı durumunu tutar.
type Agent struct {
	cfg       *config.Config
	cfgPath   string
	client    *api.Client
	collector *collect.Collector
	log       *slog.Logger

	mu       sync.Mutex
	buffer   []api.MetricSample
	backoff  time.Duration
	revoked  bool
	lastHost api.HostInfo
}

// New yapılandırmadan bir ajan oluşturur.
func New(cfg *config.Config, cfgPath string, log *slog.Logger) (*Agent, error) {
	client, err := api.New(api.Options{ServerURL: cfg.ServerURL, KeyID: cfg.KeyID, Secret: cfg.Secret, CAFile: cfg.CAFile})
	if err != nil {
		return nil, err
	}
	return &Agent{cfg: cfg, cfgPath: cfgPath, client: client, collector: collect.New(), log: log, backoff: minBackoff}, nil
}

// Run ctx iptal edilene kadar döngüyü çalıştırır.
func (a *Agent) Run(ctx context.Context) error {
	a.log.Info("ajan başlatıldı", "version", buildinfo.Version, "server", a.cfg.ServerURL, "serverName", a.cfg.ServerName)
	a.lastHost = sysinfo.Collect(ctx)

	var wg sync.WaitGroup
	wg.Add(4)
	go func() {
		defer wg.Done()
		a.heartbeatLoop(ctx)
	}()
	go func() {
		defer wg.Done()
		a.metricsLoop(ctx)
	}()
	go func() {
		defer wg.Done()
		a.servicesLoop(ctx)
	}()
	go func() {
		defer wg.Done()
		a.commandsLoop(ctx)
	}()
	wg.Wait()
	a.log.Info("ajan durduruldu")
	return nil
}

// commandsLoop merkezdeki komutları uzun yoklama ile anında alır; heartbeat aralığını beklemez.
// Sunucuya ulaşılamazsa üstel geri çekilme uygulanır (heartbeat ile aynı sayaç).
func (a *Agent) commandsLoop(ctx context.Context) {
	// Heartbeat'in önce gitmesi için kısa gecikme.
	select {
	case <-ctx.Done():
		return
	case <-time.After(2 * time.Second):
	}
	for {
		if ctx.Err() != nil {
			return
		}
		if a.isRevoked() {
			select {
			case <-ctx.Done():
				return
			case <-time.After(revokedRetry):
			}
			continue
		}
		callCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
		cmds, err := a.client.WaitCommands(callCtx)
		cancel()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			a.mu.Lock()
			wait := a.backoff
			a.mu.Unlock()
			a.log.Debug("komut yoklaması başarısız; yeniden denenecek", "error", err, "wait", wait)
			select {
			case <-ctx.Done():
				return
			case <-time.After(jitter(wait)):
			}
			continue
		}
		for _, cmd := range cmds {
			a.executeCommand(ctx, cmd)
		}
	}
}

func (a *Agent) heartbeatLoop(ctx context.Context) {
	// İlk heartbeat hemen gönderilir.
	a.sendHeartbeat(ctx)
	for {
		interval := time.Duration(a.cfg.HeartbeatIntervalSec) * time.Second
		if a.isRevoked() {
			interval = revokedRetry
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(jitter(interval)):
			a.sendHeartbeat(ctx)
		}
	}
}

func (a *Agent) metricsLoop(ctx context.Context) {
	// Hız hesapları için ilk örnek atılır.
	_ = a.collector.Sample(ctx)
	for {
		select {
		case <-ctx.Done():
			a.flush(ctx)
			return
		case <-time.After(time.Duration(a.cfg.CollectionIntervalSec) * time.Second):
			sample := a.collector.Sample(ctx)
			a.enqueue(sample)
			a.flush(ctx)
		}
	}
}

func (a *Agent) sendHeartbeat(ctx context.Context) {
	callCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	host := sysinfo.Collect(callCtx)
	resp, err := a.client.Heartbeat(callCtx, api.HeartbeatRequest{
		AgentVersion:  buildinfo.Version,
		UptimeSeconds: sysinfo.Uptime(callCtx),
		Host:          host,
	})
	if err != nil {
		a.handleError("heartbeat", err)
		return
	}
	a.mu.Lock()
	a.revoked = false
	a.backoff = minBackoff
	a.lastHost = host
	changed := false
	if resp.CollectionIntervalSec > 0 && resp.CollectionIntervalSec != a.cfg.CollectionIntervalSec {
		a.log.Info("toplama aralığı güncellendi", "old", a.cfg.CollectionIntervalSec, "new", resp.CollectionIntervalSec)
		a.cfg.CollectionIntervalSec = resp.CollectionIntervalSec
		changed = true
	}
	if resp.HeartbeatIntervalSec > 0 && resp.HeartbeatIntervalSec != a.cfg.HeartbeatIntervalSec {
		a.cfg.HeartbeatIntervalSec = resp.HeartbeatIntervalSec
		changed = true
	}
	if resp.ServerName != "" && resp.ServerName != a.cfg.ServerName {
		a.cfg.ServerName = resp.ServerName
		changed = true
	}
	a.mu.Unlock()
	if changed {
		if err := config.Save(a.cfgPath, a.cfg); err != nil {
			a.log.Warn("yapılandırma güncellenemedi", "error", err)
		}
	}
	a.log.Debug("heartbeat gönderildi", "serverTime", resp.ServerTime)
	for _, cmd := range resp.Commands {
		a.executeCommand(ctx, cmd)
	}
}

// servicesLoop hizmet listesini düzenli aralıklarla raporlar.
func (a *Agent) servicesLoop(ctx context.Context) {
	// İlk rapor kısa bir gecikmeyle gönderilir; böylece heartbeat önce gider.
	select {
	case <-ctx.Done():
		return
	case <-time.After(5 * time.Second):
	}
	for {
		a.reportServices(ctx)
		select {
		case <-ctx.Done():
			return
		case <-time.After(jitter(servicesInterval)):
		}
	}
}

func (a *Agent) reportServices(ctx context.Context) {
	if a.isRevoked() {
		return
	}
	callCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	list, err := services.List(callCtx)
	if err != nil {
		if errors.Is(err, services.ErrUnsupported) {
			return
		}
		a.log.Warn("hizmetler listelenemedi", "error", err)
		return
	}
	items := make([]api.ServiceItem, 0, len(list))
	for _, s := range list {
		items = append(items, api.ServiceItem{Name: s.Name, DisplayName: s.DisplayName, State: string(s.State), StartupType: s.StartupType, IsEnabled: s.IsEnabled})
	}
	resp, err := a.client.ReportServices(callCtx, api.ServiceReport{Services: items})
	if err != nil {
		a.handleError("services", err)
		return
	}
	a.log.Debug("hizmetler raporlandı", "count", len(items), "accepted", resp.Accepted)
}

// executeCommand merkezden gelen komutu yalnızca bilinen türlerde ve doğrulanmış parametrelerle çalıştırır.
func (a *Agent) executeCommand(ctx context.Context, cmd api.AgentCommand) {
	result := api.CommandResultRequest{OK: false}
	switch cmd.Type {
	case "service.start", "service.stop", "service.restart":
		name := cmd.Payload["serviceName"]
		action := services.Action(cmd.Type[len("service."):])
		a.log.Info("hizmet komutu alındı", "id", cmd.ID, "type", cmd.Type, "service", name)
		cmdCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		err := services.Control(cmdCtx, name, action)
		cancel()
		if err != nil {
			result.Message = err.Error()
			a.log.Warn("hizmet komutu başarısız", "id", cmd.ID, "error", err)
		} else {
			result.OK = true
			result.Message = fmt.Sprintf("%s: %s tamamlandı", name, action)
		}
	case "terminal.open":
		sessionID := cmd.Payload["sessionId"]
		cols, _ := strconv.Atoi(cmd.Payload["cols"])
		rows, _ := strconv.Atoi(cmd.Payload["rows"])
		switch {
		case a.cfg.DisableTerminal:
			result.Message = errTerminalDisabled.Error()
			a.log.Warn("terminal isteği reddedildi: yapılandırmada kapalı", "id", cmd.ID)
		case !uuidRe.MatchString(sessionID):
			result.Message = "geçersiz oturum kimliği"
		default:
			result.OK = true
			result.Message = "terminal bağlantısı kuruluyor"
			a.log.Info("terminal isteği alındı", "id", cmd.ID, "session", sessionID)
			go a.runTerminal(ctx, sessionID, cols, rows)
		}
	default:
		result.Message = "desteklenmeyen komut türü: " + cmd.Type
		a.log.Warn("bilinmeyen komut yok sayıldı", "id", cmd.ID, "type", cmd.Type)
	}
	callCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := a.client.ReportCommandResult(callCtx, cmd.ID, result); err != nil {
		a.log.Warn("komut sonucu bildirilemedi", "id", cmd.ID, "error", err)
	}
	if result.OK && strings.HasPrefix(cmd.Type, "service.") {
		// Hizmet durumu değişti; listeyi hemen yenile.
		a.reportServices(ctx)
	}
}

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F-]{36}$`)

func (a *Agent) enqueue(sample api.MetricSample) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.buffer) >= maxBufferedSamples {
		// En eski örnek atılır; bellek sınırlı tutulur.
		a.buffer = a.buffer[1:]
	}
	a.buffer = append(a.buffer, sample)
}

// flush tamponu sunucuya gönderir. Geri çekilme süresi dolmadıysa veya kimlik iptal edildiyse bekler.
func (a *Agent) flush(ctx context.Context) {
	a.mu.Lock()
	if len(a.buffer) == 0 || a.revoked {
		a.mu.Unlock()
		return
	}
	n := len(a.buffer)
	if n > maxBatchSize {
		n = maxBatchSize
	}
	batch := make([]api.MetricSample, n)
	copy(batch, a.buffer[:n])
	a.mu.Unlock()

	callCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	resp, err := a.client.SendMetrics(callCtx, api.MetricsBatch{Samples: batch})
	if err != nil {
		a.handleError("metrics", err)
		return
	}
	a.mu.Lock()
	a.buffer = a.buffer[n:]
	remaining := len(a.buffer)
	a.backoff = minBackoff
	a.mu.Unlock()
	a.log.Debug("metrikler gönderildi", "accepted", resp.Accepted, "rejected", resp.Rejected, "buffered", remaining)
	if remaining > 0 {
		a.flush(ctx)
	}
}

func (a *Agent) handleError(op string, err error) {
	var apiErr *api.APIError
	if errors.As(err, &apiErr) {
		if apiErr.IsRevoked() {
			a.mu.Lock()
			wasRevoked := a.revoked
			a.revoked = true
			a.mu.Unlock()
			if !wasRevoked {
				a.log.Error("ajan kimlik bilgisi iptal edilmiş; sunucu yeniden kaydedilene kadar veri gönderilmeyecek", "op", op)
			}
			return
		}
		if apiErr.Status == 400 {
			a.log.Error("sunucu isteği reddetti", "op", op, "code", apiErr.Code, "message", apiErr.Message)
			return
		}
	}
	a.mu.Lock()
	wait := a.backoff
	a.backoff = min(a.backoff*2, maxBackoff)
	a.mu.Unlock()
	a.log.Warn("sunucuya gönderim başarısız; yeniden denenecek", "op", op, "error", err, "nextBackoff", wait)
}

func (a *Agent) isRevoked() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.revoked
}

func jitter(d time.Duration) time.Duration {
	if d <= 0 {
		return d
	}
	delta := time.Duration(rand.Int63n(int64(d / 10)))
	return d - d/20 + delta
}
