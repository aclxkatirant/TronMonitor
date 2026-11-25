//go:build windows

package terminal

import (
	"context"
	"fmt"
	"os"

	"github.com/UserExistsError/conpty"
)

type conptyShell struct {
	pty *conpty.ConPty
}

// start Windows'ta ConPTY (Windows 10 1809 / Server 2019 ve üzeri) ile PowerShell açar.
func start(cols, rows int) (Shell, error) {
	if !conpty.IsConPtyAvailable() {
		return nil, fmt.Errorf("%w: ConPTY bulunamadı (Windows Server 2019 / Windows 10 1809 veya üzeri gerekir)", ErrUnsupported)
	}
	env := append(os.Environ(), "TERM=xterm-256color")
	home := os.Getenv("SystemDrive")
	if home == "" {
		home = `C:\`
	}
	p, err := conpty.Start(`powershell.exe -NoLogo -NoProfile`, conpty.ConPtyDimensions(cols, rows), conpty.ConPtyEnv(env), conpty.ConPtyWorkDir(home+`\`))
	if err != nil {
		return nil, fmt.Errorf("PowerShell başlatılamadı: %w", err)
	}
	return &conptyShell{pty: p}, nil
}

func (s *conptyShell) Read(p []byte) (int, error)  { return s.pty.Read(p) }
func (s *conptyShell) Write(p []byte) (int, error) { return s.pty.Write(p) }
func (s *conptyShell) Resize(cols, rows int) error { return s.pty.Resize(cols, rows) }
func (s *conptyShell) Close() error                { return s.pty.Close() }

func (s *conptyShell) Wait() (int, error) {
	code, err := s.pty.Wait(context.Background())
	return int(code), err
}
