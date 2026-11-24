//go:build windows

package sysinfo

import (
	"fmt"
	"strings"

	"golang.org/x/sys/windows/registry"

	"github.com/aclxkatirant/TronMonitor/agent/internal/api"
)

// applyPlatformDetails Windows sürüm bilgilerini kayıt defterinden okur. Windows Server 2019'da
// (10.0.17763) DisplayVersion anahtarı bulunmaz; bu durumda ReleaseId veya CurrentBuild kullanılır.
func applyPlatformDetails(info *api.HostInfo) {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE)
	if err != nil {
		return
	}
	defer key.Close()

	if productName, _, err := key.GetStringValue("ProductName"); err == nil && productName != "" {
		info.OSName = productName
	}
	if edition, _, err := key.GetStringValue("EditionID"); err == nil && edition != "" {
		info.OSEdition = edition
	}

	major, _, errMajor := key.GetIntegerValue("CurrentMajorVersionNumber")
	minor, _, errMinor := key.GetIntegerValue("CurrentMinorVersionNumber")
	build, _, errBuild := key.GetStringValue("CurrentBuild")
	ubr, _, errUBR := key.GetIntegerValue("UBR")
	if errMajor == nil && errMinor == nil && errBuild == nil {
		version := fmt.Sprintf("%d.%d.%s", major, minor, build)
		if errUBR == nil {
			version = fmt.Sprintf("%s.%d", version, ubr)
		}
		info.OSVersion = version
		info.KernelVersion = version
	}

	display, _, err := key.GetStringValue("DisplayVersion")
	if err != nil || display == "" {
		display, _, _ = key.GetStringValue("ReleaseId")
	}
	if display != "" && !strings.Contains(info.OSName, display) {
		info.OSName = strings.TrimSpace(info.OSName + " (" + display + ")")
	}
}
