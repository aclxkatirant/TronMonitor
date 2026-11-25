// Package terminal ajanın çalıştığı makinede sözde terminal (PTY) ile etkileşimli bir kabuk açar.
// Windows'ta ConPTY üzerinden PowerShell, Linux'ta PTY üzerinden kullanıcının kabuğu kullanılır.
// Kabuk, ajan hizmetinin hesabıyla çalışır; bu nedenle merkezdeki `terminal.use` izni ayrıcalıklı sayılmalıdır.
package terminal

import (
	"errors"
	"io"
)

// Shell etkileşimli bir kabuk oturumudur. Read kabuk çıktısını, Write klavye girdisini taşır.
type Shell interface {
	io.Reader
	io.Writer
	Resize(cols, rows int) error
	// Wait kabuk süreci bitene kadar bekler ve çıkış kodunu döndürür.
	Wait() (int, error)
	Close() error
}

// ErrUnsupported bu platformda veya sürümde terminal desteklenmediğinde döner.
var ErrUnsupported = errors.New("bu platformda web terminali desteklenmiyor")

// Start verilen boyutta bir kabuk başlatır.
func Start(cols, rows int) (Shell, error) {
	if cols < 20 || cols > 500 || rows < 5 || rows > 200 {
		return nil, errors.New("geçersiz terminal boyutu")
	}
	return start(cols, rows)
}
