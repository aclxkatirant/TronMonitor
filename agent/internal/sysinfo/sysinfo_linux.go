//go:build linux

package sysinfo

import (
	"bufio"
	"os"
	"strings"

	"github.com/aclxkatirant/TronMonitor/agent/internal/api"
)

// applyPlatformDetails /etc/os-release dosyasından dağıtım adını ve sürümünü okur.
func applyPlatformDetails(info *api.HostInfo) {
	file, err := os.Open("/etc/os-release")
	if err != nil {
		return
	}
	defer file.Close()

	values := map[string]string{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		values[key] = strings.Trim(value, `"`)
	}
	if pretty := values["PRETTY_NAME"]; pretty != "" {
		info.OSName = pretty
	} else if name := values["NAME"]; name != "" {
		info.OSName = name
	}
	if version := values["VERSION_ID"]; version != "" {
		info.OSVersion = version
	}
	if variant := values["VARIANT"]; variant != "" {
		info.OSEdition = variant
	}
}
