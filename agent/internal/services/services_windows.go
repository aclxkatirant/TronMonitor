//go:build windows

package services

import (
	"context"
	"fmt"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

func stateFrom(s svc.State) State {
	switch s {
	case svc.Running:
		return StateRunning
	case svc.Stopped:
		return StateStopped
	case svc.StartPending, svc.ContinuePending:
		return StateStarting
	case svc.StopPending, svc.PausePending:
		return StateStopping
	case svc.Paused:
		return StateStopped
	default:
		return StateUnknown
	}
}

func startTypeName(t uint32) string {
	switch t {
	case mgr.StartAutomatic:
		return "Otomatik"
	case mgr.StartManual:
		return "El ile"
	case mgr.StartDisabled:
		return "Devre dışı"
	case windows.SERVICE_BOOT_START, windows.SERVICE_SYSTEM_START:
		return "Sistem"
	default:
		return "Bilinmiyor"
	}
}

// list tüm Win32 hizmetlerini tek bir EnumServicesStatusEx çağrısıyla okur; başlangıç türü için her hizmet
// yalnızca sorgu haklarıyla açılır (yönetici olmayan hesaplar için de çalışır).
func list(_ context.Context) ([]Service, error) {
	m, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_ENUMERATE_SERVICE|windows.SC_MANAGER_CONNECT)
	if err != nil {
		return nil, fmt.Errorf("hizmet yöneticisine bağlanılamadı: %w", err)
	}
	defer windows.CloseServiceHandle(m)

	var bytesNeeded, count, resume uint32
	_ = windows.EnumServicesStatusEx(m, windows.SC_ENUM_PROCESS_INFO, windows.SERVICE_WIN32, windows.SERVICE_STATE_ALL, nil, 0, &bytesNeeded, &count, &resume, nil)
	if bytesNeeded == 0 {
		return []Service{}, nil
	}
	buf := make([]byte, bytesNeeded)
	if err := windows.EnumServicesStatusEx(m, windows.SC_ENUM_PROCESS_INFO, windows.SERVICE_WIN32, windows.SERVICE_STATE_ALL, &buf[0], bytesNeeded, &bytesNeeded, &count, &resume, nil); err != nil {
		return nil, fmt.Errorf("hizmetler listelenemedi: %w", err)
	}
	entries := unsafe.Slice((*windows.ENUM_SERVICE_STATUS_PROCESS)(unsafe.Pointer(&buf[0])), int(count))

	result := make([]Service, 0, count)
	for _, e := range entries {
		name := windows.UTF16PtrToString(e.ServiceName)
		display := windows.UTF16PtrToString(e.DisplayName)
		item := Service{Name: name, DisplayName: display, State: stateFrom(svc.State(e.ServiceStatusProcess.CurrentState))}
		if h, err := windows.OpenService(m, e.ServiceName, windows.SERVICE_QUERY_CONFIG); err == nil {
			s := &mgr.Service{Name: name, Handle: h}
			if cfg, err := s.Config(); err == nil {
				item.StartupType = startTypeName(cfg.StartType)
				enabled := cfg.StartType != mgr.StartDisabled
				item.IsEnabled = &enabled
			}
			s.Close()
		}
		result = append(result, item)
	}
	return result, nil
}

func control(ctx context.Context, name string, action Action) error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("hizmet yöneticisine bağlanılamadı (yönetici yetkisi gerekir): %w", err)
	}
	defer m.Disconnect()
	s, err := m.OpenService(name)
	if err != nil {
		return fmt.Errorf("hizmet açılamadı: %w", err)
	}
	defer s.Close()

	switch action {
	case ActionStart:
		return start(ctx, s)
	case ActionStop:
		return stop(ctx, s)
	case ActionRestart:
		if err := stop(ctx, s); err != nil {
			return err
		}
		return start(ctx, s)
	}
	return nil
}

func start(ctx context.Context, s *mgr.Service) error {
	if err := s.Start(); err != nil {
		return fmt.Errorf("hizmet başlatılamadı: %w", err)
	}
	return waitState(ctx, s, svc.Running)
}

func stop(ctx context.Context, s *mgr.Service) error {
	status, err := s.Control(svc.Stop)
	if err != nil {
		if status.State == svc.Stopped {
			return nil
		}
		return fmt.Errorf("hizmet durdurulamadı: %w", err)
	}
	return waitState(ctx, s, svc.Stopped)
}

func waitState(ctx context.Context, s *mgr.Service, want svc.State) error {
	deadline := time.Now().Add(60 * time.Second)
	for {
		status, err := s.Query()
		if err != nil {
			return fmt.Errorf("hizmet durumu okunamadı: %w", err)
		}
		if status.State == want {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("hizmet beklenen duruma geçmedi (şu an: %d)", status.State)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
}
