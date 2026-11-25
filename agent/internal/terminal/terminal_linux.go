//go:build linux

package terminal

import (
	"errors"
	"fmt"
	"os"
	"os/exec"

	"github.com/creack/pty"
)

type ptyShell struct {
	cmd  *exec.Cmd
	file *os.File
}

// start Linux'ta PTY ile oturum kabuğunu (SHELL, yoksa /bin/bash) açar.
func start(cols, rows int) (Shell, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}
	if _, err := os.Stat(shell); err != nil {
		shell = "/bin/sh"
	}
	cmd := exec.Command(shell, "-l")
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	if home := os.Getenv("HOME"); home != "" {
		cmd.Dir = home
	} else {
		cmd.Dir = "/"
	}
	f, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: uint16(rows), Cols: uint16(cols)})
	if err != nil {
		return nil, fmt.Errorf("kabuk başlatılamadı: %w", err)
	}
	return &ptyShell{cmd: cmd, file: f}, nil
}

func (s *ptyShell) Read(p []byte) (int, error)  { return s.file.Read(p) }
func (s *ptyShell) Write(p []byte) (int, error) { return s.file.Write(p) }
func (s *ptyShell) Resize(cols, rows int) error {
	return pty.Setsize(s.file, &pty.Winsize{Rows: uint16(rows), Cols: uint16(cols)})
}

func (s *ptyShell) Wait() (int, error) {
	err := s.cmd.Wait()
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return exit.ExitCode(), nil
	}
	return 0, err
}

func (s *ptyShell) Close() error {
	_ = s.file.Close()
	if s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
	return nil
}
