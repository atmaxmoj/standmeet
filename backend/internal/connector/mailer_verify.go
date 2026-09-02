// verify.go — SMTP connection test (no message sent). After the owner fills in SMTP
// credentials in admin and clicks Connect, the backend actually goes and dials + EHLO +
// (STARTTLS / implicit TLS) + AUTH (if a username was given); a successful handshake =
// connected. Failures get a friendly reason by category (host/port → connect; TLS handshake →
// tls; bad user/pass → auth), and the UI displays these sentinels directly.

package connector

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/smtp"
	"time"
)

// Categorized, friendly errors for the connection test (shown directly to the owner; the
// wording contains the UI's assertion keywords connect/tls/auth).
var (
	ErrVerifyConnect = errors.New("couldn't connect to the SMTP server — check the host and port")
	ErrVerifyTLS     = errors.New("TLS handshake failed — check the TLS setting matches the server")
	ErrVerifyAuth    = errors.New("SMTP authentication failed — check the username and password")
)

// wrapSentinel — the unified wrap format for "category sentinel + underlying error". Shared
// across the whole connector package: it used to be named wrapCategory, but what it wraps was
// never just categories (assembly failures and credential failures share the same shape), and
// a second constant with the same value would only leave the next person guessing which to use.
const wrapSentinel = "%w: %w"

// Verify — run one SMTP handshake to validate a config, without sending a message. Success =
// the credentials can connect.
func Verify(ctx context.Context, cfg *Config) (err error) {
	if cfg.Host == "" {
		return fmt.Errorf("%w: missing host", ErrVerifyConnect)
	}
	c, derr := dialSMTP(ctx, cfg)
	if derr != nil {
		return derr
	}
	defer func() {
		if cerr := c.Close(); cerr != nil && err == nil {
			err = cerr
		}
	}()
	return handshake(c, cfg)
}

// outboundDialTimeout — how long to wait when dialing a relay, at most.
//
// **A dial can fail to connect in two ways**: refused (an RST comes back immediately) and
// vanished without a trace (packets get dropped, and it waits until TCP gives up on its own).
// The first was already fine; the second used to wait **75 seconds** — that's exactly the
// number measured in prod (`dur_ms=75018`), because the plaintext path used `smtp.Dial`, which
// **ignores ctx and has no deadline at all**.
//
// The consequence of 75 seconds isn't "a bit slow": the browser had long since timed out, the
// screen showed the client's own message "can't reach your instance", and the health light in
// the top bar flipped to NOT ANSWERING — the backend had **actually already said the right
// thing** ("temporarily unavailable"), nobody was still watching by then. **The message written
// for the user got crowded out by time** (F-C-36).
//
// Why 10 seconds: a real relay's TCP handshake is millisecond-scale, and the SMTP greeting
// arrives within a second too; if 10 seconds pass with no response, waiting longer won't
// produce a different outcome, and the owner is still willing to watch the screen that long.
const outboundDialTimeout = 10 * time.Second

// dialSMTP — TLS="tls" → implicit TLS dial (the handshake must fail on a plaintext port);
// otherwise plaintext dial. Both paths go through ctx and both carry a bound: previously only
// the implicit-TLS path respected ctx, and the plaintext path could hang for a full minute.
func dialSMTP(ctx context.Context, cfg *Config) (*smtp.Client, error) {
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	dctx, cancel := context.WithTimeout(ctx, outboundDialTimeout)
	defer cancel()
	if cfg.TLS == "tls" {
		return dialImplicitTLS(dctx, addr, cfg.Host)
	}
	return dialPlain(dctx, addr, cfg.Host)
}

// dialPlain — plaintext dial (afterward, handshake decides whether to upgrade via STARTTLS).
// Uses net.Dialer.DialContext instead of smtp.Dial: the latter ignores ctx, so a stalled dial
// can only wait out the OS's TCP timeout.
func dialPlain(ctx context.Context, addr, host string) (*smtp.Client, error) {
	conn, derr := (&net.Dialer{}).DialContext(ctx, "tcp", addr)
	if derr != nil {
		return nil, fmt.Errorf(wrapSentinel, ErrVerifyConnect, derr)
	}
	c, cerr := smtp.NewClient(conn, host)
	if cerr != nil {
		return nil, fmt.Errorf(wrapSentinel, ErrVerifyConnect, cerr)
	}
	return c, nil
}

// dialImplicitTLS — implicit TLS dial (the handshake must fail on a plaintext port → tls error).
func dialImplicitTLS(ctx context.Context, addr, host string) (*smtp.Client, error) {
	tlsCfg := &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}
	conn, terr := (&tls.Dialer{Config: tlsCfg}).DialContext(ctx, "tcp", addr)
	if terr != nil {
		return nil, fmt.Errorf(wrapSentinel, ErrVerifyTLS, terr)
	}
	c, cerr := smtp.NewClient(conn, host)
	if cerr != nil {
		return nil, fmt.Errorf(wrapSentinel, ErrVerifyTLS, cerr)
	}
	return c, nil
}

func handshake(c *smtp.Client, cfg *Config) error {
	if herr := c.Hello("localhost"); herr != nil {
		return fmt.Errorf(wrapSentinel, ErrVerifyConnect, herr)
	}
	if terr := maybeStartTLS(c, cfg); terr != nil {
		return terr
	}
	return maybeAuth(c, cfg)
}

// maybeStartTLS — in modes other than "none"/"tls", upgrade if the server advertises STARTTLS
// (opportunistic).
func maybeStartTLS(c *smtp.Client, cfg *Config) error {
	if cfg.TLS == "none" || cfg.TLS == "tls" {
		return nil
	}
	if ok, _ := c.Extension("STARTTLS"); !ok {
		return nil
	}
	tlsCfg := &tls.Config{ServerName: cfg.Host, MinVersion: tls.VersionTLS12}
	if serr := c.StartTLS(tlsCfg); serr != nil {
		return fmt.Errorf(wrapSentinel, ErrVerifyTLS, serr)
	}
	return nil
}

func maybeAuth(c *smtp.Client, cfg *Config) error {
	if cfg.Username == "" {
		return nil
	}
	auth := smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
	if aerr := c.Auth(auth); aerr != nil {
		return fmt.Errorf(wrapSentinel, ErrVerifyAuth, aerr)
	}
	return nil
}
