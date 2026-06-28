// verify.go —— SMTP 连接测试（不发信）。owner 在 admin 填 SMTP 凭据后点 Connect，后端真去
// dial + EHLO + STARTTLS（服务端宣告则做）+ AUTH（填了用户名则做），握手成功 = 连上。host/port
// 错 → dial 失败；坏 username/password → AUTH 535；TLS 不符 → 握手失败——都映射成友好「未连接」。

package mailer

import (
	"crypto/tls"
	"errors"
	"fmt"
	"net/smtp"
)

// Verify —— 跑一次 SMTP 握手验证配置，不发信。成功 = 凭据能连。
func Verify(cfg *Config) (err error) {
	if cfg.Host == "" {
		return errors.New("mailer: incomplete config (host)")
	}
	c, derr := smtp.Dial(fmt.Sprintf("%s:%d", cfg.Host, cfg.Port))
	if derr != nil {
		return fmt.Errorf("smtp dial: %w", derr)
	}
	defer func() {
		if cerr := c.Close(); cerr != nil && err == nil {
			err = cerr
		}
	}()
	return handshake(c, cfg)
}

func handshake(c *smtp.Client, cfg *Config) error {
	if herr := c.Hello("localhost"); herr != nil {
		return fmt.Errorf("smtp hello: %w", herr)
	}
	if terr := maybeStartTLS(c, cfg.Host); terr != nil {
		return terr
	}
	return maybeAuth(c, cfg)
}

func maybeStartTLS(c *smtp.Client, host string) error {
	if ok, _ := c.Extension("STARTTLS"); !ok {
		return nil
	}
	tlsCfg := &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}
	if serr := c.StartTLS(tlsCfg); serr != nil {
		return fmt.Errorf("smtp starttls: %w", serr)
	}
	return nil
}

func maybeAuth(c *smtp.Client, cfg *Config) error {
	if cfg.Username == "" {
		return nil
	}
	auth := smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
	if aerr := c.Auth(auth); aerr != nil {
		return fmt.Errorf("smtp auth: %w", aerr)
	}
	return nil
}
