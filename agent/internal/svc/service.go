// Package svc ajanı Windows hizmeti veya systemd birimi olarak yönetir.
package svc

import (
	"context"
	"fmt"
	"log/slog"
	"runtime"

	"github.com/kardianos/service"

	"github.com/aclxkatirant/TronMonitor/agent/internal/agent"
	"github.com/aclxkatirant/TronMonitor/agent/internal/config"
)

const (
	// Name hizmet adı (Windows: hizmet adı, Linux: tronmonitor-agent.service).
	Name        = "tronmonitor-agent"
	displayName = "TronMonitor Agent"
	description = "TronMonitor altyapı izleme ajanı. Sistem metriklerini merkezi TronMonitor sunucusuna gönderir."
)

// Runner hizmet yaşam döngüsünde ajanı çalıştırır.
type Runner struct {
	cfgPath string
	log     *slog.Logger
	cancel  context.CancelFunc
	done    chan struct{}
}

// NewRunner yeni bir hizmet yürütücüsü oluşturur.
func NewRunner(cfgPath string, log *slog.Logger) *Runner {
	return &Runner{cfgPath: cfgPath, log: log}
}

// Start hizmet başlatıldığında çağrılır; engellememelidir.
func (r *Runner) Start(_ service.Service) error {
	cfg, err := config.Load(r.cfgPath)
	if err != nil {
		return err
	}
	a, err := agent.New(cfg, r.cfgPath, r.log)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(context.Background())
	r.cancel = cancel
	r.done = make(chan struct{})
	go func() {
		defer close(r.done)
		if err := a.Run(ctx); err != nil {
			r.log.Error("ajan hata ile durdu", "error", err)
		}
	}()
	return nil
}

// Stop hizmet durdurulduğunda çağrılır; döngünün zarifçe bitmesini bekler.
func (r *Runner) Stop(_ service.Service) error {
	if r.cancel != nil {
		r.cancel()
	}
	if r.done != nil {
		<-r.done
	}
	return nil
}

// Config hizmet tanımını üretir. Ajan hizmet olarak "run" komutuyla başlatılır.
func Config(cfgPath string, serviceUser string) *service.Config {
	options := service.KeyValue{}
	if runtime.GOOS == "windows" {
		// Çökme durumunda 5 saniye sonra yeniden başlat; sayaç 1 gün sonra sıfırlanır.
		options["OnFailure"] = "restart"
		options["OnFailureDelayDuration"] = "5s"
		options["OnFailureResetPeriod"] = 86400
		options["StartType"] = "automatic"
		options["DelayedAutoStart"] = false
	} else {
		options["Restart"] = "always"
		options["SystemdScript"] = systemdUnitTemplate
		options["LogOutput"] = false
	}
	return &service.Config{
		Name:        Name,
		DisplayName: displayName,
		Description: description,
		Arguments:   []string{"run", "--config", cfgPath},
		UserName:    serviceUser,
		Option:      options,
	}
}

// New hizmet nesnesi oluşturur.
func New(cfgPath string, serviceUser string, log *slog.Logger) (service.Service, error) {
	return service.New(NewRunner(cfgPath, log), Config(cfgPath, serviceUser))
}

// StatusText hizmet durumunu Türkçe metne çevirir.
func StatusText(s service.Status) string {
	switch s {
	case service.StatusRunning:
		return "çalışıyor"
	case service.StatusStopped:
		return "durduruldu"
	default:
		return "bilinmiyor"
	}
}

// Describe platforma göre hizmet açıklaması döndürür.
func Describe() string {
	if runtime.GOOS == "windows" {
		return fmt.Sprintf("Windows hizmeti %q", Name)
	}
	return fmt.Sprintf("systemd birimi %q", Name+".service")
}

// systemdUnitTemplate sertleştirilmiş bir systemd birimi. Ajan root olmadan çalışır; metrikler için
// yalnızca /proc ve /sys okuma erişimi yeterlidir.
const systemdUnitTemplate = `[Unit]
Description={{.Description}}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={{.Path|cmdEscape}}{{range .Arguments}} {{.|cmd}}{{end}}
{{if .UserName}}User={{.UserName}}{{end}}
Restart=always
RestartSec=5
TimeoutStopSec=20
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/etc/tronmonitor /var/log/tronmonitor
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
`
