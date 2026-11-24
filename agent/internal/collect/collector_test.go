package collect

import (
	"context"
	"testing"
	"time"
)

func TestRate(t *testing.T) {
	if got := rate(100, 400, 3); got != 100 {
		t.Fatalf("rate = %v", got)
	}
	if got := rate(400, 100, 3); got != 0 {
		t.Fatalf("sayaç sıfırlanınca 0 beklenir, %v", got)
	}
	if got := rate(1, 2, 0); got != 0 {
		t.Fatalf("elapsed 0 iken 0 beklenir, %v", got)
	}
}

func TestClampPercent(t *testing.T) {
	if clampPercent(-1) != 0 || clampPercent(101) != 100 || clampPercent(42.5) != 42.5 {
		t.Fatal("clampPercent hatalı")
	}
}

// TestSampleSmoke gerçek sistemde örnek toplar; alanların mantıklı aralıkta olduğunu doğrular.
func TestSampleSmoke(t *testing.T) {
	c := New()
	ctx := context.Background()
	first := c.Sample(ctx)
	time.Sleep(300 * time.Millisecond)
	second := c.Sample(ctx)

	if second.Memory.TotalBytes <= 0 || second.Memory.UsedBytes > second.Memory.TotalBytes {
		t.Fatalf("bellek değerleri mantıksız: %+v", second.Memory)
	}
	if second.CPU.Percent < 0 || second.CPU.Percent > 100 {
		t.Fatalf("CPU yüzdesi aralık dışı: %v", second.CPU.Percent)
	}
	if len(second.Disks) == 0 {
		t.Fatal("en az bir disk bekleniyordu")
	}
	for _, d := range second.Disks {
		if d.Volume == "" || d.TotalBytes <= 0 || d.UsedBytes > d.TotalBytes {
			t.Fatalf("disk değerleri mantıksız: %+v", d)
		}
	}
	if first.Timestamp == "" || second.Timestamp == "" {
		t.Fatal("zaman damgası boş")
	}
	if _, err := time.Parse(time.RFC3339, second.Timestamp); err != nil {
		t.Fatalf("zaman damgası RFC3339 değil: %v", err)
	}
}
