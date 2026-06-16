// Package mailer sends outbound email over the owner's own SMTP server using
// only the standard library (net/smtp). No third-party dependency, no SaaS
// binding — the owner brings their SMTP creds (Gmail app password, Postmark,
// Fastmail, …) and we relay through them.
//
// net/smtp.SendMail negotiates STARTTLS automatically when the server
// advertises it (real providers on 587), and skips auth + TLS when none is
// configured (a local Mailpit catcher on 1025, used by the e2e). PlainAuth
// refuses to leak credentials over an unencrypted non-localhost link, which is
// the behaviour we want.
package mailer

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
	b.WriteString(strings.Join(headers, "\r\n") + "\r\n\r\n")
	b.WriteString("--" + boundary + "\r\nContent-Type: text/plain; charset=\"utf-8\"\r\n\r\n")
	b.WriteString(msg.Body + "\r\n")
	b.WriteString("--" + boundary + "\r\nContent-Type: text/html; charset=\"utf-8\"\r\n\r\n")
	b.WriteString(msg.HTML + "\r\n")
	b.WriteString("--" + boundary + "--\r\n")
	return []byte(b.String())
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
