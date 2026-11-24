// Package collect CPU, bellek, disk ve ağ metriklerini platformdan bağımsız bir modele dönüştürür.
package collect

import (
	"context"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	gnet "github.com/shirou/gopsutil/v4/net"

	"github.com/aclxkatirant/TronMonitor/agent/internal/api"
	"github.com/aclxkatirant/TronMonitor/agent/internal/sysinfo"
)

// Linux'ta izlenmeyen sanal/yardımcı dosya sistemleri.
var ignoredFSTypes = map[string]bool{
	"squashfs": true, "tmpfs": true, "devtmpfs": true, "overlay": true, "proc": true, "sysfs": true,
	"cgroup": true, "cgroup2": true, "devpts": true, "debugfs": true, "tracefs": true, "securityfs": true,
	"pstore": true, "autofs": true, "mqueue": true, "hugetlbfs": true, "fusectl": true, "configfs": true,
	"binfmt_misc": true, "ramfs": true, "nsfs": true, "efivarfs": true, "bpf": true, "rpc_pipefs": true,
}

type counters struct {
	at        time.Time
	diskRead  map[string]uint64
	diskWrite map[string]uint64
	netRx     map[string]uint64
	netTx     map[string]uint64
}

// Collector ardışık örnekler arasında sayaç farklarından hız hesaplar.
type Collector struct {
	mu   sync.Mutex
	prev *counters
}

// New yeni bir toplayıcı oluşturur ve CPU yüzdesi için ilk ölçümü başlatır.
func New() *Collector {
	// cpu.Percent(0) bir önceki çağrıya göre fark hesaplar; ilk çağrı sıfırlama içindir.
	_, _ = cpu.Percent(0, false)
	return &Collector{}
}

// Sample tek bir metrik örneği toplar. Alt toplayıcılardan biri başarısız olursa o alan boş döner.
func (c *Collector) Sample(ctx context.Context) api.MetricSample {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	sample := api.MetricSample{
		Timestamp:     now.UTC().Format(time.RFC3339),
		Disks:         []api.DiskMetric{},
		Network:       []api.NetworkMetric{},
		UptimeSeconds: sysinfo.Uptime(ctx),
	}

	if pct, err := cpu.PercentWithContext(ctx, 0, false); err == nil && len(pct) > 0 {
		sample.CPU.Percent = clampPercent(pct[0])
	}
	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		sample.Memory = api.MemoryMetric{
			TotalBytes:     float64(vm.Total),
			UsedBytes:      float64(vm.Used),
			AvailableBytes: float64(vm.Available),
			Percent:        clampPercent(vm.UsedPercent),
		}
	}
	if runtime.GOOS == "linux" {
		if avg, err := load.AvgWithContext(ctx); err == nil {
			sample.LoadAverage = &api.LoadAverage{Load1: avg.Load1, Load5: avg.Load5, Load15: avg.Load15}
		}
	}

	current := &counters{at: now, diskRead: map[string]uint64{}, diskWrite: map[string]uint64{}, netRx: map[string]uint64{}, netTx: map[string]uint64{}}
	var elapsed float64
	if c.prev != nil {
		elapsed = now.Sub(c.prev.at).Seconds()
	}

	sample.Disks = c.collectDisks(ctx, current, elapsed)
	sample.Network = c.collectNetwork(ctx, current, elapsed)
	c.prev = current
	return sample
}

func (c *Collector) collectDisks(ctx context.Context, current *counters, elapsed float64) []api.DiskMetric {
	partitions, err := disk.PartitionsWithContext(ctx, false)
	if err != nil {
		return []api.DiskMetric{}
	}
	ioCounters, _ := disk.IOCountersWithContext(ctx)

	result := make([]api.DiskMetric, 0, len(partitions))
	seen := map[string]bool{}
	for _, part := range partitions {
		if runtime.GOOS != "windows" && ignoredFSTypes[strings.ToLower(part.Fstype)] {
			continue
		}
		volume := volumeName(part)
		if seen[volume] {
			continue
		}
		usage, err := disk.UsageWithContext(ctx, part.Mountpoint)
		if err != nil || usage.Total == 0 {
			continue
		}
		seen[volume] = true
		metric := api.DiskMetric{
			Volume:     volume,
			FSType:     part.Fstype,
			TotalBytes: float64(usage.Total),
			UsedBytes:  float64(usage.Used),
			FreeBytes:  float64(usage.Free),
		}
		if io, ok := ioCounters[ioKey(part)]; ok {
			current.diskRead[volume] = io.ReadBytes
			current.diskWrite[volume] = io.WriteBytes
			if c.prev != nil && elapsed > 0 {
				if prev, ok := c.prev.diskRead[volume]; ok {
					metric.ReadBytesPerSec = ratePtr(prev, io.ReadBytes, elapsed)
				}
				if prev, ok := c.prev.diskWrite[volume]; ok {
					metric.WriteBytesPerSec = ratePtr(prev, io.WriteBytes, elapsed)
				}
			}
		}
		result = append(result, metric)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Volume < result[j].Volume })
	return result
}

func (c *Collector) collectNetwork(ctx context.Context, current *counters, elapsed float64) []api.NetworkMetric {
	stats, err := gnet.IOCountersWithContext(ctx, true)
	if err != nil {
		return []api.NetworkMetric{}
	}
	upState := map[string]bool{}
	if ifaces, err := gnet.InterfacesWithContext(ctx); err == nil {
		for _, iface := range ifaces {
			up := false
			for _, flag := range iface.Flags {
				if strings.EqualFold(flag, "up") {
					up = true
					break
				}
			}
			upState[iface.Name] = up
		}
	}

	result := make([]api.NetworkMetric, 0, len(stats))
	for _, st := range stats {
		if isLoopback(st.Name) {
			continue
		}
		current.netRx[st.Name] = st.BytesRecv
		current.netTx[st.Name] = st.BytesSent
		metric := api.NetworkMetric{Name: st.Name, IsUp: upState[st.Name]}
		if c.prev != nil && elapsed > 0 {
			if prev, ok := c.prev.netRx[st.Name]; ok {
				metric.RxBytesPerSec = rate(prev, st.BytesRecv, elapsed)
			}
			if prev, ok := c.prev.netTx[st.Name]; ok {
				metric.TxBytesPerSec = rate(prev, st.BytesSent, elapsed)
			}
		}
		result = append(result, metric)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	return result
}

func volumeName(part disk.PartitionStat) string {
	if runtime.GOOS == "windows" {
		return strings.TrimSuffix(strings.ToUpper(part.Device), `\`)
	}
	return part.Mountpoint
}

func ioKey(part disk.PartitionStat) string {
	if runtime.GOOS == "windows" {
		return strings.TrimSuffix(strings.ToUpper(part.Device), `\`)
	}
	return filepath.Base(part.Device)
}

func isLoopback(name string) bool {
	lower := strings.ToLower(name)
	return lower == "lo" || strings.HasPrefix(lower, "loopback")
}

func rate(prev, cur uint64, elapsed float64) float64 {
	if cur < prev || elapsed <= 0 {
		return 0
	}
	return float64(cur-prev) / elapsed
}

func ratePtr(prev, cur uint64, elapsed float64) *float64 {
	v := rate(prev, cur, elapsed)
	return &v
}

func clampPercent(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}
