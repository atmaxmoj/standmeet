// mailer_smtp.go — the connector's SMTP outbound transport primitive (net/smtp). The owner
// brings their own SMTP credentials, and mail is relayed through the connector's smtp protocol
// runtime; no third-party dependency, no SaaS lock-in.

package connector

import (
	"context"
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
	TLS         string // "" | "none" | "starttls" | "tls" (implicit)
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
func Send(ctx context.Context, cfg *Config, msg *Message, now time.Time) error {
	if cfg.Host == "" || cfg.FromAddress == "" {
		return errors.New("mailer: incomplete config (host/from)")
	}
	raw := buildMessage(cfg, msg, now)
	// **The dial must have a bound.** This used to be `smtp.SendMail(addr, …)` — it dials
	// itself, ignores ctx, has no deadline, so dialing an address where packets get dropped
	// waits out the full OS TCP timeout: measured in prod at **75 seconds**
	// (`dur_ms=75018`). By then the browser had long since timed out, the screen showed the
	// client's own message "can't reach your instance", and the top bar had flipped to NOT
	// ANSWERING — the backend had actually said the right thing, nobody was still watching by
	// then (F-C-36). Reuses dialSMTP: same dial path, same bound, as the connection test —
	// the two no longer go their separate ways.
	if err := sendVia(ctx, cfg, msg, raw); err != nil {
		return fmt.Errorf("smtp send: %w", err)
	}
	return nil
}

// sendVia — dial with a bound, then hand off one message.
func sendVia(ctx context.Context, cfg *Config, msg *Message, raw []byte) (err error) {
	c, derr := dialSMTP(ctx, cfg)
	if derr != nil {
		return derr
	}
	defer func() {
		if cerr := c.Close(); cerr != nil && err == nil {
			err = cerr
		}
	}()
	if herr := handshake(c, cfg); herr != nil {
		return herr
	}
	return writeMessage(c, cfg, msg.ToAddress, raw)
}

// writeMessage — the two-step MAIL FROM / RCPT TO envelope, then write the body.
func writeMessage(c *smtp.Client, cfg *Config, to string, raw []byte) error {
	if err := c.Mail(cfg.FromAddress); err != nil {
		return fmt.Errorf("mail from: %w", err)
	}
	if err := c.Rcpt(to); err != nil {
		return fmt.Errorf("rcpt to: %w", err)
	}
	return writeBody(c, raw)
}

// writeBody — the DATA section: open, write, close. Close must also report an error — a relay
// often waits until right before QUIT to say whether it's accepting the message, and
// swallowing the Close error would turn a rejection into an apparent success.
func writeBody(c *smtp.Client, raw []byte) error {
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("data: %w", err)
	}
	if _, werr := w.Write(raw); werr != nil {
		return fmt.Errorf("write body: %w", werr)
	}
	if cerr := w.Close(); cerr != nil {
		return fmt.Errorf("close body: %w", cerr)
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
