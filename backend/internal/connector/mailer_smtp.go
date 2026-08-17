// mailer_smtp.go —— connector 的 SMTP 出站传输原语(net/smtp)。owner 自带 SMTP 凭据,
// 经连接器 smtp 协议运行时中转发信;无第三方依赖、无 SaaS 绑定。

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
func Send(ctx context.Context, cfg *Config, msg *Message, now time.Time) error {
	if cfg.Host == "" || cfg.FromAddress == "" {
		return errors.New("mailer: incomplete config (host/from)")
	}
	raw := buildMessage(cfg, msg, now)
	// **拨号要有上限**。以前这里是 `smtp.SendMail(addr, …)` —— 它自己拨，不接 ctx、没有
	// deadline，于是拨一个「包被丢掉」的地址要等满 OS 的 TCP 超时：prod 上量到 **75 秒**
	// （`dur_ms=75018`）。那时浏览器早超时了，屏幕显示的是客户端自己那句「够不着你的实例」，
	// 顶栏还翻成 NOT ANSWERING —— 后端其实已经把话说对了，只是没人还在看（F-C-36）。
	// 复用 dialSMTP：跟连接测试同一条拨号路径、同一个上限，两处不会再各走各的。
	if err := sendVia(ctx, cfg, msg, raw); err != nil {
		return fmt.Errorf("smtp send: %w", err)
	}
	return nil
}

// sendVia —— 带上限地拨号，然后把一封信交出去。
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

// writeMessage —— MAIL FROM / RCPT TO 两步信封，然后把正文写进去。
func writeMessage(c *smtp.Client, cfg *Config, to string, raw []byte) error {
	if err := c.Mail(cfg.FromAddress); err != nil {
		return fmt.Errorf("mail from: %w", err)
	}
	if err := c.Rcpt(to); err != nil {
		return fmt.Errorf("rcpt to: %w", err)
	}
	return writeBody(c, raw)
}

// writeBody —— DATA 那一段：开、写、关。关也要报错 —— 中继常常把「收不收」留到 QUIT 前
// 的那一声里说，Close 吞掉就等于把拒收当成了成功。
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
