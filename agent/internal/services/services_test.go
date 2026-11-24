package services

import (
	"context"
	"runtime"
	"strings"
	"testing"
)

func TestValidName(t *testing.T) {
	for _, ok := range []string{"Spooler", "ssh.service", "systemd-journald.service", "user@1000.service", "W32Time", "Bonjour Service", "AMD Crash Defender Service", "Intel(R) Management", "MSSQL$SQLEXPRESS"} {
		if !ValidName(ok) {
			t.Errorf("%q geçerli olmalı", ok)
		}
	}
	for _, bad := range []string{"", "x;rm -rf /", "../etc", "a/b", "a\\b", "x\ny", "tab\there", strings.Repeat("a", 257)} {
		if ValidName(bad) {
			t.Errorf("%q geçersiz olmalı", bad)
		}
	}
}

func TestControlRejectsInvalid(t *testing.T) {
	if err := Control(context.Background(), "bad/name", ActionStart); err == nil {
		t.Fatal("geçersiz ad reddedilmeli")
	}
	if err := Control(context.Background(), "Spooler", Action("exec")); err == nil {
		t.Fatal("geçersiz eylem reddedilmeli")
	}
}

// TestListSmoke gerçek sistemde hizmet listesi alır (Windows ve Linux) ve adların doğrulamadan geçtiğini denetler.
func TestListSmoke(t *testing.T) {
	if runtime.GOOS != "windows" && runtime.GOOS != "linux" {
		t.Skip("desteklenmeyen platform")
	}
	items, err := List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(items) == 0 {
		t.Fatal("en az bir hizmet bekleniyordu")
	}
	for _, s := range items {
		if s.Name == "" || s.State == "" {
			t.Fatalf("eksik alan: %+v", s)
		}
		if !ValidName(s.Name) {
			t.Errorf("gerçek hizmet adı doğrulamadan geçmedi: %q", s.Name)
		}
	}
}
