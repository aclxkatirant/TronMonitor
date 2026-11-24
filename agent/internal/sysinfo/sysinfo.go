// Package sysinfo işletim sistemi, donanım ve ana makine bilgilerini toplar.
package sysinfo

import (
	"context"
	"runtime"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"

	"github.com/aclxkatirant/TronMonitor/agent/internal/api"
)

// OSFamily çalışılan platformun TronMonitor ailesini döndürür.
func OSFamily() string {
	if runtime.GOOS == "windows" {
		return "WINDOWS"
	}
	return "LINUX"
}

// Collect sistem bilgisini toplar. Alan bazında hatalar yutulur; eksik alan boş bırakılır.
func Collect(ctx context.Context) api.HostInfo {
	info := api.HostInfo{OSFamily: OSFamily(), Architecture: normalizeArch(runtime.GOARCH)}

	if h, err := host.InfoWithContext(ctx); err == nil {
		info.Hostname = h.Hostname
		info.KernelVersion = h.KernelVersion
		info.OSName = strings.TrimSpace(h.Platform)
		info.OSVersion = strings.TrimSpace(h.PlatformVersion)
		if h.BootTime > 0 {
			info.BootTime = time.Unix(int64(h.BootTime), 0).UTC().Format(time.RFC3339)
		}
	}
	if infos, err := cpu.InfoWithContext(ctx); err == nil && len(infos) > 0 {
		info.CPUModel = strings.TrimSpace(infos[0].ModelName)
	}
	if count, err := cpu.CountsWithContext(ctx, true); err == nil && count > 0 {
		info.CPUCores = count
	}
	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		info.TotalMemoryBytes = float64(vm.Total)
	}

	applyPlatformDetails(&info)
	return info
}

// Uptime sistemin açık kalma süresini saniye cinsinden döndürür.
func Uptime(ctx context.Context) float64 {
	up, err := host.UptimeWithContext(ctx)
	if err != nil {
		return 0
	}
	return float64(up)
}

func normalizeArch(goarch string) string {
	switch goarch {
	case "amd64", "arm64":
		return goarch
	case "386":
		return "x86"
	case "arm":
		return "arm"
	default:
		return goarch
	}
}
