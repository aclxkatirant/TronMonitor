package terminal

import (
	"bytes"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestStartRejectsBadSize(t *testing.T) {
	if _, err := Start(1, 1); err == nil {
		t.Fatal("geçersiz boyut reddedilmeli")
	}
}

// TestShellRoundTrip gerçek bir kabuk açar, bir komut yazar ve çıktısını bekler (Windows ve Linux).
func TestShellRoundTrip(t *testing.T) {
	if runtime.GOOS != "windows" && runtime.GOOS != "linux" {
		t.Skip("desteklenmeyen platform")
	}
	sh, err := Start(100, 30)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer sh.Close()

	marker := "TRONMONITOR_PTY_OK"
	cmd := "echo " + marker + "\r"
	if runtime.GOOS == "windows" {
		cmd = "Write-Output '" + marker + "'\r"
	}
	// Kabuğun hazır olması için kısa bir süre bekle, sonra komutu gönder.
	time.Sleep(1500 * time.Millisecond)
	if _, err := sh.Write([]byte(cmd)); err != nil {
		t.Fatalf("Write: %v", err)
	}

	var out bytes.Buffer
	done := make(chan struct{})
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := sh.Read(buf)
			if n > 0 {
				out.Write(buf[:n])
				// Komutun kendi yankısı dışında çıktı satırı arıyoruz: marker, satır başında tek başına.
				if strings.Count(out.String(), marker) >= 2 {
					close(done)
					return
				}
			}
			if err != nil {
				close(done)
				return
			}
		}
	}()
	select {
	case <-done:
	case <-time.After(20 * time.Second):
		t.Fatalf("kabuk çıktısı zamanında gelmedi; alınan: %q", out.String())
	}
	if !strings.Contains(out.String(), marker) {
		t.Fatalf("çıktıda %q yok: %q", marker, out.String())
	}
	if err := sh.Resize(120, 40); err != nil {
		t.Fatalf("Resize: %v", err)
	}
}
