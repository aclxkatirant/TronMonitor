package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"github.com/aclxkatirant/TronMonitor/agent/internal/terminal"
)

const (
	maxTerminals        = 5
	terminalDialTimeout = 15 * time.Second
	terminalWriteWait   = 10 * time.Second
	terminalPingPeriod  = 20 * time.Second
)

var activeTerminals atomic.Int32

type terminalControl struct {
	Type string `json:"type"`
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
}

// runTerminal merkeze imzalı WebSocket ile bağlanır, yerel kabuğu açar ve iki yönü birbirine bağlar.
// Merkez; kimlik doğrulamasını, oturum sahibinin iznini ve boşta kalma sınırlarını uygular.
func (a *Agent) runTerminal(ctx context.Context, sessionID string, cols, rows int) {
	if activeTerminals.Load() >= maxTerminals {
		a.log.Warn("terminal isteği reddedildi: eşzamanlı oturum sınırı", "session", sessionID)
		return
	}
	activeTerminals.Add(1)
	defer activeTerminals.Add(-1)

	wsURL, requestURI := a.client.TerminalURL(sessionID)
	headers, err := a.client.SignedHeaders(http.MethodGet, requestURI, nil)
	if err != nil {
		a.log.Warn("terminal başlıkları üretilemedi", "error", err)
		return
	}
	dialer := websocket.Dialer{HandshakeTimeout: terminalDialTimeout, TLSClientConfig: a.client.TLSConfig(), Proxy: http.ProxyFromEnvironment}
	conn, resp, err := dialer.DialContext(ctx, wsURL, headers)
	if err != nil {
		status := 0
		if resp != nil {
			status = resp.StatusCode
		}
		a.log.Warn("terminal bağlantısı kurulamadı", "session", sessionID, "status", status, "error", err)
		return
	}
	defer conn.Close()
	a.log.Info("terminal oturumu bağlandı", "session", sessionID, "cols", cols, "rows", rows)

	var writeMu sync.Mutex
	send := func(messageType int, data []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = conn.SetWriteDeadline(time.Now().Add(terminalWriteWait))
		return conn.WriteMessage(messageType, data)
	}
	sendJSON := func(v any) {
		b, _ := json.Marshal(v)
		_ = send(websocket.TextMessage, b)
	}

	shell, err := terminal.Start(cols, rows)
	if err != nil {
		a.log.Warn("kabuk başlatılamadı", "session", sessionID, "error", err)
		sendJSON(map[string]string{"type": "error", "message": err.Error()})
		_ = send(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "shell failed"))
		return
	}
	defer shell.Close()
	sendJSON(map[string]string{"type": "ready"})

	done := make(chan struct{})
	var once sync.Once
	finish := func() { once.Do(func() { close(done) }) }

	// Kabuk çıktısı -> merkez
	go func() {
		defer finish()
		buf := make([]byte, 32*1024)
		for {
			n, err := shell.Read(buf)
			if n > 0 {
				if err := send(websocket.BinaryMessage, buf[:n]); err != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	// Merkez -> kabuk (girdi ve boyut)
	go func() {
		defer finish()
		for {
			mt, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			switch mt {
			case websocket.BinaryMessage:
				if _, err := shell.Write(data); err != nil {
					return
				}
			case websocket.TextMessage:
				var ctl terminalControl
				if json.Unmarshal(data, &ctl) == nil && ctl.Type == "resize" {
					if err := shell.Resize(ctl.Cols, ctl.Rows); err != nil {
						a.log.Debug("terminal yeniden boyutlandırılamadı", "error", err)
					}
				}
			}
		}
	}()

	// Kabuk süreci bitince çıkış kodunu bildir.
	exitCh := make(chan int, 1)
	go func() {
		code, _ := shell.Wait()
		exitCh <- code
		finish()
	}()

	ticker := time.NewTicker(terminalPingPeriod)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			sendJSON(map[string]any{"type": "exit", "message": "ajan durduruluyor"})
			_ = send(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseGoingAway, "agent stopping"))
			return
		case <-ticker.C:
			if err := send(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-done:
			select {
			case code := <-exitCh:
				sendJSON(map[string]any{"type": "exit", "code": code, "message": fmt.Sprintf("Kabuk kapandı (çıkış kodu %d)", code)})
			default:
			}
			_ = send(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "done"))
			a.log.Info("terminal oturumu kapandı", "session", sessionID)
			return
		}
	}
}

var errTerminalDisabled = errors.New("web terminali bu ajanda kapalı (yapılandırmada disableTerminal)")
