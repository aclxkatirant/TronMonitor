// Package logging dosyaya ve isteğe bağlı olarak stderr'e yazan basit, döndürmeli bir günlükleyici sağlar.
package logging

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	maxLogBytes = 10 * 1024 * 1024
	keepFiles   = 3
)

// rotatingFile boyut aşıldığında dosyayı .1, .2 ... olarak döndürür.
type rotatingFile struct {
	mu   sync.Mutex
	path string
	file *os.File
	size int64
}

func openRotating(path string) (*rotatingFile, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o640)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	return &rotatingFile{path: path, file: f, size: info.Size()}, nil
}

func (r *rotatingFile) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.size+int64(len(p)) > maxLogBytes {
		r.rotate()
	}
	n, err := r.file.Write(p)
	r.size += int64(n)
	return n, err
}

func (r *rotatingFile) rotate() {
	r.file.Close()
	for i := keepFiles - 1; i >= 1; i-- {
		_ = os.Rename(fmt.Sprintf("%s.%d", r.path, i), fmt.Sprintf("%s.%d", r.path, i+1))
	}
	_ = os.Rename(r.path, r.path+".1")
	f, err := os.OpenFile(r.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o640)
	if err != nil {
		r.file, _ = os.OpenFile(os.DevNull, os.O_WRONLY, 0)
		r.size = 0
		return
	}
	r.file = f
	r.size = 0
}

// Options günlükleyici seçenekleri.
type Options struct {
	FilePath string
	Level    string
	Console  bool
}

// New yapılandırılmış bir slog.Logger döndürür. Dosya açılamazsa yalnızca konsola yazar.
func New(opts Options) (*slog.Logger, error) {
	writers := []io.Writer{}
	var openErr error
	if opts.FilePath != "" {
		rf, err := openRotating(opts.FilePath)
		if err != nil {
			openErr = err
		} else {
			writers = append(writers, rf)
		}
	}
	if opts.Console || len(writers) == 0 {
		writers = append(writers, os.Stderr)
	}
	handler := slog.NewTextHandler(io.MultiWriter(writers...), &slog.HandlerOptions{Level: parseLevel(opts.Level)})
	return slog.New(handler), openErr
}

func parseLevel(level string) slog.Level {
	switch strings.ToLower(level) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
