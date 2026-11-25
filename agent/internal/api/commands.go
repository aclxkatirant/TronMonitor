package api

import (
	"context"
	"net/http"
	"strings"
)

// WaitCommands uzun yoklama ile bekleyen komutları alır; sunucu komut yoksa en fazla ~25 sn bekler.
// Heartbeat yanıtındaki komutlarla aynı biçimdedir.
func (c *Client) WaitCommands(ctx context.Context) ([]AgentCommand, error) {
	var out []AgentCommand
	if err := c.doMethod(ctx, http.MethodGet, "/agents/commands/wait", nil, &out, true); err != nil {
		return nil, err
	}
	return out, nil
}

// TerminalURL ajan terminal WebSocket adresini (ws/wss) ve imzaya giren istek yolunu döndürür.
func (c *Client) TerminalURL(sessionID string) (wsURL, requestURI string) {
	requestURI = apiPrefix + "/agents/terminal?session=" + sessionID
	base := c.baseURL
	switch {
	case strings.HasPrefix(base, "https://"):
		base = "wss://" + strings.TrimPrefix(base, "https://")
	case strings.HasPrefix(base, "http://"):
		base = "ws://" + strings.TrimPrefix(base, "http://")
	}
	return base + requestURI, requestURI
}
