//go:build !windows && !linux

package sysinfo

import "github.com/aclxkatirant/TronMonitor/agent/internal/api"

func applyPlatformDetails(_ *api.HostInfo) {}
