// mailer_smtp.go —— connector 的 SMTP 出站传输原语(net/smtp)。owner 自带 SMTP 凭据,
// 经连接器 smtp 协议运行时中转发信;无第三方依赖、无 SaaS 绑定。

package connector

import (
	"errors"
	"fmt"
	"net/smtp"
	"strings"
	"time"
)

// Config —— one send's SMTP connection + sender identity (decrypted).
type Config struct {
	Host        string
	Username    string
	Password    string
	FromAddress string
	FromName    string
	TLS         string // "" | "none" | "starttls" | "tls"（implicit）
	Port        int
}

// Message —— one email. Body is the plain-text part; HTML (optional) adds a
// rich part, sent as multipart/alternative so non-HTML clients still get Body.
type Message struct {
	ToAddress string
	ToName    string
	Subject   string
	Body      string
	HTML      string
}

// Send relays one message through cfg's SMTP server. Auth is attached only when
// a username is set, so an unauthenticated catcher (Mailpit) and an
// authenticated provider both work through the same path.
func Send(cfg *Config, msg *Message, now time.Time) error {
	if cfg.Host == "" || cfg.FromAddress == "" {
		return errors.New("mailer: incomplete config (host/from)")
	}
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	var auth smtp.Auth
	if cfg.Username != "" {
		auth = smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
	}
	raw := buildMessage(cfg, msg, now)
	if err := smtp.SendMail(addr, auth, cfg.FromAddress, []string{msg.ToAddress}, raw); err != nil {
		return fmt.Errorf("smtp send: %w", err)
	}
	return nil
}

// buildMessage renders a minimal RFC 5322 message: text/plain when there's no
// HTML, multipart/alternative (plain + HTML) when there is. Display names and the
// subject are stripped of CR/LF so a supplied name can't inject extra headers.
func buildMessage(cfg *Config, msg *Message, now time.Time) []byte {
	if msg.HTML == "" {
		return buildPlain(cfg, msg, now)
	}
	return buildMultipart(cfg, msg, now)
}

func baseHeaders(cfg *Config, msg *Message, now time.Time) []string {
	return []string{
		"From: " + addressHeader(cfg.FromName, cfg.FromAddress),
		"To: " + addressHeader(msg.ToName, msg.ToAddress),
		"Subject: " + headerSafe(msg.Subject),
		"Date: " + now.Format(time.RFC1123Z),
		"MIME-Version: 1.0",
	}
}

func buildPlain(cfg *Config, msg *Message, now time.Time) []byte {
	headers := append(baseHeaders(cfg, msg, now), "Content-Type: text/plain; charset=\"utf-8\"")
	return []byte(strings.Join(headers, "\r\n") + "\r\n\r\n" + msg.Body)
}

func buildMultipart(cfg *Config, msg *Message, now time.Time) []byte {
	boundary := fmt.Sprintf("sm-boundary-%d", now.UnixNano())
	headers := append(baseHeaders(cfg, msg, now),
		"Content-Type: multipart/alternative; boundary=\""+boundary+"\"")
	var b strings.Builder
	_, _ = b.WriteString(strings.Join(headers, "\r\n") + "\r\n\r\n")
	writePart(&b, boundary, "text/plain", msg.Body)
	writePart(&b, boundary, "text/html", msg.HTML)
	_, _ = b.WriteString("--" + boundary + "--\r\n")
	return []byte(b.String())
}

func writePart(b *strings.Builder, boundary, contentType, body string) {
	_, _ = b.WriteString("--" + boundary + "\r\n")
	_, _ = b.WriteString("Content-Type: " + contentType + "; charset=\"utf-8\"\r\n\r\n")
	_, _ = b.WriteString(body + "\r\n")
}

func addressHeader(name, address string) string {
	addr := headerSafe(address)
	if name == "" {
		return addr
	}
	return fmt.Sprintf("%s <%s>", headerSafe(name), addr)
}

func headerSafe(s string) string {
	return strings.NewReplacer("\r", "", "\n", "").Replace(s)
}
