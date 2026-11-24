//go:build linux

package services

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

func stateFrom(active, sub string) State {
	switch active {
	case "active":
		if sub == "exited" {
			// Tek seferlik (oneshot) birimler çalışıp çıkar; başarılı sayılır.
			return StateRunning
		}
		return StateRunning
	case "inactive":
		return StateStopped
	case "failed":
		return StateFailed
	case "activating", "reloading":
		return StateStarting
	case "deactivating":
		return StateStopping
	default:
		return StateUnknown
	}
}

func run(ctx context.Context, args ...string) ([]byte, error) {
	c, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(c, "systemctl", args...)
	cmd.Env = append(cmd.Environ(), "LC_ALL=C", "SYSTEMD_COLORS=0")
	return cmd.Output()
}

// list systemd hizmet birimlerini ve etkinleştirme durumlarını okur.
func list(ctx context.Context) ([]Service, error) {
	unitsOut, err := run(ctx, "list-units", "--type=service", "--all", "--no-legend", "--plain", "--no-pager")
	if err != nil {
		return nil, fmt.Errorf("systemctl list-units başarısız: %w", err)
	}
	filesOut, _ := run(ctx, "list-unit-files", "--type=service", "--no-legend", "--plain", "--no-pager")

	enabledState := map[string]string{}
	scanner := bufio.NewScanner(bytes.NewReader(filesOut))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) >= 2 {
			enabledState[fields[0]] = fields[1]
		}
	}

	result := []Service{}
	scanner = bufio.NewScanner(bytes.NewReader(unitsOut))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 4 {
			continue
		}
		unit := fields[0]
		if !strings.HasSuffix(unit, ".service") || strings.HasPrefix(unit, "●") {
			continue
		}
		description := ""
		if len(fields) > 4 {
			description = strings.Join(fields[4:], " ")
		}
		item := Service{Name: unit, DisplayName: description, State: stateFrom(fields[2], fields[3])}
		if st, ok := enabledState[unit]; ok {
			item.StartupType = st
			enabled := st == "enabled" || st == "enabled-runtime" || st == "static" || st == "alias" || st == "indirect"
			item.IsEnabled = &enabled
		}
		result = append(result, item)
	}
	return result, nil
}

func control(ctx context.Context, name string, action Action) error {
	c, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	cmd := exec.CommandContext(c, "systemctl", string(action), "--", name)
	cmd.Env = append(cmd.Environ(), "LC_ALL=C")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl %s %s başarısız: %s", action, name, strings.TrimSpace(string(out)))
	}
	return nil
}
