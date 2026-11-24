// Package services işletim sistemi hizmetlerini (Windows hizmetleri / systemd birimleri) listeler ve denetler.
package services

import (
	"context"
	"errors"
	"regexp"
)

// State TronMonitor'un platformdan bağımsız hizmet durumu.
type State string

const (
	StateRunning  State = "RUNNING"
	StateStopped  State = "STOPPED"
	StateStarting State = "STARTING"
	StateStopping State = "STOPPING"
	StateFailed   State = "FAILED"
	StateUnknown  State = "UNKNOWN"
)

// Service tek bir hizmetin anlık görünümü (ServiceReportDto ile aynı alanlar).
type Service struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName,omitempty"`
	State       State  `json:"state"`
	StartupType string `json:"startupType,omitempty"`
	IsEnabled   *bool  `json:"isEnabled,omitempty"`
}

// Action hizmet üzerinde yapılabilecek kısıtlı işlemler.
type Action string

const (
	ActionStart   Action = "start"
	ActionStop    Action = "stop"
	ActionRestart Action = "restart"
)

// ErrUnsupported platformda hizmet yönetimi desteklenmediğinde döner.
var ErrUnsupported = errors.New("bu platformda hizmet yönetimi desteklenmiyor")

// Windows hizmet adları boşluk ve parantez içerebilir ("Bonjour Service"); SCM yalnızca "/" ve "\" karakterlerini yasaklar.
// Ad hiçbir zaman kabuğa verilmez (Windows'ta SCM API, Linux'ta `systemctl -- <ad>`), bu yüzden yalnızca
// yol ayırıcıları ve denetim karakterleri reddedilir. API tarafındaki SERVICE_NAME_PATTERN ile aynı kuraldır.
var nameRe = regexp.MustCompile(`^[^\x00-\x1f\x7f/\\]{1,256}$`)

// ValidName hizmet adının güvenli olup olmadığını denetler.
func ValidName(name string) bool {
	return nameRe.MatchString(name)
}

// List platformdaki tüm hizmetleri döndürür.
func List(ctx context.Context) ([]Service, error) {
	return list(ctx)
}

// Control hizmet üzerinde başlat/durdur/yeniden başlat uygular. Yalnızca bilinen eylemler kabul edilir.
func Control(ctx context.Context, name string, action Action) error {
	if !ValidName(name) {
		return errors.New("geçersiz hizmet adı")
	}
	switch action {
	case ActionStart, ActionStop, ActionRestart:
	default:
		return errors.New("geçersiz hizmet eylemi")
	}
	return control(ctx, name, action)
}
